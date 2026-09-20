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

  # 引擎二：Azure 语音服务（与 edge-tts 同一批音色，保听感不变；付费层明确可商用）
  python3 .build/gen-audio.py --engine azure --voice zh-CN-YunxiaNeural,zh-CN-XiaoyiNeural \
      --azure-key "$AZURE_SPEECH_KEY" --azure-region eastasia --trim

  # 引擎三：腾讯云 TTS（国内厂商：官方允许商用，音色是腾讯自己的，与云夏/晓伊不同）
  # 音色写法 ID[:目录名[:显示名]]，用别名可以让腾讯云音色直接覆盖到原目录，
  # 这样 config.json 里的 roles 配置不用改：
  python3 .build/gen-audio.py --engine tencent --voice "402000:yunxia:云夏,403000:xiaoyi:晓伊" \
      --secret-id "$TENCENT_SECRET_ID" --secret-key "$TENCENT_SECRET_KEY" --trim

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
import argparse, glob, hashlib, hmac, html, json, os, re, shutil, subprocess, sys, tempfile, time
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
# edge-tts 不支持 SSML/音素，只能用同音字替代；腾讯云支持 <phoneme alphabet="py">，可以直接锁音。
SYNTH_AS = {"只": "支", "长": "常", "兴": "幸", "假": "架"}   # 仅 edge：换同音字合成，读音才对
SKIP_SINGLE = {"发", "谁"}                                    # 仅 edge：无干净同音字，交给前端 TTS 兜底

# 腾讯云：拼音 + 声调数字（1 阴平 / 2 阳平 / 3 上声 / 4 去声 / 5 轻声）
PHONEME = {
    "只": "zhi1", "长": "chang2", "兴": "xing4",
    "假": "jia4", "发": "fa4", "谁": "shei2",
}

# Azure 的拼音音素写法是 alphabet="sapi" + 拼音与声调用空格隔开
AZURE_PHONEME = {
    "只": "zhi 1", "长": "chang 2", "兴": "xing 4",
    "假": "jia 4", "发": "fa 4", "谁": "shei 2",
}

def ssml_phoneme(ch):
    """把单字包成 SSML，用拼音音素锁死读音（腾讯云 TTS）"""
    return '<speak><phoneme alphabet="py" ph="%s">%s</phoneme></speak>' % (PHONEME[ch], ch)

def ssml_azure(ch, voice):
    """Azure 的 SSML：<voice> 里放 <phoneme alphabet="sapi">"""
    return ('<speak version="1.0" xml:lang="zh-CN"><voice name="%s">'
            '<phoneme alphabet="sapi" ph="%s">%s</phoneme></voice></speak>') % (voice, AZURE_PHONEME[ch], ch)

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

def build_tasks(chars, limit=None, group=None, engine="edge", voice=""):
    """返回 [(kind, 文件名主干, 合成用文本, 索引键)]，kind ∈ z/w/s"""
    if group is not None:
        per = len(chars) // 10
        chars = chars[group * per:(group + 1) * per]
    if limit:
        chars = chars[:limit]
    tasks = []
    for ch in chars:
        c, py = ch["c"], pinyin_key(ch["p"])
        if engine == "tencent":
            text = ssml_phoneme(c) if c in PHONEME else c        # 音素锁读音，发/谁 也能生成
        elif engine == "azure":
            text = ssml_azure(c, voice) if c in PHONEME else c   # 同上，Azure 用 sapi 拼音
        else:
            text = SYNTH_AS.get(c, c) if c not in SKIP_SINGLE else None   # edge 只能同音字替代
        if text is not None:
            tasks.append(("z", "%s-%s" % (py, text_hash(c)), text, c))                          # 单字
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

# ---------- 引擎：Azure 语音服务 ----------
def gen_azure(args, voice, text, path):
    """POST SSML 到 Azure 语音服务，直接拿 mp3。
       注意：免费层(F0)的商用权在条款上有争议，正式发布请用付费层(S0)。"""
    import urllib.request
    url = "https://%s.tts.speech.microsoft.com/cognitiveservices/v1" % args.azure_region
    if text.lstrip().startswith("<speak"):
        ssml = text
    else:
        ssml = ('<speak version="1.0" xml:lang="zh-CN"><voice name="%s">'
                '<prosody rate="%s">%s</prosody></voice></speak>') % (voice, args.rate, html.escape(text, quote=False))
    req = urllib.request.Request(url, data=ssml.encode("utf-8"), method="POST", headers={
        "Ocp-Apim-Subscription-Key": args.azure_key,
        "Content-Type": "application/ssml+xml; charset=utf-8",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "siwen-island",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if len(data) < MIN_BYTES:
        raise RuntimeError("Azure 返回内容过短(%d 字节)，多半是 SSML 被拒" % len(data))
    with open(path, "wb") as fh:
        fh.write(data)


# ---------- 引擎：腾讯云 TTS（TC3-HMAC-SHA256 签名，标准库实现，无需 SDK） ----------
def _tc3_headers(secret_id, secret_key, payload_str, action="TextToVoice", version="2019-08-23",
                 service="tts", host="tts.tencentcloudapi.com", region="ap-guangzhou", timestamp=None):
    ts = int(timestamp or datetime.now(timezone.utc).timestamp())
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

def gen_tencent(args, voice_id, text, path):
    import base64, urllib.request
    body = {
        "Text": text, "SessionId": "siwen-%d" % (abs(hash(text)) % 10 ** 9),
        "VoiceType": int(voice_id), "Codec": "mp3", "SampleRate": 24000,
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

# ---------- 签名自检：用官方文档《签名方法 v3》的示例向量核对实现 ----------
SIGN_VECTOR = {
    "service": "cvm", "host": "cvm.tencentcloudapi.com", "region": "ap-guangzhou",
    "action": "DescribeInstances", "version": "2017-03-12", "timestamp": 1551113065,
    "payload": '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}',
    "hashed_payload": "35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064",
    "hashed_canonical": "7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84",
    "signature": "10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f",
}

def selftest_sign():
    v = SIGN_VECTOR
    ok = True
    hashed = hashlib.sha256(v["payload"].encode("utf-8")).hexdigest()
    print("① 请求正文哈希  %s  %s" % (hashed, "✓" if hashed == v["hashed_payload"] else "✗ 期望 " + v["hashed_payload"]))
    ok &= hashed == v["hashed_payload"]

    canonical = ("POST\n/\n\n"
                 "content-type:application/json; charset=utf-8\n"
                 "host:%s\nx-tc-action:%s\n\n"
                 "content-type;host;x-tc-action\n%s") % (v["host"], v["action"].lower(), hashed)
    hcanon = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    print("② 规范请求串哈希 %s  %s" % (hcanon, "✓" if hcanon == v["hashed_canonical"] else "✗ 期望 " + v["hashed_canonical"]))
    ok &= hcanon == v["hashed_canonical"]

    # 官方文档把密钥打码成 N 个星号，逐个长度试出与文档中间值一致的那个，顺带验证 HMAC 链
    matched = None
    for n in range(24, 40):
        hdrs = _tc3_headers("AKID" + "*" * n, "*" * n, v["payload"], v["action"], v["version"],
                            v["service"], v["host"], v["region"], v["timestamp"])
        sig = hdrs["Authorization"].rsplit("Signature=", 1)[1]
        if sig == v["signature"]:
            matched = n
            break
    if matched:
        print("③ 最终签名      %s  ✓（密钥星号数 %d，HMAC 派生链正确）" % (v["signature"], matched))
    else:
        print("③ 最终签名      ✗ 未能在 24~39 个星号内复现文档签名")
        ok = False
    print("\n签名自检: %s" % ("通过 ✅" if ok else "失败 ❌"))
    return 0 if ok else 1


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["edge", "azure", "tencent"], default="edge")
    ap.add_argument("--voice", default="zh-CN-YunxiaNeural",
                    help="逗号分隔；edge 填音色名，tencent 填音色 ID（如 402000,403000）。第一个为默认音色")
    ap.add_argument("--edge-bin", default="edge-tts")
    ap.add_argument("--rate", default="-10%", help="edge-tts 语速（给幼儿听略慢一点）")
    ap.add_argument("--speed", type=float, default=-0.1, help="腾讯云语速，-2~2")
    ap.add_argument("--azure-key", default=os.environ.get("AZURE_SPEECH_KEY", ""))
    ap.add_argument("--azure-region", default=os.environ.get("AZURE_SPEECH_REGION", "eastasia"))
    ap.add_argument("--secret-id", default=os.environ.get("TENCENT_SECRET_ID", ""))
    ap.add_argument("--secret-key", default=os.environ.get("TENCENT_SECRET_KEY", ""))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--group", type=int)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--trim", action="store_true")
    ap.add_argument("--resume", action="store_true", help="跳过已生成的音频")
    ap.add_argument("--default-voice", default="", help="哪个音色作为 config.default（默认取第一个）")
    ap.add_argument("--retrim", action="store_true", help="只对已生成的音频重新去静音,不重新合成")
    ap.add_argument("--check", action="store_true", help="只检查现有音频是否覆盖当前字库(内容改动后会出现缺口)")
    ap.add_argument("--selftest-sign", action="store_true", help="用官方示例向量自检腾讯云签名实现")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    voices = []
    for spec in args.voice.split(","):
        spec = spec.strip()
        if not spec:
            continue
        parts = spec.split(":")
        vid = parts[0].strip()
        key = (parts[1].strip() if len(parts) > 1 and parts[1].strip() else slug_voice(vid))
        label = (parts[2].strip() if len(parts) > 2 and parts[2].strip() else label_voice(vid))
        voices.append({"id": vid, "key": key, "label": label})
    if not voices:
        sys.exit("--voice 不能为空")
    keys = [v["key"] for v in voices]
    default_key = (args.default_voice.strip() if args.default_voice else keys[0])
    if default_key not in keys:
        sys.exit("--default-voice %s 不在 --voice 列表里" % default_key)

    if args.engine == "tencent" and not args.dry_run and not (args.secret_id and args.secret_key):
        sys.exit("腾讯云引擎需要 --secret-id / --secret-key（或 TENCENT_SECRET_ID / TENCENT_SECRET_KEY）")
    if args.engine == "azure" and not args.dry_run and not args.azure_key:
        sys.exit("Azure 引擎需要 --azure-key（或 AZURE_SPEECH_KEY）")

    if args.selftest_sign:
        sys.exit(selftest_sign())

    if args.check:
        chars_all = load_chars()
        want = {t[3] for t in build_tasks(chars_all, None, None, args.engine)}
        bad = 0
        cfg_file = os.path.join(OUT, "config.json")
        if os.path.exists(cfg_file):
            keys = sorted(json.load(open(cfg_file, encoding="utf-8")).get("voices", {}).keys()) or keys
        for vk in keys:
            idx_path = os.path.join(OUT, vk, "index.json")
            if not os.path.exists(idx_path):
                print("❌ %s: 没有 index.json（尚未生成）" % vk)
                bad += 1
                continue
            have = set(json.load(open(idx_path, encoding="utf-8")).keys())
            miss = want - have
            extra = have - want
            print("%s %s: 覆盖 %d/%d" % ("✅" if not miss else "⚠️", vk, len(want & have), len(want)),
                  end="")
            if miss:
                print("  缺 %d 条（内容改过？需重新生成）: %s" % (len(miss), "、".join(list(miss)[:5])))
                bad += 1
            else:
                print("  无缺口" + ("；另有 %d 条已废弃" % len(extra) if extra else ""))
        sys.exit(1 if bad else 0)

    if args.retrim:
        ff = find_ffmpeg()
        if not ff:
            sys.exit("--retrim 需要 ffmpeg（可 pip install imageio-ffmpeg）")
        cfg_file = os.path.join(OUT, "config.json")
        if os.path.exists(cfg_file):
            keys = sorted(json.load(open(cfg_file, encoding="utf-8")).get("voices", {}).keys()) or keys
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
    tasks = build_tasks(chars, args.limit, args.group, args.engine, voices[0]["id"] if voices else "")
    print("字库 %d 字 → 每条音色 %d 条（单字 %d / 组词 %d / 例句 %d）" % (
        len(chars), len(tasks),
        sum(1 for t in tasks if t[0] == "z"), sum(1 for t in tasks if t[0] == "w"),
        sum(1 for t in tasks if t[0] == "s")))
    print("音色: %s" % "、".join("%s(%s←%s)" % (v["label"], v["key"], v["id"]) for v in voices))
    print("默认音色: %s" % default_key)

    if args.dry_run:
        for kind, stem, text, key in tasks[:20]:
            print("   %s %-14s ← %s" % (kind, stem, text))
        if len(tasks) > 20:
            print("   …其余 %d 条" % (len(tasks) - 20))
        if args.engine == "edge":
            skipped = sorted(SKIP_SINGLE & {c["c"] for c in chars})
            print("跳过的单字（前端回退浏览器 TTS）: %s" % ("、".join(skipped) or "无"))
        else:
            print("多音字全部以 SSML 拼音音素锁定（无跳过）: %s" % "、".join(sorted(PHONEME)))
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
        vkey = voice["key"]
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
                        gen_edge(args.edge_bin, voice["id"], args.rate, text, path)
                    elif args.engine == "azure":
                        gen_azure(args, voice["id"], text, path)
                    else:
                        gen_tencent(args, voice["id"], text, path)
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

        print("\n▶ 生成音色 %s（%s → audio/%s/）" % (voice["label"], voice["id"], vkey))
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
            "label": voice["label"], "engine": args.engine, "voice": voice["id"],
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
