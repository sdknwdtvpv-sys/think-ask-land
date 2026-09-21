/* ============ 思问岛 · 笔顺动画封装(hanzi-writer) + 笔画方向判定 ============
   为什么需要"方向判定":
     描红错了,以前只说"这一笔再试试" —— 孩子不知道错在哪,只能瞎试;
     说了"再试试"还是错,就变成挫败。
     其实每一笔要往哪边走,数据里写得清清楚楚(medians 的首尾点),
     所以可以直接告诉他:「第 3 笔要从上往下写 ↓」,再把这一笔演一遍。

   ⚠️ 坐标系有个坑(踩过):
     STROKE_DATA 的 medians 用的是 **y 轴向上**的坐标(和 hanzi-writer 内部一致),
     而屏幕是 y 轴向下。所以比较首尾点时必须把 dy 取反,
     否则"竖"会被判成"从下往上",给孩子的提示就正好说反了。
     .build/write-test.js 里用「十」「大」「木」这些方向确定的字守着这一点。
*/
(function () {
  "use strict";

  var COLORS = {
    strokeColor: "#5b5366",
    radicalColor: "#ff7d9c",
    outlineColor: "#ddd7ea",
    drawingColor: "#ff7d9c",
    highlightColor: "#34c99a"
  };

  function hasData(ch) {
    return !!(window.STROKE_DATA && window.STROKE_DATA[ch]);
  }

  /* 八种走向 → 说给孩子听的话 + 箭头。
     用"从…往…"的句式,因为他要的是动作,不是笔画名称
     (「横」「撇」这些名称是小学才学的,3~6 岁听不懂)。 */
  var DIR = {
    right:     { tip: "从左往右", arrow: "→" },
    left:      { tip: "从右往左", arrow: "←" },
    down:      { tip: "从上往下", arrow: "↓" },
    up:        { tip: "从下往上", arrow: "↑" },
    leftDown:  { tip: "从右上往左下", arrow: "↙" },
    rightDown: { tip: "从左上往右下", arrow: "↘" },
    rightUp:   { tip: "从左下往右上", arrow: "↗" },
    leftUp:    { tip: "从右下往左上", arrow: "↖" }
  };

  function strokeCount(ch) {
    var d = window.STROKE_DATA && window.STROKE_DATA[ch];
    return d && d.medians ? d.medians.length : 0;
  }

  /* 方向判定的置信阈值。为什么是"三段 + 一个不确定区":
     只有首尾两个点可用时,**"竖"和"撇"在几何上是分不开的** —— 实测:
       大 的第 2 笔(撇)   ax=0.340
       中 的第 1 笔(竖)   ax=0.345
     差 0.005,任何阈值在这两个之间都是掷硬币。
     所以宁可划出一个"不确定区",在那里**不给方向**,退回"跟着灰色提示描"
     (并且照样把那一笔演一遍 —— 演示本来比文字提示更管用)。
     给错方向比不给方向更糟:孩子会照着错的练。
     实测覆盖率约 3/4 的笔画能给出确定方向,其余走兜底。 */
  var CONF_H = 0.32;   /* 横向:汉字里的横都是左低右高的小角度,这条很安全 */
  var CONF_V = 0.15;   /* 纵向:只认几乎笔直的竖 */
  var CONF_D = 0.50;   /* 斜向:够斜才说斜 */

  /* 第 n 笔(0 起)的走向。数据缺失、笔画过短或方向不确定时返回 null。 */
  function strokeDir(ch, n) {
    var d = window.STROKE_DATA && window.STROKE_DATA[ch];
    if (!d || !d.medians || !d.medians[n]) return null;
    var m = d.medians[n];
    if (m.length < 2) return null;
    var a = m[0], b = m[m.length - 1];
    var sx = b[0] - a[0];
    var sy = -(b[1] - a[1]);              /* ← 关键:数据 y 向上,屏幕 y 向下 */
    var len = Math.sqrt(sx * sx + sy * sy);
    if (!(len > 1)) return null;
    var ax = Math.abs(sx) / len, ay = Math.abs(sy) / len;
    var key;
    if (ay < CONF_H) key = sx >= 0 ? "right" : "left";
    else if (ax < CONF_V) key = sy >= 0 ? "down" : "up";
    else if (ax >= CONF_D) {
      key = (sx < 0 && sy > 0) ? "leftDown"
          : (sx > 0 && sy > 0) ? "rightDown"
          : (sx > 0 && sy < 0) ? "rightUp" : "leftUp";
    } else {
      return null;   /* 不确定:不猜 */
    }
    return { key: key, tip: DIR[key].tip, arrow: DIR[key].arrow, len: len, ax: ax, ay: ay, data: DIR[key] };
  }

  /* 描红错了要说的话。没有方向数据时退回原来的温和提示,绝不说错。 */
  function mistakeTip(ch, strokeNum) {
    var n = (typeof strokeNum === "number" && strokeNum >= 0) ? strokeNum : 0;
    var dir = strokeDir(ch, n);
    if (!dir) return { text: "这一笔再试试,跟着灰色提示描~", arrow: "" };
    return {
      text: "第 " + (n + 1) + " 笔要" + dir.tip + "写,跟着灰色提示再来一次",
      arrow: dir.arrow
    };
  }

  /* 在 target(div)内创建写字板。
   * mode: "show" 展示整字 | "quiz" 描红模式
   * 返回实例包装 { play(), quiz(cb), playStroke(n), destroy() } */
  function create(target, ch, size, mode) {
    if (!window.HanziWriter || !hasData(ch)) return null;
    target.innerHTML = "";
    var writer;
    try {
      writer = window.HanziWriter.create(target, ch, {
        width: size, height: size, padding: 8,
        showOutlines: true,
        showCharacter: mode !== "quiz",
        showHintAfterMisses: 2,
        highlightOnComplete: true,
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 180,
        charDataLoader: function (c, onComplete) {
          var d = window.STROKE_DATA[c];
          if (d) onComplete(d);
          else onComplete({ strokes: [], medians: [] });
        },
        strokeColor: COLORS.strokeColor,
        radicalColor: COLORS.radicalColor,
        outlineColor: COLORS.outlineColor,
        drawingColor: COLORS.drawingColor,
        highlightColor: COLORS.highlightColor
      });
    } catch (e) {
      console.warn("writer创建失败:", e);
      return null;
    }

    var total = strokeCount(ch);
    return {
      totalStrokes: total,
      /* 播放一遍笔顺动画 */
      play: function (onComplete) {
        try {
          writer.hideCharacter();
          writer.animateCharacter({ onComplete: function () { if (onComplete) onComplete(); } });
        } catch (e) { if (onComplete) onComplete(); }
      },
      /* 只演第 n 笔(0 起):孩子可以挑一笔反复看 */
      playStroke: function (n, onComplete) {
        try {
          writer.animateStroke(n, { onComplete: function () { if (onComplete) onComplete(); } });
        } catch (e) { if (onComplete) onComplete(); }
      },
      /* 描红测验: cb = { onCorrect(i,total), onMistake(i), onDone(summary) } */
      quiz: function (cb) {
        cb = cb || {};
        try {
          writer.quiz({
            onCorrectStroke: function (d) {
              if (cb.onCorrect) cb.onCorrect(d.strokeNum + 1, d.totalStrokes || total);
            },
            onMistake: function (d) {
              if (cb.onMistake) cb.onMistake(d.strokeNum);
            },
            onComplete: function (d) {
              if (cb.onDone) cb.onDone({ mistakes: d.mistakes, total: total });
            }
          });
        } catch (e) { if (cb.onDone) cb.onDone({ mistakes: -1, total: 0 }); }
      },
      destroy: function () { try { target.innerHTML = ""; } catch (e) {} }
    };
  }

  window.Writing = {
    create: create,
    hasData: hasData,
    strokeCount: strokeCount,
    strokeDir: strokeDir,
    mistakeTip: mistakeTip,
    DIR: DIR
  };
})();
