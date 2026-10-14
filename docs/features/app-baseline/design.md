# Existing-app interactive baseline

Status: rebuilt from existing app; owner confirmation pending.

Source: `643a724b756a127361ea8ac61037f8dd87c628ff` (EzyChat Lite 0.1.34).
The source frontend is unchanged; this mock preserves the actual routes, components, translations,
tokens, tab styles and layouts rather than recreating them by hand. The former handcrafted
enrichment mock is superseded as a reference because it changed existing Settings/Audit UI.

## Reference

- [Interactive HTML](mock/index.html), [run instructions](mock/README.md), [snapshot hashes](mock/reference.json).
- Existing source: `apps/web/index.html`, `apps/web/src/`, `apps/web/public/` at the recorded revision.
- Full existing navigation and feature screens; demo-only backend side effects.
- Separate baseline and enhancement folders distinguish current app behaviour from proposed features.

## Coverage and verification

The replica includes every route in the existing frontend. The 169 original runtime frontend files
match the recorded source, with LF-normalized text hashes. Its own TypeScript check passes.

Browser verification: all 11 admin routes (Members, Sales Agent, Quick replies, WhatsApp, Cloudflare,
five Settings tabs and Audit) render at 1280px and 360px, without document horizontal overflow.
Sign-in, Inbox, direct conversation/customer sheet, and group conversation/member sheet were opened
interactively. Existing customer edit/save was also exercised in the cloned proposal.
Screenshots: [AI settings](mock/screenshots/ai-desktop.jpg),
[Inbox](mock/screenshots/inbox-mobile.jpg), [customer](mock/screenshots/customer-mobile.jpg),
[group](mock/screenshots/group-mobile.jpg).

The UI is complete; simulated providers do not prove real WhatsApp, model, Cloudflare, push or
voice-model download behaviour. Setup is available with `--empty`; it has not been submitted in
this review. No production app code or live customer data was changed.

## Confirmation

Owner confirmation: pending. Do not record this baseline as confirmed until the owner inspects it.
The next enrichment proposal must clone this full-app reference instead of reusing the former
handcrafted Audit/Settings demo.
