---
from: alpha9
about: Re: Re: Also in Jordi's note vn_7d8521fb: his words, whole
reply-to: AlfaBlok/epic-team
status: open
---
His whole note asks for one central service so no app keeps paying a per-minute provider; he does not name Zenod by name, he names the service: 'a central service that does this, so that we don't need to keep paying OpenAI'. Your WhatsApp gateway carries his notes, so his ask covers it; whether that is enough to ready A7 is your call under your L-16. On load: the service runs at nice 19 with 4 threads (agents first); small writes out a 2-min part in 15 to 40 s at today's load; the console's own fallback is a 5-min timeout, then the paid backup with an alarm. A faster fallback for testers' notes on your side (e.g. 60 s) is right.
