#!/usr/bin/env python3
"""Release probe (EPIC-24 M6): hammer Zenod's public front door during a release and count failures.
Each worker loops one target; a failure is a network error, a timeout or any 5xx (or an
unexpected status). Prints one JSON summary; --log writes one line per request (no bodies)."""
import argparse, json, ssl, threading, time, urllib.request, urllib.error
TARGETS = [
    ("GET", "https://cloud.zenod.dev/api/health", {200}),
    ("GET", "https://zenod.dev/", {200}),
    ("POST", "https://cloud.zenod.dev/mcp", {401}),
]
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=120)
    ap.add_argument("--interval", type=float, default=0.25, help="pause per worker between requests")
    ap.add_argument("--log", default="")
    ap.add_argument("--until-file", default="", help="stop early once this file exists")
    a = ap.parse_args()
    lock = threading.Lock(); rows = []; stop = time.time() + a.seconds
    ctx = ssl.create_default_context()
    def worker(method, url, ok):
        while time.time() < stop and not (a.until_file and __import__("os").path.exists(a.until_file)):
            t0 = time.time(); status = None; sha = ""; err = ""
            data = b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' if method == "POST" else None
            req = urllib.request.Request(url, data=data, method=method, headers={"user-agent": "zenod-e24-m6-release-probe", "content-type": "application/json", "accept": "application/json, text/event-stream"})
            try:
                with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
                    status = r.status; body = r.read(4096)
                    if url.endswith("/api/health"):
                        try: sha = (json.loads(body).get("sha") or "")[:7]
                        except Exception: pass
            except urllib.error.HTTPError as e:
                status = e.code
            except Exception as e:
                err = type(e).__name__
            ms = int((time.time() - t0) * 1000)
            row = {"t": time.strftime("%H:%M:%S", time.gmtime(t0)) + f".{int(t0*1000)%1000:03d}", "m": method, "url": url, "status": status, "ms": ms, "sha": sha, "err": err, "fail": bool(err) or status not in ok}
            with lock: rows.append(row)
            time.sleep(a.interval)
    ths = [threading.Thread(target=worker, args=t) for t in TARGETS]
    [t.start() for t in ths]; [t.join() for t in ths]
    rows.sort(key=lambda r: r["t"])
    if a.log:
        with open(a.log, "w") as f:
            for r in rows: f.write(json.dumps(r) + "\n")
    fails = [r for r in rows if r["fail"]]
    shas = []
    for r in rows:
        if r["sha"] and (not shas or shas[-1][1] != r["sha"]): shas.append((r["t"], r["sha"]))
    print(json.dumps({"requests": len(rows), "failed": len(fails), "max_ms": max((r["ms"] for r in rows), default=0),
                      "p99_ms": sorted(r["ms"] for r in rows)[int(len(rows)*0.99)-1] if rows else 0,
                      "sha_changes": shas, "failures": [{k: r[k] for k in ("t","m","url","status","err","ms")} for r in fails[:40]]}, indent=1))
if __name__ == "__main__": main()
