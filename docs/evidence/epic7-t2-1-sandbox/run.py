import json, sys, time
from st import call, advance
PRICE, COUPON = sys.argv[1], sys.argv[2]
scenario = sys.argv[3]  # lapsed | extended | recover
DAY = 86400
def zenod(status):
    m = {"active":"active","trialing":"active","past_due":"past_due","incomplete":"past_due","paused":"paused"}.get(status,"canceled")
    return m, ("tenant active" if m in ("active","past_due") else "tenant SUSPENDED")
log = []
def snap(label, sub_id, clock_time):
    s = call("GET", f"subscriptions/{sub_id}", {"expand[]":["latest_invoice","discount"]})
    inv = s.get("latest_invoice") or {}
    d = s.get("discount") or {}
    z = zenod(s["status"])
    row = {"step":label, "clock":time.strftime("%Y-%m-%d %H:%M", time.gmtime(clock_time)),
           "sub_status":s["status"], "zenod_status":z[0], "zenod_tenant":z[1],
           "period_end":time.strftime("%Y-%m-%d", time.gmtime(s["current_period_end"])),
           "discount": (d.get("coupon") or {}).get("id"), "discount_end": d.get("end") and time.strftime("%Y-%m-%d %H:%M", time.gmtime(d["end"])),
           "latest_invoice": inv.get("id"), "inv_total": inv.get("total"), "inv_amount_due": inv.get("amount_due"),
           "inv_status": inv.get("status"), "attempts": inv.get("attempt_count"),
           "next_attempt": inv.get("next_payment_attempt") and time.strftime("%Y-%m-%d %H:%M", time.gmtime(inv["next_payment_attempt"]))}
    log.append(row); print(json.dumps(row), flush=True); return s
t0 = int(time.time())
clock = call("POST","test_helpers/test_clocks",{"frozen_time":t0,"name":f"t21-{scenario}"})["id"]
cus = call("POST","customers",{"test_clock":clock,"email":f"t21-{scenario}@example.com","name":f"T2.1 {scenario}","address[country]":"ES"})["id"]
sub = call("POST","subscriptions",{"customer":cus,"items[0][price]":PRICE,"discounts[0][coupon]":COUPON,
  "collection_method":"charge_automatically","payment_settings[save_default_payment_method]":"on_subscription",
  "metadata[product]":"zenod","metadata[t21]":scenario})
print(json.dumps({"clock":clock,"customer":cus,"subscription":sub["id"],"status":sub["status"]}), flush=True)
s = snap("0 checkout €0 no card", sub["id"], t0)
pe = s["current_period_end"]
def extend(label, now):
    call("POST", f"subscriptions/{sub['id']}", {"discounts[0][coupon]":COUPON, "proration_behavior":"none"})
    return snap(label, sub["id"], now)
if scenario in ("extended",):
    for month in (1, 2):
        t = pe - 3*DAY; advance(clock, t); s = extend(f"m{month} extend 3 days before renewal", t)
        t = pe + 2*3600; advance(clock, t); s = snap(f"m{month} renewal +2h", sub["id"], t)
        pe = s["current_period_end"]
if scenario in ("lapsed","recover"):
    t = pe + 2*3600; advance(clock, t); s = snap("m1 renewal +2h (no extension)", sub["id"], t)
    if scenario == "recover":
        inv = s["latest_invoice"]["id"] if isinstance(s["latest_invoice"],dict) else s["latest_invoice"]
        t += DAY; advance(clock, t); snap("+1d still past_due?", sub["id"], t)
        call("POST", f"subscriptions/{sub['id']}", {"discounts[0][coupon]":COUPON, "proration_behavior":"none"})
        call("POST", f"invoices/{inv}/void")
        s = snap("recover: coupon + void open invoice", sub["id"], t)
        pe = s["current_period_end"]
        t = pe + 2*3600; advance(clock, t); snap("next renewal +2h", sub["id"], t)
    else:
        for d in (1, 3, 5, 8, 12, 16, 22, 30):
            t = pe + d*DAY; advance(clock, t); s = snap(f"renewal +{d}d", sub["id"], t)
            if s["status"] in ("canceled","unpaid"): break
ev = call("GET","events",{"limit":100})["data"]
types = [e["type"] for e in reversed(ev) if (e["data"]["object"].get("customer")==cus or e["data"]["object"].get("id")==cus)]
print(json.dumps({"events":types}))
json.dump({"clock":clock,"customer":cus,"subscription":sub["id"],"log":log,"events":types}, open(f"/tmp/t21/{scenario}.json","w"), indent=1)
