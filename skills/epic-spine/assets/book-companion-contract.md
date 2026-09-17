## EpicSpine Book Companion

Status: inactive | active
Book root: <path to canonical root HTML>
Book steward: <stable task/thread/agent; defaults to root-spine steward>
Chapter map: <path, root section, or manifest that lists canonical chapters>
Leaf roots: <one or more allowed directories>
Canonical registry: none | <authoritative JSON, CSV, database/API contract, or other structured source>
Registry row identity: none | <stable ID rule>
Generated registry view: none | <generated payload plus regeneration command>
Author scope: <what a spine-bound agent may edit automatically; recommended: one leaf plus its owning chapter link>
Root promotion authority: <book steward or delegated rule>
Registry write authority: <book steward, delegated roles, or read-only>
Archive location: <path or policy>
Validation command: <local command that checks links, reciprocal registration, IDs, and registry consistency>

Binding rule: When `Status: active`, every agent bound to an EpicSpine in this repository is also bound as a Book author. For material research, comparison, recommendation, reusable explanation, or substantial user-facing synthesis, the agent must update an existing leaf or create a new leaf under the owning chapter without waiting for a separate user request.

Navigation rule: Every active leaf links visibly to its owning chapter and the Book root. The owning chapter links descriptively to the leaf. The root links to every chapter and directly promotes only current, foundational, or decision-significant leaves.

Registry rule: The canonical registry is the only live structured collection or shortlist. Chapters and leaves may explain or filter it but must not maintain competing live lists. If no natural collection exists, declare `Canonical registry: none`.

Landing exceptions: Do not create a leaf for quick conversational answers, transient execution status, raw logs, ticket debugging, or work with no durable user-facing knowledge.
