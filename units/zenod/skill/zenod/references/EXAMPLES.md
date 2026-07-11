# Zenod interaction examples

## Remember a decision

User: `Remember that Atlas launches on 18 September.`

Call `store_memory` once with the user's wording. Poll the returned ticket. Then report the evidence reference and commit, not merely “queued.”

## Exact lookup

User: `What was the Atlas launch date?`

Call `search_memory("Atlas launch date")`, read the relevant returned path with `get_memory`, and answer from that note with its source URL.

## Broad recall

User: `What do you remember about Atlas?`

Call `ask_brain`. Summarize only supported details, identify synthetic evidence if applicable, and retain the returned citations.

## Unknown attribute

User: `What is the Atlas coordinator's favorite dessert?`

If no cited evidence contains that attribute after sensible retrieval, answer that it is unknown. Do not infer a dessert from unrelated memories.

## Accepted write ticket

If `store_memory` returns `{ "ticket_id": "abc", "state": "accepted" }`, do not call it again. Poll `get_task_result` with that ticket until it returns terminal evidence or a loud error.
