#!/usr/bin/env python3
"""Deeper analysis: declines, gate leaks, incumbent errors, and a paired
(McNemar) test of combined vs incumbent on the cases Jev actually routed."""
import json, math
from collections import Counter, defaultdict

r = json.load(open("classify-results.json"))
rows = r["rows"]
GATE = r["gate"]

def ok(x): return bool(x["score"] and x["score"]["correct"])

# ---- declines, by reason ----
decl = Counter()
for x in rows:
    if x["jev"].get("routed"): continue
    v = x["jev"].get("verdict")
    if x["jev"]["status"] != "ok": decl["declined: no assembleable result"] += 1
    elif v and v["multiplePropositions"] >= 0.5: decl["declined: multi-page"] += 1
    elif v and v["confidence"] < GATE: decl["declined: low confidence"] += 1
    else: decl["declined: other"] += 1
print("JEV DECLINES (of %d)" % len(rows))
for k, n in decl.most_common(): print(f"  {k:38} {n}  ({100*n/len(rows):.1f}%)")

# ---- gate leaks ----
leaks = [x for x in rows if x["jev"].get("routed") and not ok(x["jev"])]
print(f"\nGATE LEAKS (auto-filed but wrong): {len(leaks)}")
bycat = Counter(x["category"] for x in leaks)
for c, n in bycat.most_common(): print(f"  {c:18} {n}")
for x in leaks[:6]:
    print(f"    run{x['run']} {x['id']} {x['category']:16} conf={x['jev']['confidence']:.2f} got={x['jev']['score']['gotPages']} want={[e['page'] for e in x['expected']]}")

# ---- incumbent errors ----
errs = [x for x in rows if not ok(x["incumbent"])]
print(f"\nINCUMBENT ERRORS: {len(errs)}")
for c, n in Counter(x["category"] for x in errs).most_common(): print(f"  {c:18} {n}")

# ---- paired comparison on routed cases (McNemar exact) ----
routed = [x for x in rows if x["jev"].get("routed")]
b = sum(1 for x in routed if ok(x["jev"]) and not ok(x["incumbent"]))   # Jev right, incumbent wrong
c = sum(1 for x in routed if not ok(x["jev"]) and ok(x["incumbent"]))   # Jev wrong, incumbent right
n = b + c
p = 1.0
if n:
    k = min(b, c)
    p = sum(math.comb(n, i) for i in range(k + 1)) / (2 ** n) * 2
    p = min(1.0, p)
print(f"\nPAIRED TEST on the {len(routed)} routed cases")
print(f"  Jev right & incumbent wrong : {b}")
print(f"  Jev wrong & incumbent right : {c}")
print(f"  McNemar exact two-sided p   : {p:.4f}  ({'significant' if p < 0.05 else 'not significant at 0.05'})")

# ---- which categories drive the combined gain ----
print("\nCOMBINED GAIN BY CATEGORY (Jev routed and beat the incumbent there)")
gain = defaultdict(int); loss = defaultdict(int)
for x in routed:
    if ok(x["jev"]) and not ok(x["incumbent"]): gain[x["category"]] += 1
    if not ok(x["jev"]) and ok(x["incumbent"]): loss[x["category"]] += 1
for c in sorted(set(gain) | set(loss)):
    print(f"  {c:18} +{gain.get(c,0)} / -{loss.get(c,0)}")

# ---- confidence discrimination ----
print("\nCONFIDENCE vs CORRECTNESS (answered cases)")
buckets = [(0, .5), (.5, .75), (.75, .9), (.9, 1.01)]
for lo, hi in buckets:
    sel = [x for x in rows if x["jev"].get("verdict") and lo <= x["jev"]["verdict"]["confidence"] < hi and x["jev"].get("score")]
    if sel:
        c_ok = sum(1 for x in sel if ok(x["jev"]))
        print(f"  [{lo:.2f},{hi:.2f})  answered {len(sel):3}  correct {c_ok:3}  {100*c_ok/len(sel):5.1f}%")
