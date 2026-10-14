# Customer enrichment interactive app proposal

This is a full clone of the existing-app reference, with Customer enrichment added to Settings → AI
and a score detail dialog added to Audit. The original routes, UI components, layouts and other
settings are preserved. The new Settings card is marked **Proposed feature**.

From the repository root, after the normal `npm install`:

```powershell
npx tsx docs/features/customer-enrichment/mock/run.ts --fake-wa
```

Open `http://localhost:7487/`; sign in as admin `aisyah`, password `demo-pass-123`.
Use `localhost` for this proposal and `127.0.0.1:7489` for the baseline, so demo login cookies stay
independent. Both backends bind only to loopback and use different fresh temporary data folders.

1. Visit Settings → AI. Enable Customer enrichment and Save settings.
2. Click **Demo: receive customer details**. This simulates one fictional self-introduction from Jay.
3. Open Audit. Click **Avg 98/100** to see all three changed fields and their criteria/thresholds.
4. Use **View source conversation** and open the existing Customer panel to inspect the saved data.
5. To inspect replacement, edit Jay's email to `jay.old@example.com` through the existing panel,
   save, then run the demo again. Only email changes; its new audit average is **100/100**, with
   **Replaced** and threshold **95**. Unchanged fields do not enter the average.

Settings and customer changes affect only the temporary demo server. Enrichment settings reset
when the runner restarts. Sales Agent replies remain off by default. AI, Cloudflare and push
side effects are simulated; external model/download requests are blocked. No real WhatsApp or
customer data is used.

The enrichment fixture recognizes one exact demo message and assigns fixed evidence scores.
It demonstrates the proposed interactions, not a working AI extraction service or calibrated scoring.
Production scope includes address, but this fixture demonstrates name/company/email.

```powershell
node docs/features/customer-enrichment/mock/snapshot.mjs --check
npx tsc -p docs/features/customer-enrichment/mock/tsconfig.json
```

The manifest pins the baseline Git revision and lists six intentional changed frontend files and
two added components. All other 163 original runtime files must retain their frozen hashes.
Do not run `snapshot.mjs` without `--check` here: that replaces the proposal with the current app.
See [../design.md](../design.md) for decisions, verification and pending owner confirmation.
