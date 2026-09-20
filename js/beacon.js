/* ============ 思问岛 · 最小埋点（匿名 / 可关闭 / 零个人信息） ============
   目的：让运营决策有数据依据（留存、题型正确率、放弃点），而不是靠猜。

   隐私设计（三条硬约束）
   1. **不采集任何个人信息**：没有姓名、头像、语音、自由文本，也不采集位置
   2. **标识每日轮换**：本地随机种子 + 当天日期做哈希，得到 6 位匿名标识 ——
      因此可以统计"今天有多少人打开"，但**在数学上无法跨天追踪同一个人**
   3. **家长可一键关闭**，也可随时重置匿名标识；关闭后完全不发送

   传输：navigator.sendBeacon（不阻塞界面）→ 失败回退 fetch(keepalive)
   服务端：nginx 只记录事件参数（不含 IP/UA），见 deploy/nginx-beacon-log.conf

   接口
     Beacon.track(event, props)   发一个事件；关闭状态下返回 false
     Beacon.on() / Beacon.setOn(bool)  查询/设置开关
     Beacon.reset()               重置匿名标识（换一个种子）
     Beacon.sid()                 当前匿名标识（便于测试）
   ============================================================ */

(function () {
  "use strict";

  var TRACK_KEY = "hanziKids.track";     // "0" = 家长关闭
  var SEED_KEY = "hanziKids.seed";
  var ENDPOINT = "/api/beacon";
  var MAX_PROP_LEN = 120;                // 属性串长度上限,防止意外把长文本发出去

  function ls(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  function on() { return ls(function () { return localStorage.getItem(TRACK_KEY) !== "0"; }, false); }
  function setOn(v) { ls(function () { localStorage.setItem(TRACK_KEY, v ? "1" : "0"); }); }

  function seed() {
    return ls(function () {
      var s = localStorage.getItem(SEED_KEY);
      if (!s || s.length < 8) {
        s = Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 6);
        localStorage.setItem(SEED_KEY, s);
      }
      return s;
    }, "0");
  }
  function reset() {
    ls(function () {
      localStorage.setItem(SEED_KEY, Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 6));
    });
  }

  /* 简易散列(djb2):只需要稳定与短,不需要密码学强度 */
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  /* 每日轮换标识:同一天内稳定(用于日活去重),跨天不可关联 */
  function sid() { return hash(seed() + "|" + today()).slice(0, 6); }

  function version() {
    var m = document.querySelector('meta[name="app-version"]');
    return (m && m.content) || "dev";
  }

  /* 事件名与属性都做白名单式约束:短、无空格、无引号 */
  function clean(v) {
    return String(v == null ? "" : v).replace(/[^\w\u4e00-\u9fff.:\-]/g, "").slice(0, 40);
  }

  function payload(event, props) {
    var parts = [];
    if (props) {
      Object.keys(props).slice(0, 8).forEach(function (k) {
        parts.push(clean(k) + "=" + clean(props[k]));
      });
    }
    return parts.join(",").slice(0, MAX_PROP_LEN);
  }

  function track(event, props) {
    if (!on()) return false;
    var url = ENDPOINT + "?e=" + encodeURIComponent(clean(event)) +
      "&p=" + encodeURIComponent(payload(event, props)) +
      "&v=" + encodeURIComponent(clean(version())) +
      "&s=" + encodeURIComponent(sid());
    try {
      if (navigator.sendBeacon) { navigator.sendBeacon(url); return true; }
      if (window.fetch) {
        /* 必须接住失败:埋点端点未部署/无网/jsdom 环境下,未处理的 rejection 会污染错误上报 */
        fetch(url, { keepalive: true, mode: "no-cors" }).catch(function () {});
        return true;
      }
    } catch (e) { /* 埋点失败绝不影响使用 */ }
    return false;
  }

  window.Beacon = { track: track, on: on, setOn: setOn, reset: reset, sid: sid };
})();
