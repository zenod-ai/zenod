import json, sys, time, urllib.request, urllib.parse, os
KEY = open(os.environ.get("STRIPE_KEY_FILE", "/tmp/t21/key")).read().strip()
assert KEY.startswith("sk_test_"), "test key only"
VER = "2025-02-24.acacia"
def call(method, path, params=None):
    data = None
    url = "https://api.stripe.com/v1/" + path
    if params:
        enc = urllib.parse.urlencode(params, doseq=True)
        if method == "GET": url += "?" + enc
        else: data = enc.encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + KEY, "Stripe-Version": VER})
    try:
        with urllib.request.urlopen(req) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: {e.code} {e.read().decode()[:500]}")
def advance(clock, to):
    call("POST", f"test_helpers/test_clocks/{clock}/advance", {"frozen_time": int(to)})
    for _ in range(120):
        c = call("GET", f"test_helpers/test_clocks/{clock}")
        if c["status"] == "ready": return
        time.sleep(2)
    raise SystemExit("clock stuck")
