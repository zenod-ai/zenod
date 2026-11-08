#!/usr/bin/env python3
"""E14-S8 live test call on a test path (no user's account, no user's memory).

Run on VPS1 with Zenod's key in the environment, never printed:
  secret run --from agent-team-console OPENAI_API_KEY -- python3 live-call.py session.json out.json

1. Mints a 1-minute client key exactly as Zenod's server does (POST /v1/realtime/client_secrets with
   Zenod's session: model, voice, instructions, the three tools). A 429 insufficient_quota stops here.
2. Opens the Realtime session with that client key (WebSocket; the browser uses WebRTC with the same key),
   has the voice say the greeting, then sends three caller turns as text: a question (the voice must call
   ask_memory; a canned answer from a made-up test vault goes back), a job (desk_job; a canned "started"),
   and a goodbye (hang_up). The voice answers in audio, as on a real call.
3. Writes every response.done usage, the transcript and the tool calls to out.json; the cost is priced
   with Zenod's own table (memoryCall.ts costOf) afterwards.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

import websocket

session_path, out_path = sys.argv[1], sys.argv[2]
# The same value as zenod-mt/OPENAI_REALTIME_KEY; `secret run` hands out the shared name.
key = (os.environ.get("OPENAI_REALTIME_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip()
if not key:
    sys.exit("no key in the environment")
config = json.load(open(session_path))
model = config["session"]["model"]
out = {"model": model, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "usage": [], "lines": [], "tools": [], "errors": []}

req = urllib.request.Request(
    "https://api.openai.com/v1/realtime/client_secrets",
    data=json.dumps(config).encode(),
    headers={"authorization": f"Bearer {key}", "content-type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        minted = json.load(r)
except urllib.error.HTTPError as e:
    body = e.read().decode(errors="replace")
    code = ""
    try:
        code = json.loads(body).get("error", {}).get("code") or ""
    except Exception:
        pass
    out["mint"] = {"status": e.code, "code": code}
    json.dump(out, open(out_path, "w"), indent=1)
    print(f"MINT REFUSED {e.code} {code}")
    sys.exit(2)
client = minted["value"]
out["mint"] = {"status": 200, "expires_in_s": minted.get("expires_at", 0) - int(time.time()), "session_id": (minted.get("session") or {}).get("id")}
print("minted a client key, session", out["mint"]["session_id"])

ws = websocket.create_connection(f"wss://api.openai.com/v1/realtime?model={model}", header=[f"Authorization: Bearer {client}"], timeout=60)


def send(ev):
    ws.send(json.dumps(ev))


CANNED = {
    "ask_memory": {"answered": True, "answer": "Ana the plumber fixed the boiler on 6 October.", "from": ["Boiler", "House"]},
    "desk_job": {"started": True, "title": "Cabin decision as its own topic", "note": "Queued, not done yet. Tell the caller in one short line, speaking to them: the memory desk has it and they will see the result in your inbox, where you can undo it."},
    "hang_up": {"ok": True},
}


def run_response(limit_s=45):
    """Read events until a response.done that is not followed by a tool round; answer tool calls."""
    deadline = time.time() + limit_s
    hung_up = False
    while time.time() < deadline:
        ev = json.loads(ws.recv())
        t = ev.get("type")
        if t in ("response.output_audio_transcript.done", "response.audio_transcript.done"):
            out["lines"].append({"who": "zenod", "text": ev.get("transcript", "")})
            print("ZENOD:", ev.get("transcript", ""))
        elif t == "response.function_call_arguments.done":
            name = ev.get("name")
            args = json.loads(ev.get("arguments") or "{}")
            out["tools"].append({"name": name, "arguments": args})
            print("TOOL:", name, args)
            if name == "hang_up":
                hung_up = True
                continue
            send({"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": ev["call_id"], "output": json.dumps(CANNED.get(name, {}))}})
            pending_tool[0] = True
        elif t == "response.done":
            usage = (ev.get("response") or {}).get("usage")
            if usage:
                out["usage"].append({"id": ev["response"].get("id"), "usage": usage})
            status = (ev.get("response") or {}).get("status")
            if pending_tool[0]:
                pending_tool[0] = False
                send({"type": "response.create"})
                continue
            return status, hung_up
        elif t == "error":
            out["errors"].append(ev.get("error"))
            print("ERROR:", (ev.get("error") or {}).get("code"), (ev.get("error") or {}).get("message"))
            if (ev.get("error") or {}).get("code") in ("insufficient_quota",):
                return "no_credit", hung_up
    return "timeout", hung_up


pending_tool = [False]
t0 = time.time()
greeting = 'Hi, this is your Zenod library line. What would you like to know?'
send({"type": "response.create", "response": {"instructions": f'Say exactly this greeting and nothing else: "{greeting}"'}})
status, _ = run_response()
for said in ["What did the plumber fix at the house?", "Can you take the cabin decision out of boat repair and make it its own topic?", "That's all, thanks. Bye."]:
    if status in ("no_credit", "timeout"):
        break
    out["lines"].append({"who": "you", "text": said})
    print("YOU:", said)
    send({"type": "conversation.item.create", "item": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": said}]}})
    send({"type": "response.create"})
    status, hung = run_response()
    if hung:
        break
ws.close()
out["seconds"] = round(time.time() - t0, 1)
out["ended"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
out["status"] = status
json.dump(out, open(out_path, "w"), indent=1)
print("done", status, out["seconds"], "s,", len(out["usage"]), "responses")
