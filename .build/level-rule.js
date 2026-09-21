/* 思问岛 · 分级阅读的篇幅规则(唯一事实来源)
   为什么单独一个文件:
     以前规则写死在 read-test.js 里(2~6 句、≤14 字、≤60 字),那是只有 L1/L2 时的标准。
     加了 L3~L5 之后,篇幅上限必须随级别放宽 —— 规则一旦有两份就会打架,
     所以放在这里,由 .build/check-passages.js(写作时查)和 .build/read-test.js(回归时守)共用。
   改规则就改这里。 */
"use strict";

const LEVELS = ["L1", "L2", "L3", "L4", "L5"];

/* minS/maxS   句数区间
   maxLine     单句最多多少字(超过就一口气读不完)
   maxTotal    全篇最多多少字(整篇朗读时长与注意力上限)
   name/hint   给孩子看的级别名与说明 */
const LEVEL_RULE = {
  L1: { name: "看图读句", hint: "2~5 句，每句很短", minS: 2, maxS: 5, maxLine: 10, maxTotal: 45, need: 30 },
  L2: { name: "短句成篇", hint: "3~7 句，能讲一件小事", minS: 3, maxS: 7, maxLine: 14, maxTotal: 90, need: 60 },
  L3: { name: "小故事", hint: "5~10 句，有小情节", minS: 5, maxS: 10, maxLine: 18, maxTotal: 150, need: 120 },
  L4: { name: "对话故事", hint: "有对话，能问答", minS: 8, maxS: 16, maxLine: 22, maxTotal: 240, need: 250 },
  L5: { name: "桥梁阅读", hint: "能分段讲完一个故事", minS: 12, maxS: 26, maxLine: 26, maxTotal: 380, need: 400 }
};

/* 允许出现的标点:句末 。！？ · 句中 ，：；、 · 对话引号 “” */
const OK_PUNC = "。，？！：；、“”";

module.exports = { LEVELS, LEVEL_RULE, OK_PUNC };
