#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成音色试听页 audio/_listen.html

扫描 audio/<音色>/index.json，把已采样到的片段整理成一张对比表：
  · 每行一个音色，可单独试听「单字 / 多音字 / 组词 / 例句」
  · 顶部可一键让全部音色依次念同一段内容，方便横向 A/B

页面放在 audio/ 下（该目录不入库），用本地静态服务器打开：
  node .build/serve.js 8023    →    http://127.0.0.1:8023/audio/_listen.html
"""
import glob, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio")

# 展示顺序与文案（文本 → 列标题）
CLIPS = [
    ("单字「日」", "日"),
    ("多音字「长」", "长"),
    ("多音字「发」", "发"),
    ("组词「日出」", "日出"),
    ("例句", "今天是快乐的日子。"),
]
# 音色展示名（缺失时用 meta.json 的 label）
NICE = {
    "yunxia": "云夏 · 微软", "xiaoyi": "晓伊 · 微软",
    "tc-402000": "云晓芙 · 超自然", "tc-403000": "云小朵 · 超自然(女童)",
    "tc-502001": "智小柔 · 超自然", "tc-603000": "懂事少年 · 超自然(男)",
    "tc-403001": "云小和 · 超自然", "tc-603001": "潇湘妹妹 · 超自然",
    "tc-603004": "温柔小柠 · 超自然", "tc-603007": "邻家女孩 · 超自然",
    "tc-502007": "智小虎 · 超自然(童)", "tc-603002": "软萌心心 · 超自然(男童)",
    "tc-101001": "智瑜 · 精品", "tc-101003": "智美 · 精品",
}

rows = []
for d in sorted(glob.glob(os.path.join(OUT, "*"))):
    if not os.path.isdir(d):
        continue
    key = os.path.basename(d)
    ip = os.path.join(d, "index.json")
    if not os.path.exists(ip):
        continue
    try:
        with open(ip, encoding="utf-8") as fh:
            idx = json.load(fh)
    except Exception:
        continue
    clips = []
    for title, text in CLIPS:
        rel = idx.get(text)
        if rel and os.path.exists(os.path.join(d, rel)):
            clips.append({"title": title, "src": "%s/%s" % (key, rel)})
    if not clips:
        continue
    label = NICE.get(key)
    if not label:
        meta = {}
        mp = os.path.join(d, "meta.json")
        if os.path.exists(mp):
            try:
                with open(mp, encoding="utf-8") as fh:
                    meta = json.load(fh)
            except Exception:
                meta = {}
        label = "%s · %s" % (meta.get("label", key), meta.get("engine", "?"))
    rows.append({"key": key, "label": label, "clips": clips})

# 当前默认音色排最前
cfg = {}
cp = os.path.join(OUT, "config.json")
if os.path.exists(cp):
    with open(cp, encoding="utf-8") as fh:
        cfg = json.load(fh)
default = cfg.get("default", "")
rows.sort(key=lambda r: (r["key"] != default, r["key"]))

html = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>思问岛 · 音色试听对比</title>
<style>
 body{font-family:-apple-system,"PingFang SC",sans-serif;margin:0;padding:20px;background:#fffaf0;color:#3f3a52}
 h1{font-size:20px;margin:0 0 6px}
 .tip{color:#8a83a3;font-size:13px;margin-bottom:14px;line-height:1.7}
 .bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;padding:12px;background:#fff;border-radius:14px;box-shadow:0 3px 0 rgba(63,58,82,.08)}
 button{font:inherit;font-size:13px;padding:8px 14px;border:none;border-radius:10px;background:#eaf5ff;color:#2b6ca3;cursor:pointer;box-shadow:0 2px 0 #bcd9f2}
 button:active{transform:translateY(2px);box-shadow:none}
 button.pri{background:#ff9f43;color:#fff;box-shadow:0 2px 0 #d97a1f}
 table{border-collapse:collapse;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 3px 0 rgba(63,58,82,.08)}
 th,td{padding:9px 10px;text-align:left;border-bottom:1px solid #f0ece0;font-size:13px}
 th{background:#fffdf7;font-size:12px;color:#8a83a3}
 tr:last-child td{border-bottom:none}
 .v{font-weight:700;white-space:nowrap}
 .v.cur{color:#e07a1f}
 td button{padding:5px 10px;font-size:12px;margin-right:4px}
 #status{position:sticky;bottom:0;margin-top:14px;padding:10px 14px;background:#3f3a52;color:#fff;border-radius:12px;font-size:13px;min-height:18px}
</style></head><body>
<h1>音色试听对比</h1>
<div class="tip">
 点表格里的小按钮听单条；点顶部按钮可以让<strong>全部音色依次念同一段内容</strong>，方便横向对比。<br>
 「长」和「发」是多音字（本站教 cháng / fà），这两条能听出音素锁定是否生效。
</div>
<div class="bar" id="bar"></div>
<table><thead><tr><th>音色</th><th>操作</th><th>单条试听</th></tr></thead><tbody id="tb"></tbody></table>
<div id="status">就绪</div>
<script>
const ROWS = __ROWS__;
const tb = document.getElementById('tb'), bar = document.getElementById('bar'), status = document.getElementById('status');
let queue = [], cur = null;
function stop(){ if(cur){ cur.pause(); cur=null; } queue=[]; }
function next(){
  if(cur){ cur.pause(); cur=null; }
  const it = queue.shift();
  if(!it){ status.textContent = '播放完毕'; return; }
  cur = new Audio(it.src);
  status.textContent = '正在播放：' + it.label + ' — ' + it.title;
  cur.onended = next;
  cur.onerror = function(){ status.textContent = '播放失败：' + it.src; setTimeout(next, 200); };
  cur.play().catch(function(){ status.textContent = '浏览器拦截了自动播放，请再点一次'; });
}
function playSeq(list){ stop(); queue = list.slice(); next(); }
ROWS.forEach(function(r, i){
  const tr = document.createElement('tr');
  const td1 = document.createElement('td');
  td1.className = 'v' + (r.isDefault ? ' cur' : '');
  td1.textContent = r.label + (r.isDefault ? ' ★' : '');
  const td2 = document.createElement('td');
  const bAll = document.createElement('button');
  bAll.className = 'pri'; bAll.textContent = '▶ 顺序播放';
  bAll.onclick = function(){ playSeq(r.clips.map(function(c){ return {src:c.src, title:c.title, label:r.label}; })); };
  td2.appendChild(bAll);
  const td3 = document.createElement('td');
  r.clips.forEach(function(c){
    const b = document.createElement('button');
    b.textContent = c.title;
    b.onclick = function(){ playSeq([{src:c.src, title:c.title, label:r.label}]); };
    td3.appendChild(b);
  });
  tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
  tb.appendChild(tr);
});
function addAllBar(title, pick){
  const b = document.createElement('button');
  b.textContent = title;
  b.onclick = function(){
    const list = [];
    ROWS.forEach(function(r){
      const c = pick(r);
      if(c) list.push({src:c.src, title:c.title, label:r.label});
    });
    playSeq(list);
  };
  bar.appendChild(b);
}
addAllBar('▶ 全部音色 · 例句对比', function(r){ return r.clips.filter(function(c){ return c.title==='例句'; })[0]; });
addAllBar('▶ 全部音色 · 单字「日」对比', function(r){ return r.clips.filter(function(c){ return c.title.indexOf('日')>-1; })[0]; });
addAllBar('▶ 全部音色 · 多音字「长」对比', function(r){ return r.clips.filter(function(c){ return c.title.indexOf('长')>-1; })[0]; });
bar.appendChild(Object.assign(document.createElement('button'), {textContent:'⏹ 停止', onclick:function(){ stop(); status.textContent='已停止'; }}));
</script></body></html>
"""

for r in rows:
    r["isDefault"] = (r["key"] == default)

with open(os.path.join(OUT, "_listen.html"), "w", encoding="utf-8") as fh:
    fh.write(html.replace("__ROWS__", json.dumps(rows, ensure_ascii=False)))

print("已生成 audio/_listen.html：%d 个音色" % len(rows))
for r in rows:
    print("   %-14s %-26s %d 条样本%s" % (r["key"], r["label"], len(r["clips"]), "  ★当前默认" if r["isDefault"] else ""))
