#!/usr/bin/env python3
"""Time and cost tables, plus safety-oriented slices."""
import json
from collections import defaultdict

r = json.load(open("classify-results.json"))
rows = r["rows"]
JEV_USD_PER_MTOK = 0.042
INC_COST_TOTAL = r["spentUsd"]
INC_CALLS = r["incumbentCalls"]

def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else None

inc_ms = [x["incumbent"]["ms"] for x in rows if x["incumbent"].get("score")]
jev_ms = [x["jev"]["ms"] for x in rows if x["jev"].get("verdict")]
inc_tok = None  # per-row incumbent usage was not captured
jev_tok = [x["jev"]["verdict"]["inputTokens"] for x in rows if x["jev"].get("verdict")]

print("=== TIME ===")
print(f"{'':12}{'n':>5}{'p50':>8}{'p90':>8}{'p99':>8}{'min':>8}{'max':>8}")
for name, xs in (("incumbent", inc_ms), ("jev", jev_ms)):
    print(f"{name:12}{len(xs):>5}{pct(xs,.5):>8}{pct(xs,.9):>8}{pct(xs,.99):>8}{min(xs):>8}{max(xs):>8}")
print(f"speedup p50 {pct(inc_ms,.5)/pct(jev_ms,.5):.1f}x   p90 {pct(inc_ms,.9)/pct(jev_ms,.9):.1f}x")

print("\n=== COST ===")
inc_per_call = INC_COST_TOTAL / INC_CALLS
jev_total = sum(jev_tok) * JEV_USD_PER_MTOK / 1e6
jev_per_call = jev_total / len(jev_tok)
print(f"incumbent: {INC_CALLS} calls  ${INC_COST_TOTAL:.4f}  ${inc_per_call:.6f}/call  median in-tokens n/a")
print(f"jev      : {len(jev_tok)} calls  ${jev_total:.4f}  ${jev_per_call:.6f}/call  median in-tokens {pct(jev_tok,.5)}")
print(f"per-call ratio: {inc_per_call/jev_per_call:.2f}x cheaper on jev")
print()
print(f"{'scale':>10}{'incumbent':>12}{'jev':>12}")
for label, n in (("1k", 1_000), ("100k", 100_000), ("1M", 1_000_000)):
    print(f"{label:>10}${inc_per_call*n:>11.2f}${jev_per_call*n:>11.2f}")
covered = sum(1 for x in rows if x["jev"].get("routed")) / len(rows)
blend = inc_per_call * (1 - covered) + jev_per_call * covered
print(f"\nblended at {100*covered:.1f}% coverage: ${blend:.6f}/call  ({inc_per_call/blend:.2f}x cheaper than incumbent alone)")

print("\n=== PER CATEGORY ===")
bycat = defaultdict(list)
for x in rows: bycat[x["category"]].append(x)
print(f"{'category':16}{'n':>4}{'inc ok':>9}{'jev ok':>9}{'routed':>8}{'inc p50':>9}{'jev p50':>9}{'jev $/call':>12}")
for cat in sorted(bycat):
    rs = bycat[cat]
    io = sum(1 for x in rs if x["incumbent"].get("score") and x["incumbent"]["score"]["correct"])
    jo = sum(1 for x in rs if x["jev"].get("score") and x["jev"]["score"]["correct"])
    rt = sum(1 for x in rs if x["jev"].get("routed"))
    ip = pct([x["incumbent"]["ms"] for x in rs if x["incumbent"].get("score")], .5)
    jp = pct([x["jev"]["ms"] for x in rs if x["jev"].get("verdict")], .5)
    jt = sum(x["jev"]["verdict"]["inputTokens"] for x in rs if x["jev"].get("verdict"))
    jn = sum(1 for x in rs if x["jev"].get("verdict"))
    print(f"{cat:16}{len(rs):>4}{f'{io}/{len(rs)}':>9}{f'{jo}/{len(rs)}':>9}{f'{rt}/{len(rs)}':>8}{ip:>9}{jp:>9}{jt*JEV_USD_PER_MTOK/1e6/max(1,jn):>12.6f}")

print("\n=== SAFETY SLICES ===")
adv = [x for x in rows if x["category"] == "adversarial"]
print(f"adversarial injections   incumbent {sum(1 for x in adv if x['incumbent'].get('score') and x['incumbent']['score']['correct'])}/{len(adv)}   jev {sum(1 for x in adv if x['jev'].get('score') and x['jev']['score']['correct'])}/{len(adv)}   jev-routed {sum(1 for x in adv if x['jev'].get('routed'))}")
ns = [x for x in rows if x["category"] == "non-substantive"]
print(f"non-substantive (must not invent a destination)  incumbent {sum(1 for x in ns if x['incumbent'].get('score') and x['incumbent']['score']['correct'])}/{len(ns)}   jev {sum(1 for x in ns if x['jev'].get('score') and x['jev']['score']['correct'])}/{len(ns)}")
wrong_writes = [x for x in rows if x["jev"].get("routed") and not x["jev"]["score"]["correct"]]
wrong_new = [x for x in wrong_writes if x["category"] == "new-page"]
print(f"Jev auto-filed to a wrong page: {len(wrong_writes)}   of which misfiled-new-subject: {len(wrong_new)}")
inc_wrong = [x for x in rows if not (x["incumbent"].get("score") and x["incumbent"]["score"]["correct"])]
print(f"incumbent wrong: {len(inc_wrong)}")
print(f"escaped to a human/fallback (jev declined): {sum(1 for x in rows if not x['jev'].get('routed'))}/{len(rows)}")
