from st import call
import json
# product/price/coupon in the sandbox, reused across runs
prods = call("GET","products/search",{"query":"metadata['t21']:'zenod-monthly'"})["data"]
prod = prods[0] if prods else call("POST","products",{"name":"Zenod (T2.1 test)","metadata[t21]":"zenod-monthly"})
prices = call("GET","prices",{"product":prod["id"],"active":"true"})["data"]
price = prices[0] if prices else call("POST","prices",{"product":prod["id"],"unit_amount":900,"currency":"eur","recurring[interval]":"month"})
try: cp = call("GET","coupons/T21_FREE_1M")
except SystemExit: cp = call("POST","coupons",{"id":"T21_FREE_1M","percent_off":100,"duration":"repeating","duration_in_months":1,"name":"Zenod tester month (T2.1 test)"})
print(json.dumps({"product":prod["id"],"price":price["id"],"coupon":cp["id"],"coupon_duration":cp["duration"],"months":cp["duration_in_months"]}))
