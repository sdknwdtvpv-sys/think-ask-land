#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
思问岛 · 预置朗读音频生成器

把字库里的 316 单字 / 632 组词 / 316 例句合成为 mp3，并生成 audio/index.json。
索引以「文本」为键，前端 Speech.speak(text) 直接查表 —— 页面代码零改动，查不到就回退浏览器 TTS。

用法
  # 引擎一：edge-tts（免密钥，仅用于快速验证；非官方接口，勿用于正式发布）
  python3 .build/gen-audio.py --engine edge --voice zh-CN-XiaoyiNeural

  # 引擎二：腾讯云 TTS（推荐正式使用：官方允许商用 + 拼音音素锁多音字）
  python3 .build/gen-audio.py --engine tencent --voice 402000 \
      --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY"

常用参数
  --limit N      只生成前 N 个字（先小样验证）
  --group N      只生成第 N 组（0 基）
  --dry-run      只打印将要生成的条目，不调用任何服务
  --trim         用 ffmpeg 去掉首尾静音（edge-tts 输出自带 0.6~1.0s 静音，能省约 25% 体积并消除点读迟滞）
  --concurrency  并发数（默认 6）

产出
  audio/z/<拼音>.mp3      单字
  audio/w/<拼音>-N.mp3    组词
  audio/s/<拼音>.mp3      例句
  audio/index.json        { "日": "audio/z/ri4.mp3", "日出": "audio/w/ri4-1.mp3", ... }

多音字
  单字音频是"孤立音节"，TTS 会按常用读音念，可能与本站教的读音不一致。
  实测 316 字里有 6 个字属于这种情况，脚本用同音字替代合成（音频读音正确即可，不显示该字）：
      只 zhī →「支」  长 cháng →「常」  兴 xìng →「幸」  假 jià →「架」
  另有两个字找不到干净同音字，直接跳过单字音频、由前端回退浏览器 TTS，
  等切换到腾讯云后可用 <phoneme alphabet="py" ph="fa4">发</phoneme> 精确锁定：
      发 fà、谁 shéi
"""
import argparse, glob, hashlib, hmac, json, os, re, subprocess, sys
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

def build_tasks(chars, limit=None, group=None):
    """返回 [(kind, 文件名主干, 合成用文本)]，kind ∈ z/w/s"""
    if group is not None:
        per = len(chars) // 10
        chars = chars[group * per:(group + 1) * per]
    if limit:
        chars = chars[:limit]
    tasks = []
    for ch in chars:
        c, py = ch["c"], pinyin_key(ch["p"])
        if c not in SKIP_SINGLE:
            tasks.append(("z", py, SYNTH_AS.get(c, c), c))            # 单字
        for i, w in enumerate(ch["w"]):
            tasks.append(("w", "%s-%d" % (py, i + 1), w, w))          # 组词
        if ch["s"]:
            tasks.append(("s", py, ch["s"], ch["s"]))                 # 例句
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

def trim(ffmpeg, path):
    tmp = path + ".trim.mp3"
    r = subprocess.run([ffmpeg, "-y", "-i", path, "-af", TRIM_AF, "-c:a", "libmp3lame", "-b:a", "48k", tmp],
                       capture_output=True)
    if r.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 0:
        os.replace(tmp, path)
    else:
        if os.path.exists(tmp):
            os.remove(tmp)
        print("   ⚠️ 去静音失败，保留原文件: %s" % os.path.basename(path))

# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["edge", "tencent"], default="edge")
    ap.add_argument("--voice", default="zh-CN-XiaoyiNeural",
                    help="edge: 音色名；tencent: 音色 ID（如 402000）")
    ap.add_argument("--edge-bin", default="edge-tts")
    ap.add_argument("--rate", default="-10%", help="edge-tts 语速（给幼儿听略慢一点）")
    ap.add_argument("--speed", type=float, default=-0.1, help="腾讯云语速，-2~2")
    ap.add_argument("--secret-id", default=os.environ.get("TENCENT_SECRET_ID", ""))
    ap.add_argument("--secret-key", default=os.environ.get("TENCENT_SECRET_KEY", ""))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--group", type=int)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--trim", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.engine == "tencent" and not args.dry_run and not (args.secret_id and args.secret_key):
        sys.exit("腾讯云引擎需要 --secret-id / --secret-key（或 TENCENT_SECRET_ID / TENCENT_SECRET_KEY）")

    chars = load_chars()
    tasks = build_tasks(chars, args.limit, args.group)
    print("字库 %d 字 → 本次合成 %d 条（单字 %d / 组词 %d / 例句 %d）" % (
        len(chars), len(tasks),
        sum(1 for t in tasks if t[0] == "z"), sum(1 for t in tasks if t[0] == "w"),
        sum(1 for t in tasks if t[0] == "s")))
    if args.engine == "edge" and not args.dry_run:
        print("音色 %s（语速 %s）" % (args.voice, args.rate))
    if args.engine == "tencent" and not args.dry_run:
        print("音色 ID %s（语速 %.2f）" % (args.voice, args.speed))

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

    index = {}
    for kind in ("z", "w", "s"):
        os.makedirs(os.path.join(OUT, kind), exist_ok=True)
    # 同一文本只合成一次
    seen, uniq = {}, []
    for kind, stem, text, key in tasks:
        if key in seen:
            continue
        seen[key] = True
        uniq.append((kind, stem, text, key))

    lock_err = []

    def work(item):
        kind, stem, text, key = item
        path = os.path.join(OUT, kind, "%s.mp3" % stem)
        try:
            if args.engine == "edge":
                gen_edge(args.edge_bin, args.voice, args.rate, text, path)
            else:
                gen_tencent(args, text, path)
            if ffmpeg:
                trim(ffmpeg, path)
            return (key, "%s/%s.mp3" % (kind, stem), None)
        except Exception as e:
            lock_err.append(str(e))
            return (key, None, str(e))

    done = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        for key, rel, err in ex.map(work, uniq):
            done += 1
            if rel:
                index[key] = rel
            if done % 50 == 0 or done == len(uniq):
                print("   进度 %d/%d" % (done, len(uniq)))

    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(OUT) for f in fs)
    print("\n完成：%d 条音频，index.json %d 项，合计 %.1f MB" % (len(index), len(index), size / 1048576))
    if lock_err:
        print("失败 %d 条（前 3 条）:" % len(lock_err))
        for e in lock_err[:3]:
            print("   " + e)

if __name__ == "__main__":
    main()
