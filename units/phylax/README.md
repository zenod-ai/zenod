# Phylax deployable artifact

Phylax is built and run independently from Zenod and PM. The dedicated image
always starts `packages/server/dist/phylaxMain.js`; it cannot select another
suite unit through `ZENOD_UNIT` or `AGENT`.

The image reuses the existing Phylax transport, transcription, Drive archive,
receipt, queue, tenant, and session code. This packaging boundary does not move
those responsibilities into another service and does not introduce a second
router.

## Instance modes

| `PHYLAX_INSTANCE_MODE` | Downstream binding | Commercial owner |
| --- | --- | --- |
| `zenod` | fixed Zenod adapter | Zenod |
| `pm` | fixed PM adapter | PM |
| `standalone` | one explicitly configured compatible downstream per tenant | Phylax |

The default is `standalone` for rolling compatibility with the existing private
Phylax deployment. New product-bound islands set their mode explicitly.

One running instance owns one WhatsApp service-number session. Instances made
from the same image must have different values for all of the following:

- `/data` volume (sessions, settings, journals, and local state)
- vault and account-state secrets
- stable instance and service-number identifiers
- public/customer and operator/admin origins
- usage/ledger state (the independent ledger ticket must retain this boundary)

`docker-compose.islands.yml` records that isolation for Zenod-bound, PM-bound,
and opt-in standalone examples. It is a local/pre-production topology proof,
not a production deployment declaration.

## Build

The checked-in Whisper fallback is the existing Linux/amd64 binary, so the
artifact target is explicit:

```sh
docker build --platform linux/amd64 \
  -f units/phylax/Dockerfile \
  -t zenod-phylax:local .
```

The native standalone compose preserves the existing named `phylax-data`
volume and `/data` layout. Mounting that volume in the new artifact does not
require a state migration or a WhatsApp re-pair.

## Local island proof

Provide separate test-only secrets, then boot the two fixed-product islands:

```sh
PHYLAX_IMAGE=zenod-phylax:local \
PHYLAX_ZENOD_VAULT_MASTER_KEY=... \
PHYLAX_ZENOD_ACCOUNT_STATE_SECRET=... \
PHYLAX_PM_VAULT_MASTER_KEY=... \
PHYLAX_PM_ACCOUNT_STATE_SECRET=... \
docker compose -f units/phylax/docker-compose.islands.yml up -d --no-build \
  phylax-for-zenod phylax-for-pm
```

Health responses at ports `18081` and `18082` expose only non-secret instance
identity, mode, fixed adapter, service-number label, and the `phylax` runtime.
