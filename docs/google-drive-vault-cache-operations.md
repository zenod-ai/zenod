# Google Drive vault cache operations

Google Drive is the durable authority for a Drive-backed Zenod vault. The local checkout and transaction workspace exist only to execute the provider-neutral vault contract and can be rebuilt from the tenant's bound Drive root and manifest.

## Authority and backup boundary

- The authoritative customer content is the ordinary Markdown tree in the bound Google Drive folder, including Zenod's `.git` history files, manifest, transaction journals, and recovery bundle.
- The authoritative binding metadata is the account/tenant record: provider, immutable binding ID, Drive root folder ID, manifest file ID, and binding status.
- The OAuth refresh token is authoritative only in the existing encrypted tenant credential authority. It must not be copied into account rows, cache paths, logs, backups of the cache, or error output.
- Existing account, tenant, identity, credential-vault, and operational-state stores remain in the normal protected backup set.
- `<tenant dataDir>/vault` and `<tenant dataDir>/cache/drive-vault/` are rebuildable runtime data. Exclude them from durable-backup and disaster-recovery claims; restoring them is neither necessary nor sufficient to restore a Drive vault.

## Safe cache cleanup

1. Stop or invalidate the affected tenant runtime so no transaction is using its local checkout.
2. Confirm the account binding still identifies the expected tenant, `google_drive` provider, binding ID, Drive folder ID, and manifest file ID. Do not discover or substitute a different folder when a stored authority is missing.
3. Remove only that tenant's `<tenant dataDir>/vault` checkout and `<tenant dataDir>/cache/drive-vault/` directory. Never remove a shared data root or another tenant's directory.
4. Restart or recover the tenant runtime. Repository open reconstructs the checkout and transaction state from the stored Drive authority.
5. Run a read-only revision/get/search check before accepting new writes. If consent is suspended or revoked, leave the cache absent and recover authorization first.

Cache cleanup never deletes or moves Google Drive files, clears the provider binding, changes the tenant credential, or selects another vault provider. The customer-facing disconnect operation only revokes local use of the encrypted refresh token; it deliberately retains Drive content and binding identifiers for explicit recovery.

## Failure behavior

- A suspended tenant, revoked binding, missing encrypted token, mismatched tenant/binding, missing stored Drive authority, or ambiguous marked root fails closed before mutation.
- A Google 401/403 or invalid refresh grant marks the binding revoked. Further operations must not use a previously cached access token.
- Conflict and recovery artifacts found only in the local cache are diagnostic copies. The Drive journals, revisions, manifest, and recovery bundle remain the recovery authority.
