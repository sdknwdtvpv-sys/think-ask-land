/* ============ 思问岛 · 笔顺动画封装(hanzi-writer) ============ */
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

  /* 在 target(div)内创建写字板。
   * mode: "show" 展示整字 | "quiz" 描红模式
   * 返回实例包装 { play(), quiz(cb), destroy() } */
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

    return {
      /* 播放一遍笔顺动画 */
      play: function (onComplete) {
        try {
          writer.hideCharacter();
          writer.animateCharacter({ onComplete: function () { if (onComplete) onComplete(); } });
        } catch (e) { if (onComplete) onComplete(); }
      },
      /* 描红测验: cb = { onCorrect(i,total), onMistake(i), onDone(summary) } */
      quiz: function (cb) {
        cb = cb || {};
        try {
          writer.quiz({
            onCorrectStroke: function (d) { if (cb.onCorrect) cb.onCorrect(d.strokeNum + 1, d.totalStrokes || (window.STROKE_DATA[ch] || { strokes: [] }).strokes.length); },
            onMistake: function (d) { if (cb.onMistake) cb.onMistake(d.strokeNum); },
            onComplete: function (d) { if (cb.onDone) cb.onDone({ mistakes: d.mistakes, total: (window.STROKE_DATA[ch] || { strokes: [] }).strokes.length }); }
          });
        } catch (e) { if (cb.onDone) cb.onDone({ mistakes: -1, total: 0 }); }
      },
      destroy: function () { try { target.innerHTML = ""; } catch (e) {} }
    };
  }

  window.Writing = { create: create, hasData: hasData };
})();
