#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
思问岛 · 预置朗读音频生成器

把字库里的 316 单字 / 632 组词 / 316 例句合成为 mp3，并生成 audio/index.json。
索引以「文本」为键，前端 Speech.speak(text) 直接查表 —— 页面代码零改动，查不到就回退浏览器 TTS。

支持**多音色**：每个音色生成一整套音频到 audio/<音色>/，并写一份 audio/config.json
做角色映射。默认音色由 config.default 决定；将来接入 IP 后，把角色填进 config.roles 即可
（例如 {"char":"yunxia","sentence":"xiaoyi"} 表示单字用云夏念、例句用晓伊念）。

用法
  # 引擎一：edge-tts（免密钥，仅用于快速验证；非官方接口，勿用于正式发布）
  # 多个音色用逗号分隔；第一个作为默认音色
  python3 .build/gen-audio.py --engine edge --voice zh-CN-YunxiaNeural,zh-CN-XiaoyiNeural

  # 引擎二：腾讯云 TTS（推荐正式使用：官方允许商用 + 拼音音素锁多音字）
  python3 .build/gen-audio.py --engine tencent --voice 402000,403000 \
      --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"

常用参数
  --limit N      只生成前 N 个字（先小样验证）
  --group N      只生成第 N 组（0 基）
  --dry-run      只打印将要生成的条目，不调用任何服务
  --resume       跳过已存在的音频（长任务中断后可续跑）
  --default-voice 指定哪个音色作为 config.default（默认取第一个）
  --trim         用 ffmpeg 去掉首尾静音（edge-tts 输出自带 0.6~1.0s 静音，能省约 25% 体积并消除点读迟滞）
  --concurrency  并发数（默认 6）

产出
  audio/config.json              音色注册表 + 角色映射（前端读这个）
  audio/<音色>/index.json        { "日": "z/ri4.mp3", "日出": "w/ri4-1.mp3", ... }
  audio/<音色>/z/<拼音>.mp3      单字
  audio/<音色>/w/<拼音>-N.mp3    组词
  audio/<音色>/s/<拼音>.mp3      例句

多音字
  单字音频是"孤立音节"，TTS 会按常用读音念，可能与本站教的读音不一致。
  实测 316 字里有 6 个字属于这种情况，脚本用同音字替代合成（音频读音正确即可，不显示该字）：
      只 zhī →「支」  长 cháng →「常」  兴 xìng →「幸」  假 jià →「架」
  另有两个字找不到干净同音字，直接跳过单字音频、由前端回退浏览器 TTS，
  等切换到腾讯云后可用 <phoneme alphabet="py" ph="fa4">发</phoneme> 精确锁定：
      发 fà、谁 shéi
"""
import argparse, glob, hashlib, hmac, json, os, re, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio")

# ---------- 拼音：带声调 → 数字形式（文件名用） ----------
MARKS = {
 "ā":"a1","á":"a2","ǎ":"a3","à":"a4","a":"a5","ō":"o1","ó":"o2","ǒ":"o3","ò":"o4","o":"o5",
 "ē":"e1","é":"e2","ě":"e3","è":"e4","e":"e5","ī":"i1","í":"i2","ǐ":"i3","ì":"i4","i":"i5",
 "ū":"u1","ú":"u2","ǔ":"u3","ù":"u4","u":"u5","ǖ":"v1","ǘ":"v2","ǚ":"v3","ǜ":"v4","ü":"v5",
}
def pinyin_key(p):
    out = []
    for syl in re.split(r"[\s']+", (p or "").strip().lower()):
        if not syl:
            continue
        base, tone = [], "5"
        for ch in syl:
            m = MARKS.get(ch)
            if m:
                if m[-1] != "5":
                    tone = m[-1]
                base.append(m[:-1])
            else:
                base.append(ch)
        out.append("".join(base).replace("ü", "v") + tone)
    return "-".join(out)

# ---------- 音色标识 ----------
VOICE_LABELS = {
    "xiaoxiao": "晓晓", "xiaoyi": "晓伊", "yunjian": "云健", "yunxi": "云希",
    "yunxia": "云夏", "yunyang": "云扬", "xiaobei": "晓北", "xiaoni": "晓妮",
}
def slug_voice(name):
    n = re.sub(r"^zh-CN-", "", name)
    n = re.sub(r"Neural$", "", n)
    return re.sub(r"[^0-9a-zA-Z]+", "-", n).strip("-").lower() or name
def label_voice(name):
    return VOICE_LABELS.get(slug_voice(name), name)

# ---------- 多音字处理 ----------
SYNTH_AS = {"只": "支", "长": "常", "兴": "幸", "假": "架"}   # 单字：换同音字合成，读音才对
SKIP_SINGLE = {"发", "谁"}                                    # 单字：无干净同音字，交给前端 TTS 兜底

# ---------- 读字库 ----------
def load_chars():
    chars = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "chars-*.js"))):
        src = open(f, encoding="utf-8").read()
        for m in re.finditer(r'\{\s*c:\s*"(.*?)",\s*p:\s*"(.*?)",\s*w:\s*\[(.*?)\],\s*s:\s*"(.*?)"', src, re.S):
            chars.append({
                "c": m.group(1), "p": m.group(2),
                "w": re.findall(r'"([^"]*)"', m.group(3)),
                "s": m.group(4),
            })
    return chars

def text_hash(text):
    """文件名用「文本哈希」保证唯一：同音字（一/衣、一个/衣服）不能让两个键指向同一个文件"""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]

def build_tasks(chars, limit=None, group=None):
    """返回 [(kind, 文件名主干, 合成用文本, 索引键)]，kind ∈ z/w/s"""
    if group is not None:
        per = len(chars) // 10
        chars = chars[group * per:(group + 1) * per]
    if limit:
        chars = chars[:limit]
    tasks = []
    for ch in chars:
        c, py = ch["c"], pinyin_key(ch["p"])
        if c not in SKIP_SINGLE:
            tasks.append(("z", "%s-%s" % (py, text_hash(c)), SYNTH_AS.get(c, c), c))            # 单字
        for i, w in enumerate(ch["w"]):
            tasks.append(("w", "%s-%d-%s" % (py, i + 1, text_hash(w)), w, w))                   # 组词
        if ch["s"]:
            tasks.append(("s", "%s-%s" % (py, text_hash(ch["s"])), ch["s"], ch["s"]))           # 例句
    return tasks

# ---------- 引擎：edge-tts ----------
def gen_edge(bin_path, voice, rate, text, path):
    cmd = [bin_path, "--voice", voice, "--rate=%s" % rate, "--text", text, "--write-media", path]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not os.path.exists(path) or os.path.getsize(path) == 0:
        raise RuntimeError("edge-tts 失败: %s" % (r.stderr.decode("utf-8", "ignore")[:200]))

# ---------- 引擎：腾讯云 TTS（TC3-HMAC-SHA256 签名，标准库实现，无需 SDK） ----------
def _tc3_headers(secret_id, secret_key, payload_str, action="TextToVoice", version="2019-08-23"):
    host, service, region = "tts.tencentcloudapi.com", "tts", "ap-guangzhou"
    ts = int(datetime.now(timezone.utc).timestamp())
    date = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")
    hashed = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
    canonical = "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:%s\nx-tc-action:%s\n\ncontent-type;host;x-tc-action\n%s" % (
        host, action.lower(), hashed)
    scope = "%s/%s/tc3_request" % (date, service)
    to_sign = "TC3-HMAC-SHA256\n%d\n%s\n%s" % (ts, scope, hashlib.sha256(canonical.encode("utf-8")).hexdigest())

    def _hmac(key, msg):
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    k = _hmac(("TC3" + secret_key).encode("utf-8"), date)
    k = _hmac(k, service)
    k = _hmac(k, "tc3_request")
    sig = hmac.new(k, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "Authorization": "TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=content-type;host;x-tc-action, Signature=%s" % (
            secret_id, scope, sig),
        "Content-Type": "application/json; charset=utf-8",
        "Host": host, "X-TC-Action": action, "X-TC-Version": version,
        "X-TC-Timestamp": str(ts), "X-TC-Region": region,
    }

def gen_tencent(args, text, path):
    import base64, urllib.request
    body = {
        "Text": text, "SessionId": "siwen-%d" % (abs(hash(text)) % 10 ** 9),
        "VoiceType": int(args.voice), "Codec": "mp3", "SampleRate": 24000,
        "Speed": args.speed, "Volume": 0, "PrimaryLanguage": 1,
    }
    payload = json.dumps(body, ensure_ascii=False)
    headers = _tc3_headers(args.secret_id, args.secret_key, payload)
    req = urllib.request.Request("https://tts.tencentcloudapi.com", data=payload.encode("utf-8"),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    r = data.get("Response", {})
    if "Audio" not in r:
        raise RuntimeError("腾讯云返回错误: %s" % json.dumps(r, ensure_ascii=False)[:200])
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(r["Audio"]))

# ---------- 可选：去首尾静音 ----------
def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        from shutil import which
        return which("ffmpeg")

TRIM_AF = ("silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak,"
           "areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak,areverse")

MIN_BYTES = 500          # 生成产物的下限（实测坏文件只有 236 字节）
TRIM_MIN_BYTES = 900     # 去静音产物的下限：48kbps 下约 0.15s 真实语音。
                         # 只按绝对大小判断——短音节（二/八/大）本就该被裁掉九成,
                         # 用「不小于原文件 25%」会误伤它们并留下静音。

def sane(path):
    return os.path.exists(path) and os.path.getsize(path) >= MIN_BYTES

def trim(ffmpeg, path):
    """去首尾静音。silenceremove 偶尔会把整段判成静音，产出只有头的空文件 ——
       所以产物必须同时满足「够大」和「不小于原文件的一定比例」，否则保留原文件。

       注意:中间产物必须放**系统临时目录**。放在 audio/ 里的话，失败清理时的 unlink
       会被工作区的安全守卫拦下，异常会把整个批量任务带崩（实测踩过）。"""
    before = os.path.getsize(path)
    tmp = tempfile.mktemp(prefix="hztrim-", suffix=".mp3")
    r = subprocess.run([ffmpeg, "-y", "-i", path, "-af", TRIM_AF, "-c:a", "libmp3lame", "-b:a", "48k", tmp],
                       capture_output=True)
    if r.returncode == 0 and os.path.getsize(tmp) >= TRIM_MIN_BYTES and sane(tmp):
        try:
            os.replace(tmp, path)          # 同卷直接改名
            return True
        except OSError:
            try:
                shutil.copyfile(tmp, path)  # 跨卷则退回复制
                return True
            except OSError:
                pass
    if os.path.exists(tmp):
        try:
            os.remove(tmp)                 # 系统临时目录,不受工作区守卫限制
        except OSError:
            pass
    return False

# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["edge", "tencent"], default="edge")
    ap.add_argument("--voice", default="zh-CN-YunxiaNeural",
                    help="逗号分隔；edge 填音色名，tencent 填音色 ID（如 402000,403000）。第一个为默认音色")
    ap.add_argument("--edge-bin", default="edge-tts")
    ap.add_argument("--rate", default="-10%", help="edge-tts 语速（给幼儿听略慢一点）")
    ap.add_argument("--speed", type=float, default=-0.1, help="腾讯云语速，-2~2")
    ap.add_argument("--secret-id", default=os.environ.get("TENCENT_SECRET_ID", ""))
    ap.add_argument("--secret-key", default=os.environ.get("TENCENT_SECRET_KEY", ""))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--group", type=int)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--trim", action="store_true")
    ap.add_argument("--resume", action="store_true", help="跳过已生成的音频")
    ap.add_argument("--default-voice", default="", help="哪个音色作为 config.default（默认取第一个）")
    ap.add_argument("--retrim", action="store_true", help="只对已生成的音频重新去静音,不重新合成")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    voices = [v.strip() for v in args.voice.split(",") if v.strip()]
    if not voices:
        sys.exit("--voice 不能为空")
    keys = [slug_voice(v) for v in voices]
    default_key = slug_voice(args.default_voice) if args.default_voice else keys[0]
    if default_key not in keys:
        sys.exit("--default-voice %s 不在 --voice 列表里" % default_key)

    if args.engine == "tencent" and not args.dry_run and not (args.secret_id and args.secret_key):
        sys.exit("腾讯云引擎需要 --secret-id / --secret-key（或 TENCENT_SECRET_ID / TENCENT_SECRET_KEY）")

    if args.retrim:
        ff = find_ffmpeg()
        if not ff:
            sys.exit("--retrim 需要 ffmpeg（可 pip install imageio-ffmpeg）")
        total = done = 0
        for vk in keys:
            for kind in ("z", "w", "s"):
                d = os.path.join(OUT, vk, kind)
                if not os.path.isdir(d):
                    continue
                for f in sorted(os.listdir(d)):
                    if not f.endswith(".mp3"):
                        continue
                    total += 1
                    if trim(ff, os.path.join(d, f)):
                        done += 1
        print("重新去静音: 处理 %d 个, 成功 %d 个" % (total, done))
        return

    chars = load_chars()
    tasks = build_tasks(chars, args.limit, args.group)
    print("字库 %d 字 → 每条音色 %d 条（单字 %d / 组词 %d / 例句 %d）" % (
        len(chars), len(tasks),
        sum(1 for t in tasks if t[0] == "z"), sum(1 for t in tasks if t[0] == "w"),
        sum(1 for t in tasks if t[0] == "s")))
    print("音色: %s" % "、".join("%s(%s)" % (label_voice(v), slug_voice(v)) for v in voices))
    print("默认音色: %s" % default_key)

    if args.dry_run:
        for kind, stem, text, key in tasks[:20]:
            print("   %s %-14s ← %s" % (kind, stem, text))
        if len(tasks) > 20:
            print("   …其余 %d 条" % (len(tasks) - 20))
        skipped = sorted(SKIP_SINGLE & {c["c"] for c in chars})
        print("跳过的单字（前端回退浏览器 TTS）: %s" % ("、".join(skipped) or "无"))
        return

    ffmpeg = find_ffmpeg() if args.trim else None
    if args.trim and not ffmpeg:
        print("⚠️ 未找到 ffmpeg，--trim 忽略（可 pip install imageio-ffmpeg）")

    # 同一文本只合成一次
    seen, uniq = {}, []
    for kind, stem, text, key in tasks:
        if key in seen:
            continue
        seen[key] = True
        uniq.append((kind, stem, text, key))

    # 预检:文件名必须与文本一一对应,否则索引会指错音频
    paths = {}
    for kind, stem, text, key in uniq:
        rel = "%s/%s.mp3" % (kind, stem)
        if rel in paths and paths[rel] != key:
            sys.exit("❌ 文件名冲突: %s 同时对应「%s」和「%s」" % (rel, paths[rel], key))
        paths[rel] = key

    reg = {}
    for vi, voice in enumerate(voices):
        vkey = keys[vi]
        vdir = os.path.join(OUT, vkey)
        for kind in ("z", "w", "s"):
            os.makedirs(os.path.join(vdir, kind), exist_ok=True)

        errs = []
        warn_trim = []
        done = [0]

        def work(item):
            kind, stem, text, key = item
            rel = "%s/%s.mp3" % (kind, stem)
            path = os.path.join(vdir, rel)
            if args.resume and os.path.exists(path) and os.path.getsize(path) > 0:
                return (key, rel, None)
            last = None
            for attempt in range(3):                     # 失败重试 3 次（网络抖动/限流）
                try:
                    if args.engine == "edge":
                        gen_edge(args.edge_bin, voice, args.rate, text, path)
                    else:
                        gen_tencent(args, text, path)
                    if not sane(path):       # 服务偶发返回空音频,重试
                        raise RuntimeError("产出异常(%s 字节)" % (os.path.getsize(path) if os.path.exists(path) else 0))
                    if ffmpeg and not trim(ffmpeg, path):
                        warn_trim.append("%s(%s)" % (stem, text[:6]))
                    return (key, rel, None)
                except KeyboardInterrupt:
                    raise
                except BaseException as e:     # 含沙箱策略异常:记录后继续,别让一条坏数据带崩整批
                    last = "%s: %s" % (type(e).__name__, e)
                    time.sleep(0.8 * (attempt + 1))
            errs.append("%s: %s" % (text[:8], last))
            return (key, None, last)

        print("\n▶ 生成音色 %s（%s）" % (label_voice(voice), voice))
        index = {}
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            for key, rel, err in ex.map(work, uniq):
                done[0] += 1
                if rel:
                    index[key] = rel
                if done[0] % 200 == 0 or done[0] == len(uniq):
                    print("   进度 %d/%d" % (done[0], len(uniq)))

        with open(os.path.join(vdir, "index.json"), "w", encoding="utf-8") as fh:
            json.dump(index, fh, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

        reg[vkey] = {
            "label": label_voice(voice), "engine": args.engine, "voice": voice,
            "count": len(index), "dir": vkey,
        }
        if errs:
            print("   ⚠️ 失败 %d 条（前 3 条）: %s" % (len(errs), " | ".join(errs[:3])))
        if warn_trim:
            print("   ℹ️ %d 条未能去静音（已保留原文件）: %s" % (len(warn_trim), "、".join(warn_trim[:4])))

    config = {
        "default": default_key,
        "voices": reg,
        "roles": {},          # 接入 IP 后填：{"char":"xiaoyi","sentence":"yunxia", ...}
    }
    with open(os.path.join(OUT, "config.json"), "w", encoding="utf-8") as fh:
        json.dump(config, fh, ensure_ascii=False, indent=2, sort_keys=True)

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(OUT) for f in fs)
    print("\n完成：%d 个音色，config.json 已写入；audio/ 合计 %.1f MB" % (len(reg), size / 1048576))


if __name__ == "__main__":
    main()
