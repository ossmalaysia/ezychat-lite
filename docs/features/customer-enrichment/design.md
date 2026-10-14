# Customer enrichment design

Status: owner-confirmed reference (2026-10-14); implemented and checked in an isolated real-model Dev Build.

## Reference and provenance

- [Full interactive HTML](mock/index.html), [run instructions](mock/README.md), [source manifest](mock/reference.json).
- Cloned **the entire existing-app reference**, `docs/features/app-baseline/mock/`, at Git revision
  `7d7e4fb4af1c3e64408aa1319f8f843289b5b7a8`.
- Original app: EzyChat Lite 0.1.34, `643a724b756a127361ea8ac61037f8dd87c628ff`.
- No confirmed cumulative reference existed at bootstrap. This reference was subsequently confirmed
  by the owner at revision `8716cb73ab86186aaacf202bcbbf00e256f52ecb`. [Mock index](../mock-index.json).
- The former handcrafted Settings/Audit mock is superseded. The complete current app shell, routes,
  components, translations, settings, customer panel and group flows are included.

Intentional changes: append a **Proposed feature** enrichment card after the existing AI connection
and Voice messages cards; use the existing System actor label and add an enrichment action with an average-score link to
Audit, with the existing responsive dialog/drawer for details. Legacy Audit rows retain their
original rendering. The browser title identifies the proposal. Six original files change, two
components are added; the other 163 original runtime frontend files retain their hashes.
The runner adds deterministic demo endpoints, isolated from production application code.

## Scope and decisions

- A background enrichment service reuses the existing AI connection, independently of Sales Agent replies.
- Settings → AI → Customer enrichment enables/disables it with the existing draft/Save settings pattern.
- New direct-chat text messages only initially; no groups or imported-history scan.
- Fields: actual name, company, email, address. Customer identity and chat aliases are unchanged.
- Per-field evidence score: ownership 30, statement clarity 25, context 20, validation 15,
  current evidence 10. Scores explain evidence strength; they are not calibrated probabilities.
- Fill an empty field at ≥90. Replace an existing value at ≥95 **and** a clear current statement or
  correction. Ambiguous ownership, invalid syntax, third-party details, stale evidence or a concurrent
  staff edit blocks the write regardless of score. Initial weights/thresholds need evaluation.
- No suggestion/apply queue. Updates and their audit event commit together.
- Audit shows only the rounded arithmetic mean of **fields actually changed**. Unchanged or skipped
  fields do not dilute the average; no change means no enrichment audit event.
- Clicking the average opens all field totals, score criteria, add/replace outcomes, thresholds,
  decision reasons and scoring-policy version. Source-message references remain in audit metadata; source conversation opens
  the existing chat and Customer panel. The average never determines whether an individual field writes.
- Audit metadata/logs exclude raw customer values. Save scores, field names and source references;
  conversation access follows existing permissions. No new provenance layout in the Customer panel.
- Turning enrichment off preserves prior audit records. An unavailable AI connection pauses it;
  enrichment never turns on automatic Sales Agent replies.

## Existing feature references

| Source                                                                         | Behaviour retained or reused                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [SettingsPage.tsx](../../../apps/web/src/admin/SettingsPage.tsx)               | Existing shell, line tabs, all sections; new card appended to AI                            |
| [AiConnectionSection.tsx](../../../apps/web/src/admin/AiConnectionSection.tsx) | Existing shared provider/model and Save AI connection remain intact                         |
| [AiVoiceSection.tsx](../../../apps/web/src/admin/AiVoiceSection.tsx)           | All existing voice settings and model-download UI remain intact                             |
| [CustomerPanel.tsx](../../../apps/web/src/inbox/CustomerPanel.tsx)             | Existing profile fields, Edit/Save, permissions and mobile sheet                            |
| [AuditPage.tsx](../../../apps/web/src/admin/AuditPage.tsx)                     | Existing All activity/Hide sign-ins filters; Time/Who/Action/Details/IP; table/mobile cards |
| [ResponsiveDialog](../../../apps/web/src/components/app/index.tsx)             | Existing desktop dialog, mobile drawer, scrolling and close controls                        |
| [design-system.md](../../design-system.md)                                     | Actual Calm Desk tokens, primitives, Inter, themes and touch targets                        |

## Original mock verification (before implementation)

| Surface/state         | Result                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Complete existing app | All routes cloned; baseline navigation verified separately in [baseline design](../app-baseline/design.md)                   |
| Settings → AI         | Original connection and voice sections preserved; On/Off, dirty draft, Save, scoring disclosure and audit entry working      |
| Simulated new message | With enrichment saved On and Sales Agent replies Off, fictional Jay introduction updates the existing Customer panel         |
| Add event             | Name 100, company 95, email 100; exact average 98.33, row rounds to 98/100                                                   |
| Replace event         | Existing Customer Edit/Save sets old email; next demo changes email only, average 100/100, Replaced, threshold 95            |
| Score popup/source    | Criteria, thresholds, reasons, exact average and demo policy visible; source link opens actual conversation                  |
| Responsive            | AI settings and replacement popup checked at 360px; document/popup fit viewport; original admin routes checked at 1280/360px |
| Source drift          | 163 original runtime files unchanged; six intentional deltas listed in manifest                                              |
| TypeScript            | Own mock TypeScript configuration passes                                                                                     |
| Production extraction | Not implemented; deterministic exact-message fixture, no real model calls                                                    |

Screenshots: [full AI settings](mock/screenshots/settings-desktop.jpg),
[mobile settings](mock/screenshots/settings-mobile.jpg),
[mobile replacement details](mock/screenshots/replacement-mobile.jpg),
[desktop score dialog](mock/screenshots/score-desktop.jpg),
[saved customer details](mock/screenshots/customer-desktop.jpg).

The fixture covers name/company/email; address uses the existing Customer field but has no extraction
fixture yet. It demonstrates design interactions, not multilingual extraction accuracy, full safety
gates, score calibration or concurrency protection. Existing loading/error UI is retained and the
new card has save/load/demo error banners; network failures, unavailable source records and paused
connection still need explicit scenario verification before production implementation.
AI/Cloudflare/push side effects are simulated. Real WhatsApp, voice-model downloads and model calls
are not exercised. All writes use fresh temporary demo data; no production app files were changed.

## Audit row refinement (2026-10-14)

Owner feedback: the enrichment Audit row looked awkward, with an oversized score button interrupting
the Details sentence and the feature name repeated in Who and Action.

- Who uses the existing **System** label; Action remains **Customer enriched**.
- Following the owner's placement feedback, the underlined **Avg 98/100** link sits on a separate
  line below the summary in **Details**, with a chevron. Action stays a single label. Other actions
  keep their existing presentation.
- The link has a descriptive accessible name, dialog semantics and a 44px touch target; only fine
  desktop pointers get the compact 32px target. The mobile system event omits its empty IP row.
- Verified at 1280px and 360px in light and dark; score dialog/drawer opens and closes, and the
  mobile document has no horizontal overflow. TypeScript and the 163 frozen-source checks pass.
- Before: [desktop](mock/screenshots/audit-before-desktop.png).
  After: [desktop dark](mock/screenshots/audit-desktop-dark.png),
  [mobile dark](mock/screenshots/audit-mobile-dark.png),
  [desktop light](mock/screenshots/audit-desktop-light.png),
  [mobile light](mock/screenshots/audit-mobile-light.png).
- This refinement was confirmed with the complete reference before production implementation.

## Confirmation

- Owner confirmation: 2026-10-14, “ok implement it”, followed by “continue”. Includes the score link
  below the summary inside Audit Details. Production removes the mock-only proposal badge and demo controls.
- Confirmed enhancement revision: recorded in `docs/features/mock-index.json` after committing this reference.
- Confirmation recorded before production UI implementation and advancing `latestConfirmed`.
- A request to create/commit/show the mock does not authorize merging.

## Production implementation and review

- Shared extraction schemas and both existing providers implement the same structured extraction turn.
  Settings saves through admin-only `GET/PUT /api/ai/enrichment`; enrichment is off by default.
- The worker only receives new direct-chat text, keeps bounded bursts, and cancels work on new
  messages, staff edits, connection changes and disabling. It rechecks identity routing, freshness,
  quoted evidence, syntax, score thresholds and the complete profile snapshot before committing.
  Profile and privacy-preserving audit metadata commit in one transaction.
- Production uses the confirmed Settings draft/Save flow and Audit Details placement. Source opens
  the existing conversation and Customer panel. Mock proposal controls are absent.
- Final production review covers 11 states, 1280px/360px, light/dark: off, editing, enabled,
  rules, paused, error, Audit, replacement, source customer, added fields and long policy text.
  All 44 captures pass without page errors or horizontal overflow. Paused/error/long-policy cases
  use explicit screen fixtures; normal audit rows come from actual mock-AI Dev Build transactions.
- Review against Calm Desk and the confirmed mock checked hierarchy, labels, contrast, 44px touch
  targets, dialog focus/close behaviour and scrolling. Findings fixed: stable card heading while
  loading, stale polling errors visible, an unambiguous field count and wrapping long policy text.
  Final captures replace the earlier captures; affected unit tests and all three e2e viewports pass.
- The complete screen smoke passed 33/33 screens in Malay. After owner sign-in and explicit
  “run the checks” agreement, seven real ChatGPT scenarios passed: English/Malay/Chinese details,
  correction, split messages, and rejection of third-party/quoted/negated/hypothetical details.
  Five audit events were created, assignments stayed unchanged, and no outbound messages were sent.
  This small check is not broad multilingual evaluation or score calibration. Real API-key model
  behaviour is covered by mocked contract tests only; real WhatsApp was not exercised.

Production evidence: [desktop Audit](../../screenshots/customer-enrichment/audit-desktop-dark.png),
[mobile score details](../../screenshots/customer-enrichment/score-added-mobile-dark.png),
[mobile error](../../screenshots/customer-enrichment/settings-error-mobile-light.png),
[long policy](../../screenshots/customer-enrichment/score-long-mobile-light.png).
See [feature workbook](../../workbooks/feat__customer-enrichment.md) and
[Dev Build checks](../../dev-build-checks.md).
