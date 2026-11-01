import json, time
from st import call, advance
PRICE="price_1UWskz76yJ3p1J6XreTpyfdS"; DAY=86400; log=[]
def snap(label,sid,t):
    s=call("GET",f"subscriptions/{sid}",{"expand[]":["latest_invoice"]}); i=s["latest_invoice"]; d=s.get("discount") or {}
    r={"step":label,"clock":time.strftime("%Y-%m-%d %H:%M",time.gmtime(t)),"sub_status":s["status"],"discount":(d.get("coupon") or {}).get("id"),"latest_invoice":i["id"],"inv_total":i["total"],"inv_status":i["status"]}
    log.append(r); print(json.dumps(r)); return s
t0=int(time.time()); clock=call("POST","test_helpers/test_clocks",{"frozen_time":t0,"name":"t21-recover-once"})["id"]
cus=call("POST","customers",{"test_clock":clock,"email":"t21-ro@example.com"})["id"]
sid=call("POST","subscriptions",{"customer":cus,"items[0][price]":PRICE,"discounts[0][coupon]":"T21_FREE_1M","metadata[product]":"zenod"})["id"]
s=snap("0 €0 no card",sid,t0); pe=s["current_period_end"]
t=pe+2*3600; advance(clock,t); s=snap("renewal +2h, forgot to extend",sid,t); inv=s["latest_invoice"]["id"]
t+=DAY; advance(clock,t)
call("POST",f"subscriptions/{sid}",{"discounts[0][coupon]":"T21_EXTEND_ONCE","proration_behavior":"none"}); call("POST",f"invoices/{inv}/void")
s=snap("+1d recover: once coupon + void open invoice",sid,t); pe=s["current_period_end"]
t=pe+2*3600; advance(clock,t); snap("next renewal +2h",sid,t)
json.dump({"clock":clock,"customer":cus,"subscription":sid,"log":log},open("/tmp/t21/recover-once.json","w"),indent=1)
