#!/usr/bin/env bash
# E15-S2 local check: the made-up demo memory (core test fixture tree-vault) plus a business note under a
# company tax branch and a short family note, served by ../../e15-s1/harness/serve.mjs. With --flags, the
# back-fill runs first, as it did on the real memory. Nothing here is a real person's note.
# usage: seed.sh <checkout> <data dir> [--flags]
set -euo pipefail
WT=$1 DATA=$2
rm -rf "$DATA" && mkdir -p "$DATA/seed"
cp -r "$WT/packages/core/test/fixtures/tree-vault/." "$DATA/seed/"
cd "$DATA/seed"
sed -i 's/^## Long-term memory$/- Kestrel tax and VAT | working | [[Areas\/Kestrel tax and VAT]] | Kestrel'"'"'s VAT returns, the company tax calendar and the studio'"'"'s prices.\n\n## Long-term memory/' Tree.md
cat > "Areas/Kestrel tax and VAT.md" <<'MD'
---
title: Kestrel tax and VAT
type: area
tags: [work]
created: 2026-10-02
updated: 2026-11-02
summary: Kestrel's quarterly VAT returns, the accountant's calendar and the studio's prices.
parent: "[[Tree]]"
memory: working
---

# Kestrel tax and VAT

The accountant files Kestrel's VAT return each quarter. See [[Notes/Studio day rate]].
MD
cat > "Notes/Studio day rate.md" <<'MD'
---
title: Studio day rate
type: note
tags: [work]
created: 2026-11-02
updated: 2026-11-02
summary: Raise the studio's day rate from 600 to 690 euros in January.
parent: "[[Areas/Kestrel tax and VAT]]"
---

# Studio day rate

Raise the studio's day rate from 600 to 690 euros in January and tell the three clients in December, before the new price list goes out.
MD
cat > "Notes/Sunday call.md" <<'MD'
---
title: Sunday call
type: note
tags: []
created: 2026-11-03
updated: 2026-11-03
summary: My sister and my father on the Sunday call about prices of the flat in January.
parent: "[[Areas/People and family]]"
---

# Sunday call

My sister and my father talked about the prices of the flat in January; my mother wants to wait.
MD
if [ "${3:-}" = "--flags" ]; then
  node -e 'import(process.argv[1]).then(async (m) => console.log(JSON.stringify(await m.backfillPrivateFlags(process.argv[2], { write: true }))))' "$WT/packages/core/dist/vault/privacy.js" "$DATA/seed"
fi
git init -q -b main && git -c user.email=demo@example.test -c user.name=demo add -A && git -c user.email=demo@example.test -c user.name=demo commit -q -m seed
git clone -q --bare "$DATA/seed" "$DATA/origin.git"
