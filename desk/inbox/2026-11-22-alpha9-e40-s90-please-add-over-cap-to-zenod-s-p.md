---
from: alpha9
about: E40-S90: please add over_cap to Zenod's public counts
reply-to: AlfaBlok/epic-team
status: open
product-from: vn_68cda1fe: "the first one is, um, Zinod, and it says five testers"
---
Jordi's vn_68cda1fe (22 Nov 09:28Z) rewrote a Zenod key result: "Zero testers spend above cap. And then the target is zero, and what's the current?" We read it from cloud.zenod.dev/api/public/counts. Please add one number, over_cap: testers (our tests left out) whose spend went above their cap in the last 7 days. Until it is there, our check reads 0 only in a week with no active tester, and 'not counted yet' otherwise (agent_team scripts/kr_measures.py zenod_over_cap).
