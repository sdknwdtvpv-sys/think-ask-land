/* ============ 思问岛 · 拼音工具（声调处理） ============
   为什么需要它:
     - 「辨调」题型要能由目标字的拼音生成"只差声调"的三个干扰项
     - 「听写」题型要能按"同音不同调 / 同调近音"挑选更难的干扰字
     - 后续「拼音教学」与「错因分类(音近)」也要用同一套判断

   接口
     Py.base(p)        去声调的基础音节(ü 保留原样)     "mǎ" → "ma"
     Py.tone(p)        声调号 0~4(0=轻声)               "mǎ" → 3
     Py.apply(syl, t)  给基础音节加声调                 ("ma", 3) → "mǎ"
     Py.variants(p)    同音节的其它声调变体(去重)        "mǎ" → ["mā","má","mà"]
     Py.sameBase(a,b)  两拼音是否同基础音节(忽略声调)
     Py.parts(p)       拆声母/韵母                          "mǎ" → {initial:"m", final:"a", ...}
     Py.likeness(a,b)  近音分级 0同/1只差声调/2同韵/3同声/9无关
     Py.isValid(p)     是否是可用拼音串
   ============================================================ */
(function () {
  "use strict";

  /* 带调元音 → 基础元音 + 声调 */
  var TONED = {
    "ā": ["a", 1], "á": ["a", 2], "ǎ": ["a", 3], "à": ["a", 4],
    "ō": ["o", 1], "ó": ["o", 2], "ǒ": ["o", 3], "ò": ["o", 4],
    "ē": ["e", 1], "é": ["e", 2], "ě": ["e", 3], "è": ["e", 4],
    "ī": ["i", 1], "í": ["i", 2], "ǐ": ["i", 3], "ì": ["i", 4],
    "ū": ["u", 1], "ú": ["u", 2], "ǔ": ["u", 3], "ù": ["u", 4],
    "ǖ": ["ü", 1], "ǘ": ["ü", 2], "ǚ": ["ü", 3], "ǜ": ["ü", 4],
    "ń": ["n", 2], "ň": ["n", 3], "ḿ": ["m", 2]
  };
  /* 基础元音 + 声调 → 带调元音 */
  var MARKS = {
    a: ["a", "ā", "á", "ǎ", "à"],
    o: ["o", "ō", "ó", "ǒ", "ò"],
    e: ["e", "ē", "é", "ě", "è"],
    i: ["i", "ī", "í", "ǐ", "ì"],
    u: ["u", "ū", "ú", "ǔ", "ù"],
    "ü": ["ü", "ǖ", "ǘ", "ǚ", "ǜ"]
  };

  /* 合法字符表:由 TONED 表自动生成。
     注意不能用 /[\u0100-\u01ff]/ 这种区间判断——带调元音横跨两个 Unicode 区段
     (í=U+00ED 在拉丁字母补充区,ǎ=U+01CE 在拉丁字母扩展区),区间判断会漏掉一半。 */
  var ALLOWED = null;
  function isPinyin(p) {
    if (typeof p !== "string") return false;
    var s = p.trim().toLowerCase();
    if (!s) return false;
    if (!ALLOWED) {
      ALLOWED = {};
      "abcdefghijklmnopqrstuvwxyzü".split("").forEach(function (c) { ALLOWED[c] = 1; });
      for (var k in TONED) ALLOWED[k] = 1;
    }
    for (var i = 0; i < s.length; i++) if (!ALLOWED[s[i]]) return false;
    return true;
  }

  /* 去声调 + 取声调 */
  function split(p) {
    var s = String(p || "").trim().toLowerCase();
    var out = "", tone = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], hit = TONED[ch];
      if (hit) { out += hit[0]; tone = hit[1]; }
      else out += ch;
    }
    return { base: out, tone: tone };
  }
  function base(p) { return split(p).base; }
  function tone(p) { return split(p).tone; }

  /* 给基础音节标声调(按汉语拼音标准:有 a 标 a;否则 o/e;iu 标 u,ui 标 i;其余标最后一个元音) */
  function apply(syllable, t) {
    var s = String(syllable || "").trim().toLowerCase();
    t = parseInt(t, 10) || 0;
    if (t < 1 || t > 4) return s;
    var idx = -1;
    if (s.indexOf("a") > -1) idx = s.indexOf("a");
    else if (s.indexOf("o") > -1) idx = s.indexOf("o");
    else if (s.indexOf("e") > -1) idx = s.indexOf("e");
    else if (s.indexOf("iu") > -1) idx = s.indexOf("iu") + 1;
    else if (s.indexOf("ui") > -1) idx = s.indexOf("ui") + 1;
    else {
      for (var i = s.length - 1; i >= 0; i--) {
        if ("iuü".indexOf(s[i]) > -1) { idx = i; break; }
      }
    }
    if (idx < 0) return s;
    var v = s[idx], table = MARKS[v];
    if (!table) return s;
    return s.slice(0, idx) + table[t] + s.slice(idx + 1);
  }

  /* 同音节的其它声调变体(不含自身) */
  function variants(p) {
    var sp = split(p), out = [];
    if (sp.tone < 1) return out;             // 轻声不做辨调
    for (var t = 1; t <= 4; t++) {
      if (t === sp.tone) continue;
      var v = apply(sp.base, t);
      if (v !== sp.base) out.push(v);
    }
    return out;
  }

  function sameBase(a, b) { return base(a) === base(b) && isPinyin(a) && isPinyin(b); }

  /* 声母表(仅供程序判断,不是给孩子看的):双字母优先(zh/ch/sh 必须排在 z/c/s 之前) */
  var INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
    "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];

  /* 拆声母/韵母:整体认读的 y/w 按声母处理(一 yī → y + i) */
  function parts(p) {
    var b = base(p), ini = "", fin = b;
    for (var i = 0; i < INITIALS.length; i++) {
      var x = INITIALS[i];
      if (b.indexOf(x) === 0 && b.length > x.length) { ini = x; fin = b.slice(x.length); break; }
    }
    return { initial: ini, final: fin, base: b, tone: tone(p) };
  }

  /* 近音:同音节(只差声调)/ 同韵母 / 同声母 —— 用于听写的干扰项难度分级 */
  function likeness(a, b) {
    if (a === b) return 0;                       // 完全相同(不可作干扰项)
    if (sameBase(a, b)) return 1;                // 只差声调:最难
    var pa = parts(a), pb = parts(b);
    if (pa.final && pa.final === pb.final) return 2;     // 同韵母
    if (pa.initial && pa.initial === pb.initial) return 3; // 同声母
    return 9;                                    // 无关音
  }

  /* ================= 拼音启蒙教学用的表 =================
     声母按教学顺序排列,read 是"呼读音"(b 读作 bo 而不是英文字母 bee),
     这样孩子听到的和老师教的一致;TTS 直接读 read 即可。 */
  var TEACH_INITIALS = [
    { l: "b", read: "bo" }, { l: "p", read: "po" }, { l: "m", read: "mo" }, { l: "f", read: "fo" },
    { l: "d", read: "de" }, { l: "t", read: "te" }, { l: "n", read: "ne" }, { l: "l", read: "le" },
    { l: "g", read: "ge" }, { l: "k", read: "ke" }, { l: "h", read: "he" },
    { l: "j", read: "ji" }, { l: "q", read: "qi" }, { l: "x", read: "xi" },
    { l: "zh", read: "zhi" }, { l: "ch", read: "chi" }, { l: "sh", read: "shi" }, { l: "r", read: "ri" },
    { l: "z", read: "zi" }, { l: "c", read: "ci" }, { l: "s", read: "si" },
    { l: "y", read: "yi" }, { l: "w", read: "wu" }
  ];
  /* 韵母分三组,与小学教材的分法一致 */
  var FINAL_GROUPS = [
    { name: "单韵母", items: ["a", "o", "e", "i", "u", "ü"] },
    { name: "复韵母", items: ["ai", "ei", "ui", "ao", "ou", "iu", "ie", "üe", "er"] },
    { name: "鼻韵母", items: ["an", "en", "in", "un", "ün", "ang", "eng", "ing", "ong"] }
  ];
  var TONE_INFO = [
    { t: 1, mark: "ˉ", name: "一声", desc: "又高又平", demo: "mā" },
    { t: 2, mark: "ˊ", name: "二声", desc: "往上扬", demo: "má" },
    { t: 3, mark: "ˇ", name: "三声", desc: "先降后升", demo: "mǎ" },
    { t: 4, mark: "ˋ", name: "四声", desc: "干脆下降", demo: "mà" }
  ];
  var ORDINAL = { 1: "一", 2: "二", 3: "三", 4: "四", 0: "轻" };
  function toneName(t) { return t >= 1 && t <= 4 ? ORDINAL[t] + "声" : "轻声"; }

  /* 全库音节索引:由字库反推,保证"教的音节都是孩子真能用到的" */
  function syllableIndex() {
    var db = window.CharDB;
    if (!db) return { byBase: {}, byInitial: {} };
    var byBase = {}, byInitial = {};
    db.ALL.forEach(function (c) {
      var b = base(c.p), pa = parts(c.p);
      (byBase[b] = byBase[b] || []).push(c);
      if (pa.initial) (byInitial[pa.initial] = byInitial[pa.initial] || []).push(c);
    });
    idxCache = { byBase: byBase, byInitial: byInitial };
    return idxCache;
  }
  var idxCache = null;
  function index() { return idxCache || syllableIndex(); }

  /* 声母的例字(优先已学过的) */
  function examplesForInitial(ini, n) {
    var list = index().byInitial[ini] || [];
    return list.slice(0, n || 3);
  }

  /* ---------- 整体认读音节(16 个) ----------
     为什么单独讲:
       这 16 个音节**不用拼**(不能拆成"声母 + 韵母"来读):
       如 zhi 不是 "zh + i",yuan 也不是 "y + uan"。
       孩子如果按拼读去读,会读成奇怪的音;所以必须整块记住。
     教法:给每个音节配一个**字库里已有的字**当"声音样本"
       (zhi→只、ri→日、yuan→圆…),孩子一听就懂,
       而且这个字他已经学过或很快会学到,不是新的负担。 */
  var ZHENGTI = ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"];

  /* 一个音节配一个库内的字:优先浅岛(孩子更可能已经学过),同岛取先出现的 */
  function zhengtiSamples(chars) {
    var out = [];
    ZHENGTI.forEach(function (sy) {
      var best = null;
      (chars || []).forEach(function (c) {
        if (base(c.p) !== sy) return;
        if (!best || c.gi < best.gi || (c.gi === best.gi && c.i < best.i)) best = c;
      });
      out.push({ sy: sy, char: best ? best.c : "", py: best ? best.p : "" });
    });
    return out;
  }

  window.Py = {
    base: base, tone: tone, apply: apply, variants: variants,
    sameBase: sameBase, isValid: isPinyin, split: split,
    parts: parts, likeness: likeness,
    TEACH_INITIALS: TEACH_INITIALS, FINAL_GROUPS: FINAL_GROUPS, TONE_INFO: TONE_INFO, toneName: toneName,
    syllableIndex: syllableIndex, index: index, examplesForInitial: examplesForInitial,
    ZHENGTI: ZHENGTI, zhengtiSamples: zhengtiSamples
  };
})();
