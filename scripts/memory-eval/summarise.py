#!/usr/bin/env python3
"""Summarise classify-results.json: aggregate, run spread, category breakdown,
gate leaks and Jev declines."""
import json, sys
from collections import defaultdict, Counter

path = sys.argv[1] if len(sys.argv) > 1 else "classify-results.json"
r = json.load(open(path))
rows = r["rows"]
a = r["aggregate"]
pct = lambda c, t: f"{100*c/t:.1f}%" if t else "-"

print(f"fixture {r['fixtureVersion']}  model {r['model']}  gate {r['gate']}")
print(f"cases {r['cases']} · trials {r['trials']} · runs {r['runs']} · calls {r['incumbentCalls']} · spend ${r['spentUsd']} · {'COMPLETE' if r['complete'] else 'INCOMPLETE (budget stopped)'}")
print()
print(f"{'':14}{'correct':>10}{'pct':>8}{'p50':>8}{'p90':>8}")
for name, k in (("incumbent", "incumbent"), ("jev (raw)", "jevRaw"), ("jev (gated)", "jevGated"), ("combined", "combined")):
    v = a[k]
    lat = v.get("latency") or {}
    tot = v["total"]
    ratio = f"{v['correct']}/{tot}"
    print(f"{name:14}{ratio:>10}{pct(v['correct'], tot):>8}{str(lat.get('p50','-')):>8}{str(lat.get('p90','-')):>8}", end="")
    if k == "jevGated":
        print(f"   covers {pct(v['ofAttempts'] - (len(rows) - tot), len(rows))}")
    elif k == "combined" and "jevShare" in v:
        print(f"   jev carries {v['jevShare']}%")
    else:
        print()

print("\nrun-to-run spread:")
for name, sp in r["spread"].items():
    if sp:
        print(f"  {name:10} mean {sp['meanPct']}%  min {sp['minPct']}%  max {sp['maxPct']}%  spread {sp['spreadPct']}pp  sd {sp['sdPct']}pp  ({sp['runs']} runs)")
    else:
        print(f"  {name:10} not measurable (fewer than 1 complete run)")

print("\nper-run:")
for s in r["runSummaries"]:
    print(f"  run {s['run']}: attempts {s['attempts']:3}  incumbent {s['incumbent']['correct']}/{s['incumbent']['total']}  "
          f"jev-raw {s['jevRaw']['correct']}/{s['jevRaw']['total']}  jev-gated {s['jevGated']['correct']}/{s['jevGated']['total']} "
          f"(cov {s['coveragePct']}%)  combined {s['combined']['correct']}/{s['combined']['total']}  spend ${s['spentUsd']}")

print("\nper-category:")
cats = sorted({r["category"] for r in rows})
for cat in cats:
    rs = [r for r in rows if r["category"] == cat]
    i = sum(1 for x in rs if x["incumbent"]["score"] and x["incumbent"]["score"]["correct"])
    j = sum(1 for x in rs if x["jev"]["score"] and x["jev"]["score"]["correct"])
    g = sum(1 for x in rs if x["jev"].get("routed"))
    print(f"  {cat:18} n={len(rs):3}  incumbent {i:3}/{len(rs)}  jev {j:3}/{len(rs)}  jev-routed {g:3}")

declined = defaultdict(int)
for x in rows:
    if not x["jev"].get("routed"):
        v = x["jev"].get("verdict")
        if x["jev"]["status"] != "ok":
            declined["incomplete (no evidence / no destination)"] += 1
        elif v and v["multiplePropositions"] >= 0.5:
            declined["multi-page declined"] += 1
        elif v and v["confidence"] < r["gate"]:
            declined["low confidence"] += 1
        else:
            declined["other"] += 1
print("\njev declines:")
for k, v in declined.most_common():
    print(f"  {k:44} {v}")

print("\ngate leaks (routed but wrong):")
leaks = [x for x in rows if x["jev"].get("routed") and x["jev"]["score"] and not x["jev"]["score"]["correct"]]
if not leaks:
    print("  none")
for x in leaks:
    print(f"  run{x['run']} {x['id']} {x['category']:16} conf={x['jev']['confidence']:.2f} got={x['jev']['score']['gotPages']}|{x['jev']['score']['gotDisp']} want={[(e['page'], e['disposition']) for e in x['expected']]}")

print("\nincumbent errors:")
errs = [x for x in rows if x["incumbent"]["score"] and not x["incumbent"]["score"]["correct"]]
if not errs:
    print("  none")
for x in errs:
    print(f"  run{x['run']} {x['id']} {x['category']:16} got={x['incumbent']['score']['gotPages']}|{x['incumbent']['score']['gotDisp']} want={[(e['page'], e['disposition']) for e in x['expected']]}")
