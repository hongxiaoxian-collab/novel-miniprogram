"""清理重复章节前，把指定作品的章节全文留底（导出 JSON）。

用法: python backup-chapters.py <novelId>
"""
import json
import sys
import time
import urllib.request

BASE = "http://120.79.174.44:3001"


def get(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(BASE + path, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    nid = sys.argv[1]
    novel = get("/novel/" + nid)
    vols = get("/novel/%s/chapters" % nid)
    flat = [c for v in vols for c in v.get("chapters", [])]
    out = {
        "savedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "novelId": nid,
        "title": novel.get("title"),
        "chapterCount": len(flat),
        "chapters": [
            {
                "order": c.get("order"),
                "volume": c.get("volume"),
                "title": c.get("title"),
                "words": len(c.get("content") or ""),
                "createdAt": c.get("createdAt"),
                "content": c.get("content"),
            }
            for c in flat
        ],
    }
    fn = "chapters-backup-%s-%s.json" % (nid, time.strftime("%Y%m%d-%H%M%S"))
    with open(fn, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("作品:", out["title"])
    print("章节数:", out["chapterCount"])
    for c in out["chapters"]:
        print("  第%s章 %s (%s字, %s)" % (c["order"], c["title"], c["words"], c["createdAt"]))
    print("已保存:", fn)


main()
