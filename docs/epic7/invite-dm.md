# EPIC-7 T5: tester invite DM (draft, not sent)

Spine: [EPIC-7](../EPIC-7-REAL-USER-TEST.md), row T5. Sent by T9 (zenod-social Responder, as Jordi on Reddit) only after T8's go; nothing here has been sent or posted. Jordi reviews the wording after the fact.

Voice: zenod-social [message house](https://github.com/AlfaBlok/zenod-social/blob/main/data/message-house.md) for Reddit: Jordi in the first person, casual, plain words, no exclamation marks, no hype, and "I built Zenod" near the top. The free offer is said only here, in a 1:1 DM to someone who asked to test (the message house's "Never say" on free offers is about public posts; T9 lands the exception in its Feedback log when it sends).

Fill in per person: `{NAME}` (Reddit handle or first name), `{CODE}` (their own single-use code from T4; unused codes expire 14 days after they are made). Keep `{HOOK}` to one line about what they said on the thread, or drop it.

## The DM

> Hey {NAME}, Jordi here, I built Zenod. {HOOK} You said you'd be up for testing it, so here's a proper invite.
>
> It's yours free while you test. Sign up at https://cloud.zenod.dev with Google, hit Subscribe, and at checkout click "Add promotion code" and put in {CODE}. The total goes to €0. You don't need to add a card or any payment details, and you won't be charged.
>
> The code gives you a month free, and I'll keep extending it month by month while you're using it and telling me how it goes. I'm never going to charge you for this.
>
> Once you're in, pick where your notes live (Google Drive or GitHub). Then open Settings, then WhatsApp & Telegram, type your number, and send the short code it shows you to the Zenod number on WhatsApp. After that just send it voice notes or texts like you would to yourself, and it files them and replies Saved. If you get stuck anywhere, tell me and I'll sort it.
>
> For feedback, just reply here, anything goes: what broke, what felt weird, what you'd want it to do. Even one line helps. The code is only for you and works once, and if you don't use it in the next two weeks it expires, so tell me and I'll send a fresh one.

About 210 words. (E23-U1, 2026-11-09: the WhatsApp step now names where it lives in the app since the 9 Nov layout, Settings › WhatsApp & Telegram.) Reddit chat has no length limit worth worrying about; keep it to one message.

## Notes for T9 / T6

- **Feedback channel (proposed): reply to this same Reddit DM.** It is where each tester already talks to Jordi, so nothing new to set up and nothing to share (no phone number). T6 records it as the channel; the Responder logs each reply in zenod-social `data/posts-ledger.md` as a DM-reply row and in the T6 view. If Jordi prefers WhatsApp to him personally, swap the last paragraph's first sentence for: "For feedback, WhatsApp me at {JORDI_NUMBER}, anything goes."
- **Every claim is true for any user with a 100% code**, which is all a tester is (spine Decisions 2026-10-27: no tester mode): €0 checkout with no card is `payment_method_collection: if_required` (live-proven twice, [T1](../evidence/epic7-t1-new-user-path-2026-10-31.md)); "won't be charged" holds because no card is on file and the monthly extension is a `once` 100% coupon ([T2.1](../evidence/epic7-t2-1-2026-11-01.md), [runbook](../runbooks/epic7-tester-monthly-extension.md)); if an extension is ever missed, the renewal invoice fails on no card and Zenod sends a notice before access stops (T2.1 backstop).
- **"Never going to charge you"** is Jordi's own promise (spine Decisions 2026-10-27). It holds only while the operator never adds a card for them and the extension is applied each month (T10 daily check).
- The same wording appears in the product, for every full-discount user: above Stripe's pay button, on the console before checkout ("Have a code?"), and on the console Subscription card after checkout ("Free: your code covers the full price … runs until <date> … we extend it month by month"). See [T5 evidence](../evidence/epic7-t5-2026-11-01.md).
- Do not paste the code into any public reply or post; DM only. T4 keeps the who-got-which-code list private on VPS1.
