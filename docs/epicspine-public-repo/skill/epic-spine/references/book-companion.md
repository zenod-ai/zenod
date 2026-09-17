# EpicSpine Book Companion

Read this reference when installing, repairing, validating, or materially extending a repository's Book, or when a knowledge-producing result has no obvious landing place.

## Purpose

The Book is the durable human knowledge surface that accompanies, but does not replace, an EpicSpine.

| Surface | Owns |
|---|---|
| EpicSpine | Developmental intent, scope, execution state, backlog, decisions, dependencies, gates, and acceptance |
| GitHub issue | Detailed execution of one bounded step |
| Code, data, and validation | What exists and what has been proved |
| Book root | Shallow user-facing index, chapter map, current synthesis links, and the canonical collection view |
| Canonical registry | The current structured collection or shortlist shown by the Book |
| Chapter | A shallow index for one durable knowledge domain |
| Leaf | The substantive explanation, research, comparison, or conclusion for one bounded question |
| Evidence | The sources and observations supporting claims in a leaf |

The spine answers, “What are we trying to accomplish, where is the work, and what happens next?” The Book answers, “What do we now know, how does it fit together, and where can the user inspect it?”

## Activation And Automatic Binding

Book behavior is repository-configured, not universal. Activate it by placing the fields from `assets/book-companion-contract.md` in the repository's applicable `AGENTS.md` or canonical root spine.

Once the declaration says `Status: active`, any agent bound to a spine in that scope is also a Book author. It must inspect the Book during bootstrap and apply the landing test below without waiting for the user to say “write this to the Book.” Reviewer, observer, and other read-only bindings propose the landing but do not gain mutation authority merely from Book activation.

Binding as an author does not automatically grant stewardship over the root or mutation rights over the registry. The declaration controls those permissions.

## Minimum Durable Shape

The implementation may use repository-specific names, but it must expose these roles:

```text
docs/book/
  BOOK.html                 shallow canonical root
  chapters/
    DOMAIN.html             chapter index
  leaves/
    domain/
      bounded-question.html
  data/
    registry.json           optional canonical collection
```

The root and leaves should be durable standalone HTML unless the repository declares another human-facing format. A machine-readable manifest or generated JavaScript view is optional; if present, declare its source/generation relationship. Do not make a generated payload independently authoritative.

The root stays shallow. It may contain the goal, a compact current synthesis, the chapter map, prominent current leaves, and a filterable view of the canonical registry. Detailed arguments belong in leaves.

## Knowledge Landing Test

Create or materially update a leaf when the result is likely to remain useful after the current chat and includes one of:

- research findings or an evidence-backed synthesis;
- a comparison, recommendation, decision analysis, or option set;
- a reusable explanation of product behavior or system output;
- a substantial user-facing status or strategic review whose value is the understanding, not merely ticket state;
- a conclusion that future work should be able to trace back to evidence.

Keep the result out of the Book when it is only:

- a short conversational answer;
- transient execution status or a reportback already owned by an issue;
- raw logs, debugging detail, or uncurated evidence;
- an implementation change with no durable explanatory value;
- sensitive content outside the Book's declared scope.

When uncertain, ask whether a future user or agent would benefit from navigating to this answer without reconstructing the chat. If yes, land it.

## Reuse Before Creation

Before creating a node:

1. Read the root and the narrowest relevant chapter.
2. Search existing leaf titles, stable IDs, headings, and registry entries.
3. Update the existing owning leaf when the question is substantially the same.
4. Create a leaf only for a genuinely distinct durable question.
5. Create a chapter only when no current chapter can coherently own the leaf.

Use stable semantic filenames and IDs. Update in place; never create `v2`, `final`, `new`, or a dated replacement merely to avoid editing the canonical node. Use Git history and explicit archive state for versions.

## Navigation Invariants

Every active leaf must have:

- a visible link back to its owning chapter;
- a visible link back to the Book root;
- one reciprocal descriptive link from the owning chapter;
- a path from the root through the chapter to the leaf.

The root directly links only current, foundational, or decision-significant leaves. Supporting and superseded material remains reachable through its chapter so the root does not become a dump.

If sibling or parent leaves form a meaningful sequence, add those links without changing canonical chapter ownership. Validate paths from both directions.

## Canonical Registry

A Book may declare one structured collection: candidates, ideas, claims, tools, experiments, suppliers, decisions, locations, papers, or any other open-ended set. The declaration must name its source and stable row identity.

- One real-world item has one durable row.
- Views, chapters, and leaves may filter or explain rows; they must not maintain another live list.
- Preserve rows that affected reasoning with states such as archived, rejected, closed, reserve, or superseded.
- Delete only accidental duplicates that never acquired distinct evidence or history.
- Update the registry only when knowledge changes the collection's canonical state, not merely because a leaf mentions an item.
- If the rendered table uses a generated payload, edit the declared source and regenerate the view; never hand-edit both as peers.

A Book without a natural structured collection may declare `Canonical registry: none`. Do not invent a database merely to satisfy the pattern.

## Author And Steward Scope

Default permissions for an active Book:

- A bound spine agent may create or update the one leaf needed for its material user-facing result and add the reciprocal link in its owning chapter.
- The Book steward owns root curation, cross-chapter structure, archive policy, and registry reconciliation unless the declaration delegates them.
- An author without root or registry authority returns a proposed promotion or row delta to the Book steward; this does not block creation of the navigable leaf.
- Concurrent authors should work in separate branches/worktrees and avoid editing the same chapter index. The steward reconciles collisions.

If the Book declaration names no separate steward, the active root-spine steward is the Book steward. A branch or ticket worker does not become root steward merely because it authored a leaf.

## Reconciliation Loops

Keep execution and knowledge as two connected loops:

```text
execution: objective -> issue -> code/data -> validation -> spine state
knowledge: evidence -> registry delta (if any) -> leaf -> chapter -> root promotion (if warranted)
```

Either loop may trigger the other. Research may create a development ticket; implementation may produce an explanatory leaf. Do not copy the issue log into the leaf or the leaf's argument into the spine. Link them and reconcile only the durable consequence.

For a knowledge-producing task, use this order:

1. inspect current evidence and existing Book ownership;
2. update the canonical registry if required and authorized;
3. create or update the leaf;
4. add or verify the reciprocal chapter link;
5. promote at the root only when warranted and authorized;
6. run the declared validation command;
7. update the issue/spine with the Book link when it is execution evidence;
8. answer in chat with the knowledge delta and leaf link.

## Completion Gate

A material Book landing is incomplete until:

- its claims distinguish evidence, inference, uncertainty, and recommendation;
- the leaf has stable ownership and no competing canonical version;
- root-to-chapter-to-leaf and leaf-to-chapter/root navigation resolves;
- the chapter contains a reciprocal descriptive link;
- any registry mutation preserves stable identity and source authority;
- the declared validator or link checker passes;
- the user receives a concise link to the durable artifact.

The EpicSpine validator checks spine structure, not Book truth. Repositories should provide a Book-specific validator for links, manifest membership, duplicate IDs, reciprocal registration, registry/view consistency, and orphan leaves when the Book becomes substantial.
