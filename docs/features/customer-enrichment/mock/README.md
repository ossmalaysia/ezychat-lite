# Customer enrichment HTML mock

This is an interactive design reference with fictional data. It has no backend, AI calls or real
customer writes. Its settings reset on reload.

From the repository root:

```powershell
python -m http.server 7439 --bind 127.0.0.1 --directory docs/features/customer-enrichment/mock
```

Open `http://127.0.0.1:7439/#settings-ai` for Settings, or `http://127.0.0.1:7439/#audit` for Audit.

- Toggle enrichment and save the demo setting.
- Use the demo connection control to inspect the paused/unavailable state.
- Open Audit, click an average score and expand its source evidence.
- Switch themes and inspect at 1280px and 360px. Escape closes the dialog; keyboard focus stays inside.

The font is Inter from the existing `@fontsource-variable/inter` dependency; its license is included.
See [../design.md](../design.md) for scope, remaining states and the confirmation record.
