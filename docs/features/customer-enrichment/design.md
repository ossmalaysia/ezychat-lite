# Customer enrichment design

Status: proposed; owner confirmation pending. The enrichment service is not implemented.

## Reference

- Interactive HTML: [mock/index.html](mock/index.html).
- Run instructions: [mock/README.md](mock/README.md).
- This source is the proposed reference for Settings and Audit; record owner confirmation here
  before starting production UI work. New screens or changed behaviour must update this reference.

## Scope and decisions

- One background enrichment service reuses the inbox AI connection independently of Sales Agent replies.
- Settings → AI → Customer enrichment enables or disables it; the toggle is saved with Save settings.
- Start with new direct-chat text messages; no group extraction or imported-history scan.
- Supported customer fields: name, company, email and address. Clear self-reported facts only.
- Filling a blank field requires 90/100; replacing an existing field requires 95/100 and a clear
  current-value statement or correction. Ownership, validity and freshness checks can block a write
  regardless of score. These initial weights and thresholds require evaluation before implementation.
- Criteria: ownership 30, statement clarity 25, context 20, validation 15, current evidence 10.
- Decisions are per field. Audit shows only the rounded arithmetic mean across fields actually saved.
- Clicking the average opens a read-only dialog/bottom sheet containing all field totals, criteria,
  thresholds, outcomes, reasons, source message references and the scoring-policy version.
- Audit metadata retains fields, scores and source references, not raw customer values. The mock's
  expandable source examples are fictional conversation data, not values in audit metadata.
- Turning enrichment off retains prior audit history. An unavailable AI connection pauses enabled
  enrichment; it never enables automatic Sales Agent replies.

## Existing feature references

| Existing feature/source                                                                                                                                         | Reused behaviour                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [SettingsPage.tsx](../../../apps/web/src/admin/SettingsPage.tsx)                                                                                                | `/admin/settings/ai`, actual General/AI/Integrations/Preferences/Maintenance labels; draft settings and SaveBar                              |
| [AiConnectionSection.tsx](../../../apps/web/src/admin/AiConnectionSection.tsx) and [AiConnectionBanner.tsx](../../../apps/web/src/admin/AiConnectionBanner.tsx) | Existing inbox-wide provider/model and connection status; enrichment pauses when unavailable rather than creating a second AI member         |
| [CustomerPanel.tsx](../../../apps/web/src/inbox/CustomerPanel.tsx)                                                                                              | Existing name/company/email/address fields and concurrent-edit preservation; no new customer identity or duplicate record                    |
| [AuditPage.tsx](../../../apps/web/src/admin/AuditPage.tsx) and [audit-actions.ts](../../../apps/web/src/admin/audit-actions.ts)                                 | Existing admin-only audit, All/Changes filter, Time/Who/Action/Details/IP columns, translated action labels; score button belongs in Details |
| [design-system.md](../../design-system.md)                                                                                                                      | Calm Desk tokens, Inter, desktop table/mobile cards, dialog/bottom sheet, 44px touch targets                                                 |

The HTML is a standalone demo of these existing patterns, not an alternative app shell. Production
implementation must use the existing components and en/ms/zh-CN catalogs rather than copying this
HTML into feature code. Only AI connection context relevant to enrichment is shown; other existing
AI settings remain in their current section.

## Screen and state coverage

| Surface                    | Mock coverage                                                                 | Status                                             |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| Settings entry             | Sidebar and mobile navigation; AI section                                     | Included                                           |
| Settings control           | On/Off, unsaved draft, Save settings, saved feedback                          | Included                                           |
| AI availability            | Connected demo and unavailable/paused preview                                 | Included                                           |
| Audit                      | Desktop table/mobile cards; All/Changes; one average per event                | Included                                           |
| Score details              | Multiple fields; criteria/thresholds; add/replace outcomes; source disclosure | Included                                           |
| Responsive/theming         | Desktop/mobile, light/dark, bounded scrolling                                 | Browser verification required after changes        |
| Production loading/failure | Settings save failure, score details unavailable and missing source           | Must be mocked before production implementation    |
| Existing Customer panel    | Already shows saved fields; any new provenance UI needs a mock first          | No new layout proposed                             |
| Extraction accuracy        | Multilingual facts, third-party details, corrections, stale/concurrent edits  | Evaluation required; not simulated as AI behaviour |

## Confirmation

- Owner confirmation: pending.
- Confirmed reference revision: pending.
- The request to produce this mock is not approval of production implementation or merging.
