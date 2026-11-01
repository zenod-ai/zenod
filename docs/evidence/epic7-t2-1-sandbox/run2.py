import json, sys, time
from st import call, advance
PRICE, START, EXT = sys.argv[1], "T21_FREE_1M", "T21_EXTEND_ONCE"
try: call("GET", f"coupons/{EXT}")
except SystemExit: call("POST","coupons",{"id":EXT,"percent_off":100,"duration":"once","name":"Zenod tester: next renewal free"})
DAY=86400; log=[]
def zenod(st):
    m={"active":"active","trialing":"active","past_due":"past_due","incomplete":"past_due","paused":"paused"}.get(st,"canceled"); return m
def snap(label, sid, t):
    s=call("GET",f"subscriptions/{sid}",{"expand[]":["latest_invoice"]}); inv=s.get("latest_invoice") or {}; d=s.get("discount") or {}
    row={"step":label,"clock":time.strftime("%Y-%m-%d %H:%M",time.gmtime(t)),"sub_status":s["status"],"zenod_status":zenod(s["status"]),
      "period_end":time.strftime("%Y-%m-%d",time.gmtime(s["current_period_end"])),"discount":(d.get("coupon") or {}).get("id"),
      "latest_invoice":inv.get("id"),"inv_total":inv.get("total"),"inv_status":inv.get("status")}
    log.append(row); print(json.dumps(row),flush=True); return s
t0=int(time.time())
clock=call("POST","test_helpers/test_clocks",{"frozen_time":t0,"name":"t21-once"})["id"]
cus=call("POST","customers",{"test_clock":clock,"email":"t21-once@example.com","name":"T2.1 once","address[country]":"ES"})["id"]
sub=call("POST","subscriptions",{"customer":cus,"items[0][price]":PRICE,"discounts[0][coupon]":START,"collection_method":"charge_automatically","metadata[product]":"zenod"})
sid=sub["id"]; print(json.dumps({"clock":clock,"customer":cus,"subscription":sid}))
s=snap("0 checkout €0 no card (1-month 100% coupon)",sid,t0); pe=s["current_period_end"]
def ext(label,t):
    call("POST",f"subscriptions/{sid}",{"discounts[0][coupon]":EXT,"proration_behavior":"none"}); return snap(label,sid,t)
t=t0+10*DAY; advance(clock,t); ext("m1 extend (once coupon) on day 10",t)
t=t0+11*DAY; advance(clock,t); ext("m1 extend again day 11 (idempotent?)",t)
t=pe+2*3600; advance(clock,t); s=snap("m1 renewal +2h",sid,t); pe=s["current_period_end"]
t=t+DAY; advance(clock,t); ext("m2 extend the day after renewal",t)
t=pe+2*3600; advance(clock,t); s=snap("m2 renewal +2h",sid,t); pe=s["current_period_end"]
t=pe-DAY; advance(clock,t); ext("m3 extend 1 day before renewal",t)
t=pe+2*3600; advance(clock,t); s=snap("m3 renewal +2h",sid,t); pe=s["current_period_end"]
t=pe+2*3600; advance(clock,t); s=snap("m4 renewal +2h, NOT extended (control)",sid,t)
inv=call("GET","invoices",{"customer":cus,"limit":20})["data"]
print(json.dumps({"invoices":[(i["id"],i["total"],i["status"],time.strftime("%Y-%m-%d",time.gmtime(i["created"]))) for i in reversed(inv)]}))
json.dump({"clock":clock,"customer":cus,"subscription":sid,"log":log},open("/tmp/t21/once.json","w"),indent=1)
