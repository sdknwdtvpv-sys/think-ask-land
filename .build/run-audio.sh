#!/usr/bin/env bash
# ============================================================
# 思问岛 · 预置音频补齐向导
#
# 为什么要有它:生成音频要经过"设密钥 → 小样试听 → 全量补齐 → 校验 → 上线"五步,
# 手动敲命令容易漏步、也容易把密钥写进终端历史。这个脚本把它们串成一条命令:
#   · 密钥用隐藏输入(不回显、不入 history),用完即从环境变量里清掉
#   · 先只生成几条让你试听,满意了再跑全量(不满意随时停,不浪费额度)
#   · 每一步都打印"看到什么算成功",出错时给中文对照提示
#
# 用法:
#   bash .build/run-audio.sh
#   (已经有环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 时会跳过输入)
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."

VOICE_MAIN="502007:tc-502007:智小虎"
VOICE_ALL="502007:tc-502007:智小虎,403000:tc-403000:云小朵"

say()  { printf "%s\n" "$*"; }
line() { printf -- "------------------------------------------------------------\n"; }

line
say "思问岛 · 预置朗读音频补齐向导"
line
say "接下来会做 5 件事:"
say "  1) 检查现在缺多少条"
say "  2) 用你的密钥生成 3 个字 + 10 句口播,让你先试听"
say "  3) 你满意后再补齐全部"
say "  4) 自动校验是否补齐"
say "  5) 问你要不要直接上线"
say ""
say "⚠️  密钥只在本窗口使用,不会被保存、也不会写进命令历史。"
line

# ---------- 0. 环境检查 ----------
command -v python3 >/dev/null 2>&1 || { say "❌ 找不到 python3。请把这句话发我,我给你别的办法。"; exit 1; }

# ---------- 1. 取密钥(优先环境变量) ----------
SID="${TENCENT_SECRET_ID:-}"
SKEY="${TENCENT_SECRET_KEY:-}"
if [ -z "$SID" ] || [ -z "$SKEY" ]; then
  say "请粘贴你的两串密钥(在 https://console.cloud.tencent.com/cam/capi 里,SecretKey 点「显示」):"
  printf "  SecretId  (AKID 开头): "
  read -r SID
  printf "  SecretKey (输入时不显示,粘贴后直接回车): "
  read -r -s SKEY
  echo
fi
if [ -z "$SID" ] || [ -z "$SKEY" ]; then
  say "❌ 两个都不能为空,请重新运行。"
  exit 1
fi
export TENCENT_SECRET_ID="$SID"
export TENCENT_SECRET_KEY="$SKEY"
say "✅ 已读取密钥(SecretId 前 8 位:${SID:0:8}****)"
line

# 友好的报错翻译:把腾讯云的英文错误码翻成"下一步做什么"
hint_for() {
  case "$1" in
    *AuthFailure.SignatureFailure*|*AuthFailure.SignatureExpire*)
      say "❌ 密钥不正确(常见原因:复制时多了空格或换行)。"
      say "   请重新复制 SecretId / SecretKey,注意前后不要带空格,再跑一次本向导。" ;;
    *AuthFailure.SecretIdNotFound*)
      say "❌ 这个 SecretId 不存在(可能已被删除)。"
      say "   请到 https://console.cloud.tencent.com/cam/capi 重新建一个密钥。" ;;
    *FailedOperation*|*欠费*|*额度*|*FreeAmount*)
      say "❌ 免费额度没领或已用完。"
      say "   请到 https://console.cloud.tencent.com/tts/resourcebundle 领取「基础/精品音色」免费额度(800 万字符)。" ;;
    *RequestLimitExceeded*)
      say "❌ 请求太频繁。请把本脚本里的 --concurrency 6 改成 --concurrency 2 再跑。" ;;
    *)
      say "❌ 上面这段报错我看不懂没关系 —— 把它整段复制发我即可(里面不含密钥)。" ;;
  esac
}

# ---------- 2. 当前缺口 ----------
say "【1/5】检查当前缺多少条…"
CHECK_OUT="$(python3 .build/gen-audio.py --check 2>&1)"
printf "%s\n" "$CHECK_OUT" | tail -4
if printf "%s" "$CHECK_OUT" | grep -q "覆盖完整"; then
  say "🎉 音频已经是完整的,不需要生成。"
  line
  read -r -p "仍要重新生成一遍吗?(y/N) " AGAIN
  case "$AGAIN" in y|Y) ;; *) say "已退出。"; exit 0 ;; esac
fi
line

# ---------- 3. 小样试听 ----------
say "【2/5】先生成小样(3 个字 + 10 句口播)…"
SAMPLE_OUT="$(python3 .build/gen-audio.py --engine tencent --voice "$VOICE_MAIN" --only 今,夜,羞 --trim 2>&1)"
SAMPLE_CODE=$?
printf "%s\n" "$SAMPLE_OUT" | tail -3
if [ "$SAMPLE_CODE" != "0" ]; then
  # 生成器在"一条都没成功"时会返回非 0 并打印中文指引,这里再翻一层成"下一步做什么"
  hint_for "$SAMPLE_OUT"; exit 1
fi
line
say "试听文件在这里(正在帮你打开访达窗口):"
say "  audio/tc-502007/p  ← 口播:「答对了,真棒」等 10 句"
say "  audio/tc-502007/z  ← 单字:今 / 夜 / 羞"
open audio/tc-502007/p 2>/dev/null || true
open audio/tc-502007/z 2>/dev/null || true
line
say "听完后:"
say "  · 满意 → 输入 y 继续补齐全部"
say "  · 想换音色/不好听 → 输入 n 停下,告诉我你的感觉,我给你换音色的命令"
read -r -p "继续吗?(y/n) " GO
case "$GO" in
  y|Y) ;;
  *) say "已停下,没有继续消耗额度。把试听感受告诉我就行。"; exit 0 ;;
esac
line

# ---------- 4. 全量补齐 ----------
say "【3/5】补齐全部缺口(两个音色,约 2~5 分钟)…"
say "   中途断了不要紧:重新运行本向导会自动跳过已生成的。"
FULL_OUT="$(python3 .build/gen-audio.py --engine tencent --voice "$VOICE_ALL" --resume --trim --concurrency 6 2>&1)"
FULL_CODE=$?
printf "%s\n" "$FULL_OUT" | tail -5
if [ "$FULL_CODE" != "0" ]; then
  hint_for "$FULL_OUT"
  say "   (已经生成成功的部分不会白费:再跑一次本向导会自动接着补。)"
  exit 1
fi
line

# ---------- 5. 校验 ----------
say "【4/5】校验是否补齐…"
FINAL_OUT="$(python3 .build/gen-audio.py --check 2>&1)"
printf "%s\n" "$FINAL_OUT" | tail -4
if ! printf "%s" "$FINAL_OUT" | grep -q "覆盖完整"; then
  say "⚠️ 还有缺口。把上面这几行发我(通常是字库刚改过,再跑一次向导即可)。"
else
  say "✅ 音频已完整。"
fi
line

# ---------- 6. 上线 ----------
unset TENCENT_SECRET_ID TENCENT_SECRET_KEY
say "🔒 已从本窗口清除密钥。你现在可以去 https://console.cloud.tencent.com/cam/capi 把它「禁用」,以后要用再启用。"
line
say "【5/5】现在上线到 https://hanzi.elliotli.work ?"
say "  上线会把音频一起传到服务器,大约 3 分钟。"
read -r -p "上线吗?(y/n) " DEP
if [ "$DEP" = "y" ] || [ "$DEP" = "Y" ]; then
  ./deploy/release.sh "补齐预置朗读音频(84 个新字 + 10 句口播)"
else
  say "已跳过上线。想上线时运行: ./deploy/release.sh \"补齐预置朗读音频\""
fi
line
say "全部完成。手机上看效果时,建议先把主屏幕图标删掉重新添加,避免旧缓存。"
