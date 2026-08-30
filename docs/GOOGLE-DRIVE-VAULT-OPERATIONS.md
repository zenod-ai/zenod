# Google Drive vault operations

This runbook covers the Hosted Google Drive vault. It does not authorize production configuration,
deployment, credential use, public signup, migration, or deletion. Google signup stays closed until
the readiness checks and the separately approved release acceptance are green.

## Authority and layout

Google Drive is the sole durable remote authority for a Drive-backed tenant. Zenod uses the
least-privilege `drive.file` scope and only discovers the app-created root bound to that exact tenant and
vault binding. It does not scan the user's whole Drive.

The root contains ordinary visible Markdown and attachments plus two sibling app-owned control folders.
`.zenod/` contains `manifest.json`, the authoritative completed Drive revision and file-ID/checksum map,
`transactions/`, durable idempotent journals, and `deleted/`, reversible tombstones. The root-level
`.git/` contains `repository.bundle`, a verified full Git bundle. Therefore the exact bundle path is
`.git/repository.bundle`, never `.zenod/.git/repository.bundle`. A Drive transaction ID and bundled Git commit SHA are independent.
Never derive one from the other or emit a GitHub URL for a Drive file.

Optional GitHub tasking does not change Drive authority. The callback verifies the returned App
installation through GitHub and, until an organization-authorization proof exists, accepts only a
personal installation whose account ID exactly matches the linked GitHub identity. Repo names never
select installations: every task request uses the tenant's stored installation token and GitHub itself
decides whether that token can access the requested repo. A 401 or missing installation clears tenant
authorization and its cached token; reconnecting (including the same installation ID) mints a fresh token.

## Cache and restart

The tenant runtime keeps a local workspace and binding-scoped state directory under tenant-owned storage.
The cache is rebuildable, not authoritative. With the runtime stopped, an operator may discard only the
exact affected binding's cache; the next open reconstructs local files and `.git` from the manifest,
ordinary Drive files, and bundle.

Never copy cache across tenants, point a binding at a manually selected folder, or accept a local HEAD
that is not proved by the Drive bundle and manifest. A missing, corrupt, thin, or mismatched bundle is a
hard readiness failure, not permission to continue from warm cache.

## Token custody and revocation

Google identity and Drive consent are separate grants. Each tenant's refresh token and account metadata
live only in the existing encrypted tenant-scoped credential custody. Tokens, OAuth state, client secrets,
and transaction credentials are never written into Drive, logs, receipts, issues, or support evidence.

Revocation or an incomplete/ambiguous binding fails closed. Do not replace a revoked credential from
another namespace, tenant, process-wide fallback, or archive/source grant. Reconnect preserves the exact
account/session/tenant/binding and authorization epoch. Disconnecting Hosted state does not authorize
deleting the customer-owned Drive folder.

## Publication and recovery

Before visible mutation, Zenod records exact intent locally and in the remote transaction journal. It
applies idempotent file mutations, replaces and verifies the full Git bundle, then finalizes and reads back
the manifest. Success requires the manifest, files, bundle, Drive revision, and real commit to agree. A
lost acknowledgement is recovered from durable state and must not duplicate evidence.

On partial failure, conflict, revocation, or ambiguous state: stop writes for that binding; retain the
transaction, manifest, bundle, affected file/revision IDs, and conflict copies; record a non-ready binding
state without secrets; retry only idempotent recovery; and never hand-edit the manifest, force-push local
cache, fall back to GitHub, or claim success. Possible silent overwrite, cross-tenant access, invalid bundle,
multiple roots, or manifest/journal contradiction is a release blocker.

## External edits, renames, and deletion

An externally edited Drive file is preserved and imported as an explicit Git commit before later work.
An interleaving edit retains the relevant Drive revision, materializes a conflict copy, and prevents
finalization. Stable Drive file IDs distinguish rename/move from delete-and-recreate.

Deletion is reversible: the file moves to `.zenod/deleted/` under a collision-safe archived name and the
manifest records a tombstone. Current policy retains tombstones and transaction journals indefinitely.
Automated permanent cleanup is not implemented or authorized; a future retention/deletion policy requires
a separately reviewed, recoverable change. Restart must not resurrect a tombstone.

## Support checklist

Collect only non-secret evidence: pseudonymous tenant/binding IDs, binding state, transaction ID, Drive
file/revision IDs, checksums, bundled commit SHA, application SHA, timestamps, and sanitized error codes.
Do not request tokens, secrets, Drive-wide access, or unrelated files.

Prove in order: one active tenant/binding; one correctly marked root; matching manifest/bundle/files; any
pending journal recovered or loudly blocked; and memory reads after empty-cache reconstruction. Production
remediation, credential-backed probes, permanent deletion, and public signup retain the named human gates
in `docs/EPIC-ZENOD-GOOGLE-DRIVE-VAULT.md`.
