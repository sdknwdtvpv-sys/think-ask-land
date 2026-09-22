/* 思问岛 · 配图(emoji)批量补充工具
   背景:字库里"能配图但还没图"的字,会让"看图猜字/看图选字"用不上它们。
        本工具按**同岛唯一**规则批量补图:候选表里的备选按优先级挑,
        挑不到就**放弃**(宁可少,不可错 —— 配错图比不配图更糟)。
   用法:
     node .build/emoji-augment.js            # 只报告,不改文件
     node .build/emoji-augment.js --apply    # 写回 data/emoji-extra.js
   候选依据:每个字都按它**在字库里教的组词/例句**选图(如"颈"的例句是长颈鹿 → 🦒),
            不接受"意思沾边但孩子会认错"的图。
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { ROOT, DB, emojiOf } = require("./load-chars");

/* 候选表:字 → [备选1, 备选2, …];依"该字在库里的义项"选图 */
const CANDIDATES = {
  /* —— 岛3 我的身体 —— */
  "头": ["👤"],              /* 我抬起[头]看星星 */
  "血": ["🩸"],              /* [血]液在身体里流动 */
  "颈": ["🦒"],              /* 长[颈]鹿的颈很长 */
  "掌": ["👏"],              /* 我们一起为小朋友鼓[掌] */
  /* —— 岛7 颜色与样子 —— */
  "青": ["🐸"],              /* [青]蛙穿着青色的衣裳 */
  "灰": ["🐘"],              /* 大象是[灰]色的 */
  "颜": ["🎨"],              /* 彩虹有七种[颜]色 */
  "弯": ["🌙"],              /* [弯]弯的月亮像小船 */
  "净": ["🧼"],              /* 我把手洗得干干净[净] */
  "扁": ["🦆"],              /* 小鸭的嘴巴[扁]扁的 */
  /* —— 岛9 感觉与状态 —— */
  "困": ["🥱", "😴"],        /* 我[困]了,想睡觉 */
  "晕": ["😵‍💫", "😵"],        /* 坐车太久会头[晕] */
  "爽": ["🍃"],              /* 秋天的风很凉[爽] */
  "吵": ["📢"],              /* 太[吵]了,我听不清 */
  /* —— 岛11 时间与季节 —— */
  "永": ["♾️"],              /* 我们[永]远是好朋友 */
  "顿": ["🍚"],              /* 我吃了一[顿]香喷喷的饭 */
  /* —— 岛12 方位与空间 —— */
  "央": ["🎯"],              /* 我站在队伍的[央](中央) */
  "圈": ["⭕"],              /* 我在地上画了一个圆[圈] */
  "隔": ["🧱"],              /* [隔]壁住着一位老奶奶 */
  /* —— 岛13 情绪与社交 —— */
  "悲": ["😢"],              /* 小兔找不到妈妈,很[悲]伤 */
  "慰": ["🫂"],              /* 我安[慰]哭了的小朋友 */
  "敬": ["🫡"],              /* 我们向老师[敬]礼 */
  "诚": ["😇"],              /* 做人要[诚]实 */
  "勇": ["💪", "🦁"],        /* 我要做个[勇]敢的孩子 */
  /* —— 岛14 常用字与连接 —— */
  "叫": ["📣"],              /* [叫]:喊出声 */
  "别": ["🚫"],              /* [别]:不要 */
  "跟": ["👣"],              /* [跟]:跟在后面走 */
  /* —— 岛15 学校与学习 —— */
  "同": ["👫"],              /* 我和[同]学一起玩 */
  "习": ["✏️"],              /* 我在学[习]写字 */
  "室": ["🏫"],              /* 教[室]里很安静 */
  "册": ["📚"],              /* 这本画[册]很好看 */
  "答": ["🙋"],              /* 我举手回[答]问题 */
  "考": ["🤔"],              /* 老师说要动脑筋思[考] */
  "词": ["💬"],              /* 这个[词]我认识 */
  "尺": ["📏"],              /* 我用[尺]子画直线 */
  "橡": ["🧽"],              /* 我用[橡]皮擦掉错字 */
  "座": ["🪑"],              /* 我找到了自己的[座]位 */
  "组": ["👥"],              /* 我们小[组]一起做手工 */
  "队": ["🚩"],              /* [队]伍排得真整齐 */
  /* —— 批 3(v2.11.0):132 个新字里"能配图"的那些。
        只有具体名词/清晰动作才配 —— 本批以功能字为主,所以能配图的很少,这是正常的。 —— */
  "乌": ["🐦‍⬛"],            /* [乌]鸦 */
  "鸦": ["🐦‍⬛", "🪶"],       /* [鸦]:乌鸦 */
  "窝": ["🪹", "🏠"],         /* 鸟[窝] */
  "壳": ["🐚"],              /* 龟[壳] */
  "莲": ["🪷"],              /* [莲]花 */
  "竹": ["🎋", "🎍"],        /* [竹]子 */
  "粥": ["🥣"],              /* 米[粥] */
  "脑": ["🧠"],              /* 大[脑] */
  "湿": ["💦"],              /* 鞋子[湿]了 */
  "厂": ["🏭"],              /* [厂]房 */
  "医": ["🏥"],              /* [医]院 */
  "金": ["🪙"],              /* [金]色 */
  "贝": ["🐚", "🦪"],        /* [贝]壳 */
  "表": ["⌚"],              /* 手[表] */
  "旗": ["🚩"],              /* [旗]子 */
  "国": ["🇨🇳"],             /* [国]旗 */
  "工": ["🔧"],              /* [工]人 */
  "公": ["🐓"],              /* [公]鸡 */
  "球": ["⚽"],              /* 皮[球] */
  "墙": ["🧱"],              /* [墙]上 */
  "刷": ["🪥"],              /* [刷]牙 */
  "吹": ["💨"],              /* [吹]泡泡 */
  "浇": ["🚿"],              /* [浇]水 */
  "晒": ["☀️"],              /* [晒]太阳 */
  "敲": ["🥁"],              /* [敲]鼓 */
  "贴": ["🏷️"],              /* [贴]纸 */
  "挂": ["🪝"],              /* [挂]上 */
  "带": ["👜"],              /* [带]来 */
  "步": ["👣"],              /* 走一[步] */
  "棋": ["♟️"],              /* 下[棋] */

  /* —— 岛16 交通与出行 —— */
  "交": ["🚦"],              /* 过马路要看[交]通灯 */
  "通": ["🛣️", "🚥"],        /* [通]:交通/通行 */
  "场": ["🏟️"],              /* 爸爸去机[场]接客人 */
  "航": ["🚢"],              /* 小船在大海上[航]行 */
  "驾": ["🚗"],              /* 爸爸[驾]驶汽车上班 */
  "驶": ["🚙"],              /* 汽车在路上行[驶] */
  "线": ["🧵"],              /* 斑马[线]上不能跑 */
  "号": ["🔢"],              /* 我记住了妈妈的车[号] */
  "行": ["🚶"],              /* 我在小路上慢慢[行]走 */
  "迎": ["👋"],              /* 我们在门口欢[迎]客人 */
  "约": ["🤝"],              /* 我和好朋友[约]定明天见 */
};

function islandIndex(char) {
  for (let i = 0; i < DB.GROUPS.length; i++) {
    if (DB.GROUPS[i].chars.some((c) => c.c === char)) return i;
  }
  return -1;
}

function plan() {
  /* 关键:占位只认**字库自带的 e 字段**,不认补充表本身。
     旧写法用 emojiOf()(含补充表),于是"上一轮已经补过的字"被当成"已有图"跳过,
     重新生成时就把它们从自动分节里抹掉了 —— 实测把 v2.1.0 的 50 条覆盖成了 30 条,
     有效配图从 475 掉到 455。现在改成"每次从头算完整集合",
     结果由候选表顺序与字库自带图唯一决定,所以重跑是幂等的(不会越跑越少)。 */
  /* ⚠️ 必须读**原始字库记录**(DB.GROUPS[gi].chars),
     不能读 DB.BY_CHAR[c].e —— games.js 建索引时已经把补充表并进去了,
     所以 BY_CHAR 上的 e 是"合并后"的值,拿它判断会以为补充表里的图是字库自带的。 */
  const rawOf = (ch) => {
    const gi = islandIndex(ch);
    if (gi < 0) return null;
    return DB.GROUPS[gi].chars.filter((x) => x.c === ch)[0] || null;
  };
  const usedBy = DB.GROUPS.map((g) => {
    const m = {};
    g.chars.forEach((c) => { if (c.e) m[c.e] = c.c; });
    return m;
  });

  const added = [], skipped = [], unknown = [];
  for (const ch of Object.keys(CANDIDATES)) {
    const gi = islandIndex(ch);
    if (gi < 0) { unknown.push(ch); continue; }
    const raw = rawOf(ch);
    if (raw && raw.e) { skipped.push(ch + "(字库自带图)"); continue; }
    const pick = CANDIDATES[ch].find((e) => !usedBy[gi][e]);
    if (!pick) { skipped.push(ch + "(候选都被本岛占用)"); continue; }
    usedBy[gi][pick] = ch;
    added.push({ ch, e: pick, island: gi + 1, name: DB.GROUPS[gi].name });
  }
  return { added, skipped, unknown };
}

function apply(added) {
  const file = path.join(ROOT, "data", "emoji-extra.js");
  let src = fs.readFileSync(file, "utf8");

  /* 按岛分节,替换上一次自动生成的分节(可重复执行) */
  const START = "  /* ===== v2.1.0 自动补充(同岛唯一,勿手工改;改候选表后重跑 emoji-augment.js) ===== */";
  const END = "  /* ===== 自动补充结束 ===== */";
  const cut = src.indexOf(START);
  if (cut >= 0) {
    const endIdx = src.indexOf(END, cut);
    if (endIdx < 0) throw new Error("emoji-extra.js 的自动分节缺少结束标记");
    src = src.slice(0, cut) + src.slice(endIdx + END.length);
  }

  const byIsland = new Map();
  added.forEach((a) => {
    if (!byIsland.has(a.island)) byIsland.set(a.island, []);
    byIsland.get(a.island).push(a);
  });
  const lines = [START];
  [...byIsland.keys()].sort((a, b) => a - b).forEach((gi) => {
    const name = byIsland.get(gi)[0].name;
    lines.push(`  /* 岛${gi} · ${name} */`);
    lines.push("  " + byIsland.get(gi).map((a) => `"${a.ch}": "${a.e}"`).join(", ") + ",");
  });
  lines.push(END);

  /* 插到对象结束前(若最后一条后面没有逗号,补一个) */
  const close = src.lastIndexOf("};");
  if (close < 0) throw new Error("找不到 window.CHAR_EMOJI_EXTRA 的结束位置");
  const before = src.slice(0, close).replace(/\s*$/, "");
  const head = before.endsWith(",") ? before : before + ",";
  src = head + "\n\n" + lines.join("\n") + "\n\n" + src.slice(close);
  fs.writeFileSync(file, src);
  return file;
}

const { added, skipped, unknown } = plan();
console.log(`自动分节内容 ${added.length} 条（每次从头算完整集合,幂等）:`);
added.forEach((a) => console.log(`  ✔ 岛${a.island}(${a.name}) ${a.ch} → ${a.e}`));
if (skipped.length) console.log(`\n跳过 ${skipped.length} 个: ${skipped.join(", ")}`);
if (unknown.length) console.log(`\n⚠️ 候选表里有字库不存在的字: ${unknown.join("")}`);

if (process.argv.includes("--apply")) {
  if (unknown.length) { console.error("候选表含无效字,拒绝写入"); process.exit(1); }
  const f = apply(added);
  console.log(`\n已写入 ${path.relative(ROOT, f)}(共 ${added.length} 条)`);
} else {
  console.log("\n(未改动文件;加 --apply 写入)");
}
