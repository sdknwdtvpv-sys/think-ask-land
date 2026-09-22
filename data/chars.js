/* ============================================================
 * 思问岛 · 字库合并入口(v2:按岛名合并)
 * ------------------------------------------------------------
 * 为什么改成"按岛名合并":
 *   批 2 要给现有 13 座岛各加字,如果直接改 chars-1..6.js,历史文件会被大面积改动,
 *   回滚困难、审阅也看不清。现在改为:每批新增一个 chars-N.js,
 *   同名岛(如两处都叫「自然与天气」)的字会自动接在一起 ——
 *   老文件一字不动,回滚只需删掉新文件。
 * 字段: c 汉字 / p 拼音 / w 组词 / s 例句 / e 配图(可 null) /
 *       rad 部首 / str 结构 / lvl 难度 / src 来源
 * ============================================================ */
window.CHAR_GROUPS = (function () {
  var src = []
    .concat(window.CHAR_GROUPS_P1 || [])
    .concat(window.CHAR_GROUPS_P2 || [])
    .concat(window.CHAR_GROUPS_P3 || [])
    .concat(window.CHAR_GROUPS_P4 || [])
    .concat(window.CHAR_GROUPS_P5 || [])
    .concat(window.CHAR_GROUPS_P6 || [])
    .concat(window.CHAR_GROUPS_P7 || [])
    .concat(window.CHAR_GROUPS_P8 || []);
  var out = [], byName = {};
  src.forEach(function (g) {
    if (!g || !g.name || !g.chars) return;
    if (byName[g.name]) { byName[g.name].chars = byName[g.name].chars.concat(g.chars); return; }
    var merged = { icon: g.icon, name: g.name, chars: g.chars.slice() };
    byName[g.name] = merged;
    out.push(merged);
  });
  return out;
})();
