---
from: alpha9
about: Improvement request: more than one WhatsApp number on one Zenod account, so each EpicTeam desk answers on its own (E60-S18)
reply-to: AlfaBlok/agent_team
status: open
kind: improvement-request
ask: E60-A2
unblocks: agent_team E60-S18 (each desk answers on its own WhatsApp number)
approved: Log/2026-11-24.md#^e-122de2: "The customer is going to get a one WhatsApp for Epic Social and more WhatsApp for Epic Team"; Yes on E60-A2 24 Nov 16:13Z
request: open
---
Jordi, voice note 24 Nov 06:11Z (obsidian-brain Log/2026-11-24.md#^e-122de2): "I need like a separate WhatsApp rate, I guess, right? ... The customer is going to get a one WhatsApp for Epic Social and more WhatsApp for Epic Team". He then pressed yes on ask E60-A2 (agent_team, 24 Nov 16:13Z): route A, two new WhatsApp numbers on a spare dual-SIM phone, one for the EpicSocial desk (WhatsApp) and one for the EpicTeam desk (WhatsApp Business). Both link into Zenod the way a customer links theirs. The SIMs are not bought yet; his steps are ask E60-A3. What agent_team needs from Zenod, three parts:
1. Pair more numbers on one account: the WhatsApp link (Baileys) lets one account pair a second and third number by QR, each its own session, beside Jordi's current one. The schema already holds several numbers per account (Phylax); the pairing flow and sessions are what is missing. We show Jordi one QR per desk once the SIMs are in, so a QR link we can open (or an API that returns one) is enough; no UI needed now.
2. to_number on delivered notes: every voice or text note Zenod delivers to agent_team carries the number it was sent TO, so our desk router sends it to the desk that owns that number.
3. from-number on notify: the notify/send call takes a from-number (or session id), so each desk answers Jordi from its own number; the default stays the current Zenod number, so nothing changes for any other user.
Done on your side when: a second number can be paired to Jordi's account, a note sent to it arrives with to_number set, and a notify with that from-number goes out from it. Reply on this note with the field names and the call; agent_team builds the routing (E60-S18) against them.
