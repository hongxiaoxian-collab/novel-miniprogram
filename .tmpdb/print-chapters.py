"""打印某作品的章节目录（只输出标题/字数，不带正文），用于清理前后核对。

用法: python print-chapters.py <novelId>
"""
import json
import sys
import urllib.request

BASE = "http://120.79.174.44:3001"


def get(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(BASE + path, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


nid = sys.argv[1]
novel = get("/novel/" + nid)
vols = get("/novel/%s/chapters" % nid)
flat = [c for v in vols for c in v.get("chapters", [])]
print("title:", novel.get("title"))
print("count:", len(flat))
for c in flat:
    print("  ch%s | %s | %s chars | %s" % (c.get("order"), c.get("title"), len(c.get("content") or ""), c.get("createdAt")))
