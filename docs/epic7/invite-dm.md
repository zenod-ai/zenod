# Tester invites (EPIC-7 T5, EPIC-26 T1; drafts, not sent)

Spine: [EPIC-7](../EPIC-7-REAL-USER-TEST.md), row T5. Sent by T9 (zenod-social Responder, as Jordi on Reddit) only after T8's go; nothing here has been sent or posted. Jordi reviews the wording after the fact.

Voice: zenod-social [message house](https://github.com/AlfaBlok/zenod-social/blob/main/data/message-house.md) for Reddit: Jordi in the first person, casual, plain words, no exclamation marks, no hype, and "I built Zenod" near the top. The free offer is said only here, in a 1:1 DM to someone who asked to test (the message house's "Never say" on free offers is about public posts; T9 lands the exception in its Feedback log when it sends).

Fill in per person: `{NAME}` (Reddit handle or first name), `{CODE}` (their own single-use code from T4; unused codes expire 14 days after they are made). Keep `{HOOK}` to one line about what they said on the thread, or drop it.

## The first invite: someone Jordi knows, by WhatsApp or email (EPIC-26 T1)

Jordi's voice note of 2026-11-10 (Zenod Log ^e-ecf0b8): the invite says plainly what a tester gets, three things, then what happens next. Fill in `{NAME}` and `{CODE}`; Jordi sends it himself, agents never do. About 190 words, one message.

> Hi {NAME}, I've been building something called Zenod, a memory you talk to, and I'd love you to be one of the first people to try it.
>
> You get three things:
> 1. A WhatsApp number for your voice notes. Talk to it like you'd leave yourself a note. It writes down every word and files it.
> 2. Your memory stays in your own account. Everything you send is written word for word into plain files in your own Google Drive or GitHub.
> 3. A knowledge graph of your notes that Claude, ChatGPT, Cursor or any AI tool with MCP can read and add to.
>
> It's free while you test, and no card is needed. What happens next:
> 1. Sign in at https://cloud.zenod.dev with Google, choose Hosted, and at checkout click "Add promotion code" and enter {CODE}. The total is €0.
> 2. Pick Google Drive or GitHub for your notes. Then in Settings › WhatsApp & Telegram type your number and send the code it shows to the Zenod number on WhatsApp. From then on, just talk to it.
>
> More on what you get: https://zenod.dev/testers. If anything breaks or feels odd, tell me, even one line helps. The code is only for you and works for two weeks.

Email subject, if he sends it by email: "Want to try Zenod before anyone else?"

Every claim holds on production today: the WhatsApp scene, the log in your own Drive or GitHub and the graph view are the real screens on zenod.dev/testers (PR #1581); MCP read and write tools are listed on zenod.dev/connect; €0 checkout with no card and the monthly extension are proven below.

## The Reddit DM

> Hey {NAME}, Jordi here, I built Zenod. {HOOK} You said you'd be up for testing it, so here's a proper invite.
>
> You get three things: a WhatsApp number you send voice notes to; a word-for-word copy of everything you send, in your own Google Drive or GitHub; and a knowledge graph of your notes that Claude, ChatGPT, Cursor or any AI tool with MCP can read and add to.
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
