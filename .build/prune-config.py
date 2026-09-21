#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按「实际发布的音色」裁剪 audio/config.json

为什么需要它:
  本地可能保留多套音色(例如微软音色留作备用),但线上只发布其中一部分。
  如果部署时整份 config.json 原样上传,家长中心就会列出**点不响的音色**
  (索引文件没跟着发布 → 切换时请求 404 → 静默失败),家长会以为是坏的。

用法:
  # 只保留两个腾讯音色,输出到临时文件(然后单独发到线上)
  python3 .build/prune-config.py --keep tc-502007,tc-403000 --out /tmp/audio-config.json

  # 不给 --keep:按磁盘上实际存在的 index.json 自动判断(默认覆盖 audio/config.json)
  python3 .build/prune-config.py
"""
import argparse, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.join(ROOT, "audio"))
    ap.add_argument("--keep", default="", help="保留的音色 key(逗号分隔);留空=按磁盘实际存在的 index.json 判断")
    ap.add_argument("--out", default="", help="输出路径;留空=覆盖 <root>/config.json")
    a = ap.parse_args()

    cfg_path = os.path.join(a.root, "config.json")
    if not os.path.exists(cfg_path):
        sys.exit("找不到 %s" % cfg_path)
    with open(cfg_path, encoding="utf-8") as fh:
        cfg = json.load(fh)

    keep = [k.strip() for k in a.keep.split(",") if k.strip()]
    out_reg = {}
    for k, v in (cfg.get("voices") or {}).items():
        if keep and k not in keep:
            continue
        d = os.path.join(a.root, v.get("dir", k))
        ip = os.path.join(d, "index.json")
        if not os.path.exists(ip):
            continue
        try:
            with open(ip, encoding="utf-8") as fh:
                n = len(json.load(fh))
        except Exception:
            continue
        if n <= 0:
            continue
        out_reg[k] = dict(v, count=n)

    if not out_reg:
        sys.exit("裁剪后一个音色都不剩,已中止(检查 --keep 与 audio/ 目录)")

    default = cfg.get("default")
    if default not in out_reg:
        default = "tc-502007" if "tc-502007" in out_reg else sorted(out_reg)[0]
    roles = {r: k for r, k in (cfg.get("roles") or {}).items() if k in out_reg}

    dst = a.out or cfg_path
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump({"default": default, "voices": out_reg, "roles": roles},
                  fh, ensure_ascii=False, indent=2, sort_keys=True)

    print("保留音色: " + "、".join("%s(%s, %d 条)" % (k, v["label"], v["count"]) for k, v in sorted(out_reg.items())))
    print("默认: %s | roles: %s" % (default, json.dumps(roles, ensure_ascii=False)))
    print("已写入 %s" % dst)


if __name__ == "__main__":
    main()
