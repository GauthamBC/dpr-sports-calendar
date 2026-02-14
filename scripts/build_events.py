import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "data" / "sources.json"
OUT_PATH = ROOT / "data" / "events.json"

# Very small, dependency-free ICS parser (enough for most feeds).
# Handles: DTSTART, DTEND, SUMMARY, LOCATION (optional)
def parse_ics(text: str, feed_meta: dict):
    # Unfold lines (ICS can fold long lines starting with space)
    text = text.replace("\r\n", "\n")
    lines = text.split("\n")
    unfolded = []
    for line in lines:
        if line.startswith(" ") or line.startswith("\t"):
            if unfolded:
                unfolded[-1] += line[1:]
        else:
            unfolded.append(line)

    events = []
    in_event = False
    cur = {}

    def flush():
        nonlocal cur
        if not cur.get("summary") or not cur.get("start"):
            cur = {}
            return
        title = cur["summary"].strip()
        start = cur["start"]
        end = cur.get("end")

        ev = {
            "title": title,
            "start": start,
            "end": end,
            "sport": feed_meta.get("sport", feed_meta.get("name", "Unknown")),
            "source": feed_meta.get("name", "Feed"),
        }
        if "location" in cur:
            ev["location"] = cur["location"].strip()
        events.append(ev)
        cur = {}

    def parse_dt(value: str):
        # Examples:
        # 20260229T140000Z
        # 20260229
        value = value.strip()
        if value.endswith("Z") and "T" in value:
            dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            return dt.isoformat()
        if "T" in value and not value.endswith("Z"):
            # Treat as "floating" local time; keep ISO-ish without tz
            dt = datetime.strptime(value, "%Y%m%dT%H%M%S")
            return dt.isoformat()
        # Date-only
        dt = datetime.strptime(value, "%Y%m%d")
        return dt.date().isoformat()

    for line in unfolded:
        if line == "BEGIN:VEVENT":
            in_event = True
            cur = {}
            continue
        if line == "END:VEVENT":
            in_event = False
            flush()
            continue
        if not in_event:
            continue

        # key[:params]:value
        if ":" not in line:
            continue
        keypart, val = line.split(":", 1)
        key = keypart.split(";", 1)[0].upper()

        if key == "SUMMARY":
            cur["summary"] = val
        elif key == "DTSTART":
            cur["start"] = parse_dt(val)
        elif key == "DTEND":
            cur["end"] = parse_dt(val)
        elif key == "LOCATION":
            cur["location"] = val

    return events


def fetch_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def main():
    sources = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    out = []
    for feed in sources.get("feeds", []):
        url = feed["url"]
        print(f"Fetching: {feed.get('name')} -> {url}")
        ics_text = fetch_text(url)
        out.extend(parse_ics(ics_text, feed))

    # De-dupe by (title,start)
    seen = set()
    deduped = []
    for e in out:
        k = (e.get("title"), e.get("start"))
        if k in seen:
            continue
        seen.add(k)
        deduped.append(e)

    # Sort by start
    def sort_key(e):
        s = e.get("start") or ""
        return s
    deduped.sort(key=sort_key)

    OUT_PATH.write_text(json.dumps(deduped, indent=2), encoding="utf-8")
    print(f"Wrote {len(deduped)} events -> {OUT_PATH}")

if __name__ == "__main__":
    main()
