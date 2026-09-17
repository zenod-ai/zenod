#!/usr/bin/env python3
"""Plain-English slices: what happened to the 450 memories, and a head-to-head
on exactly the cases each system handled."""
import json
from collections import defaultdict

r = json.load(open("classify-results.json"))
rows = r["rows"]
JEV = 0.042 / 1e6
INC_CALL = r["spentUsd"] / r["incumbentCalls"]

def ok(d): return bool(d.get("score") and d["score"]["correct"])

handled = [x for x in rows if x["jev"].get("routed")]
passed  = [x for x in rows if not x["jev"].get("routed")]

print("WHAT HAPPENED TO ALL %d MEMORIES" % len(rows))
print(f"  handled by Jev, used its answer     : {len(handled):3}  ({100*len(handled)/len(rows):.0f}%)")
print(f"    -> Jev correct                    : {sum(1 for x in handled if ok(x['jev'])):3}  ({100*sum(1 for x in handled if ok(x['jev']))/len(handled):.1f}%)")
print(f"    -> old model would give correct   : {sum(1 for x in handled if ok(x['incumbent'])):3}  ({100*sum(1 for x in handled if ok(x['incumbent']))/len(handled):.1f}%)")
print(f"  sent to the old model instead       : {len(passed):3}  ({100*len(passed)/len(rows):.0f}%)")
print(f"    -> correct                        : {sum(1 for x in passed if ok(x['incumbent'])):3}  ({100*sum(1 for x in passed if ok(x['incumbent']))/max(1,len(passed)):.1f}%)")
print()
print(f"  WITHOUT Jev, total correct          : {sum(1 for x in rows if ok(x['incumbent']))}/{len(rows)}  ({100*sum(1 for x in rows if ok(x['incumbent']))/len(rows):.1f}%)")
print(f"  WITH Jev, total correct             : {sum(1 for x in handled if ok(x['jev'])) + sum(1 for x in passed if ok(x['incumbent']))}/{len(rows)}  ({100*(sum(1 for x in handled if ok(x['jev'])) + sum(1 for x in passed if ok(x['incumbent'])))/len(rows):.1f}%)")

print("\nHEAD-TO-HEAD, ONLY ON THE CASES JEV HANDLED (%d)" % len(handled))
b = sum(1 for x in handled if ok(x["jev"]) and not ok(x["incumbent"]))
c = sum(1 for x in handled if not ok(x["jev"]) and ok(x["incumbent"]))
d = sum(1 for x in handled if ok(x["jev"]) and ok(x["incumbent"]))
a = sum(1 for x in handled if not ok(x["jev"]) and not ok(x["incumbent"]))
print(f"  both correct            : {d}")
print(f"  Jev right, old wrong    : {b}   <- Jev wins")
print(f"  Jev wrong, old right    : {c}   <- Jev loses")
print(f"  both wrong              : {a}")

print("\nPER CATEGORY (head-to-head on the cases Jev handled)")
bycat = defaultdict(list)
for x in rows: bycat[x["category"]].append(x)
print(f"{'category':16}{'n':>4}{'Jev took':>10}{'Jev ok':>8}{'old ok':>8}   {'Jev p50':>8}{'old p50':>8}")
for cat in sorted(bycat):
    rs = bycat[cat]
    h = [x for x in rs if x["jev"].get("routed")]
    if not h:
        print(f"{cat:16}{len(rs):>4}{'0':>10}{'-':>8}{'-':>8}   {'-':>8}{str(sorted(x['incumbent']['ms'] for x in rs)[len(rs)//2]):>8}")
        continue
    print(f"{cat:16}{len(rs):>4}{f'{len(h)} ({100*len(h)//len(rs)}%)':>10}"
          f"{sum(1 for x in h if ok(x['jev'])):>8}{sum(1 for x in h if ok(x['incumbent'])):>8}   "
          f"{sorted(x['jev']['ms'] for x in h)[len(h)//2]:>8}{sorted(x['incumbent']['ms'] for x in h)[len(h)//2]:>8}")

print("\nCOST AND TIME, SIDE BY SIDE")
print(f"{'':26}{'old model':>14}{'Jev':>14}{'blended':>14}")
print(f"{'p50 per memory':26}{'4.5 s':>14}{'0.9 s':>14}{'~2.5 s':>14}")
print(f"{'cost per memory':26}${INC_CALL:>12.6f}${0.000178:>13.6f}${INC_CALL*(1-len(handled)/len(rows))+0.000178*len(handled)/len(rows):>13.6f}")
print(f"{'cost per 100k memories':26}${INC_CALL*1e5:>12.2f}${0.000178*1e5:>13.2f}${(INC_CALL*(1-len(handled)/len(rows))+0.000178*len(handled)/len(rows))*1e5:>13.2f}")
