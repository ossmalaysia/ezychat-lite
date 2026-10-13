# Existing-app interactive baseline

This mock uses an unchanged snapshot of the existing EzyChat Lite frontend, not a hand-built
approximation. All app routes and existing UI components come from the recorded app revision.
The local backend uses the existing API/services with fresh temporary demo data and fake WhatsApp.
AI replies, Cloudflare and push delivery are simulated. External model/download requests are blocked.

From this repository root, after the normal `npm install`:

```powershell
npx tsx docs/features/app-baseline/mock/run.ts --fake-wa
```

Open `http://127.0.0.1:7489/`. Sign in as `aisyah` (admin), `daniel` or `meiling` (staff), using
`demo-pass-123`. These are fictional local demo credentials, never production credentials.
Use `--empty` with a fresh runner start to inspect first-admin setup instead of preseeded data.

The mock has the existing Inbox, conversations, customer/group details, Members and Sales Agent,
Quick replies, WhatsApp, Cloudflare, all Settings tabs, Audit, account/theme/language and sign-in flows.
Changes affect only the temporary demo server. No public tunnel or real WhatsApp message is created.

`index.html`, `src/`, `public/` and `reference.json` form the frozen frontend reference. Clone this
whole mock folder for the next feature; edit only that next mock's snapshot. `run.ts` uses the
repository's installed dependencies and server services. Its temporary data path is printed at start.
The snapshot manifest records source hashes so the existing baseline can be checked for drift.

```powershell
node docs/features/app-baseline/mock/snapshot.mjs --check
node docs/features/app-baseline/mock/snapshot.mjs --check --compare-app
npx tsc -p docs/features/app-baseline/mock/tsconfig.json
```

Hashes normalize text to LF. `--check` checks the frozen copy; `--compare-app` additionally checks
the current production frontend. Running without `--check` replaces the snapshot; use that only
when deliberately creating a new app baseline, never on an enhancement with intentional changes.

This baseline contains no proposed Customer enrichment UI. Its owner confirmation is pending.
