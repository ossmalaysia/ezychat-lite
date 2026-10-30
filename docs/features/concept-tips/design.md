# Concept tips ("?" next to new words)

Status: **confirmed** 2026-10-30 (round 2), implemented in the same branch. Branch
`claude/intelligent-einstein-oam83x` from `main` (`2ea78a9`).

## Owner request (2026-10-30)

- Feedback from users: the app is hard to use for people who do not know what an **API key** is.
- "for onboarding and some new concept page we will have ! tips to show people what it is, and people click to it will
  know what it is, and where they can get the key if they want. so it reduce the onboarding friction, review some of
  the screen add this tips and guide for non AI native person".
- Scope (owner, same day): changes go into **Lite and Enterprise** code only (the website keeps its guides as they
  are; tips link to them).
- Round 1 feedback (owner, same day): "don u felt too many text?" → round 2: one or two sentences (≤ 25 words) per
  card, no note box, steps folded behind **Show steps**, one action row (outside page · Show steps · Full guide).

## Baseline

- Cloned from the owner-confirmed **grammar-fix** mock (`latestConfirmed`, revision
  `4a6cde7762f4aa1c1787896700d1d4c632615fec`), the whole app; `main` 2ea78a9 has no change to it. The newer
  **ask-ezy** mock is an unconfirmed proposal, so it is not the baseline. Baseline screenshots are not copied.
- Retention: new feature folder (6th); the oldest, `google-calendar` (creation order 16, last revision on `main`
  `2ea78a96`), is pruned in the same change.
- Reused, not changed: the shadcn `Popover` (`components/ui/popover.tsx`), `Button` (`touch` size, `outline`/`link`),
  `Field` from `admin/adminUi.tsx` (gains a `tip` prop), the existing guide pages on ezychat.ai (`getting-started`,
  `set-up-ai-agent`, `connect-cloudflare`, `connect-ai-assistant`, each in en / ms / zh), the "no tracking, utm tags
  only" rule for website links (`lib/links.ts`).

## Screen review (what a non-technical owner meets, in order)

| Screen                           | Word that stops people                                  | Today                                                                                     | Tip                                                   |
| -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Setup → WhatsApp                 | "Linked device", QR vs phone number                     | 3 steps on screen; nothing on what linking means                                          | `whatsappLink`                                        |
| Setup → AI assistant             | "About your business" (= Business context)              | One hint line                                                                             | `businessContext`                                     |
| Setup → AI assistant             | "Connect the AI" — why? which way?                      | Button + "unofficial" note + two links                                                    | `aiConnection`                                        |
| Setup / Settings → AI            | **"OpenAI API key"** (the reported problem)             | "Starts with sk-. Create one at platform.openai.com → API keys." No billing step, no link | `apiKey`                                              |
| Setup / Settings → AI            | "Anthropic API key"                                     | One "Get a key" link                                                                      | `claudeKey`                                           |
| Settings → AI                    | "Model", "Advanced: choose a model"                     | Live/fallback hint only                                                                   | `aiModel`                                             |
| Settings → AI → More AI features | "Voice messages" (on-device model vs cloud)             | Card description                                                                          | `voice`                                               |
| Settings → General               | "LAN access"                                            | One hint + a warning when on                                                              | `lan`                                                 |
| Settings → Integrations          | "AI assistant access" (MCP)                             | Long description, MCP named in it                                                         | `mcp`                                                 |
| Settings → Integrations          | "Access tokens"                                         | Description                                                                               | `accessToken`                                         |
| AI agent page                    | "Business context", "Role", "Hand-over rules", "Try it" | Hints under the boxes                                                                     | `businessContext`, `instructions`, `handoff`, `tryIt` |
| Phone access                     | "Tunnel", Cloudflare                                    | Page description                                                                          | `tunnel`                                              |
| Connectors                       | "Connector"                                             | Page description                                                                          | `connectors`                                          |

Findings outside the tips (not changed in this mock, listed for the implementation PR):

- The same idea has two names: **Hand-off rules** (setup, Settings, audit) and **Hand-over rules** (agent page); ms
  and zh agent page still show the English "Hand-over rules". The tip uses the agent page's word; the implementation
  should pick one word everywhere.
- The OpenAI key hint skips the billing step: a new OpenAI account has no credit, so the first key fails with
  "OpenAI refused the check". The `apiKey` tip's step 2 covers it.

## Behaviour (proposal)

| Rule      | Default                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marker    | A muted **?** (lucide `CircleHelp`, 16 px) right after the label or card title, primary colour on hover/open. Kept **outside** the heading/label element so the field's and heading's accessible names stay clean.                                                                  |
| Open      | Click or tap (never hover-only, so it works on phones and with a keyboard); Esc or a click outside closes it. Nothing is sent or saved.                                                                                                                                             |
| Card      | Title "What is …?", 1–2 plain sentences (≤ 25 words), then one action row: button to the outside page (opens in the OS browser), **Show steps** (only API keys; folded until clicked, shown under the row so the buttons stay visible, reset when the card closes), **Full guide**. |
| Size      | Max 20 rem wide, `100vw − 2rem` on a phone, capped to the space on screen and scrolls when longer. 44 px hit area on the **?** and on both links.                                                                                                                                   |
| Words     | No jargon inside the explanation; product names exactly as on the outside page (Settings → Billing, API keys → Create new secret key). No prices or amounts: the owner's rule is never to state unconfirmed figures.                                                                |
| Links     | Outside pages: `platform.openai.com/api-keys`, `console.anthropic.com/settings/keys`. Guides: `ezychat.ai[/ms                                                                                                                                                                       | /zh]/guides/<slug>?utm_source=ezychat-lite&utm_medium=app&utm_campaign=tip-<topic>` (campaign tags only, no tracking in the app). |
| Languages | en, ms, zh-CN for every topic (catalog test enforces it).                                                                                                                                                                                                                           |

## Screens and states (checklist)

`mock/tips-shots.mjs` (desktop 1280 / mobile 360 touch, light / dark, each tip open): setup WhatsApp, AI assistant
(connect, business, OpenAI key, Claude key); Settings → AI (connection, key, model, voice), General (LAN), Integrations
(AI assistant access, access tokens); agent page (Business context, Role, Hand-over rules, Try it); Phone access;
Connectors; API key cards also with steps open. 84 screenshots, no page errors, no horizontal overflow, no card off screen.

## Implementation plan (after confirmation)

**Lite (`apps/web`, public API for editions)**

- `components/app/InfoTip.tsx`: `<InfoTip topic="apiKey" />` for core topics and
  `<InfoTip title body steps? note? action? guide? />` for content an edition brings; exported from
  `@ezychat/web` with `PageHeader`/`Field` support (`Field` `tip`, `PageHeader` `titleTip`).
- `lib/tips.ts` + `common.json` `tips.*` (en/ms/zh-CN); a test checks every topic's keys exist in all three
  catalogs and that the outside links are `https:` only.
- Guide links through `AppLinks` (new optional `guide(slug, locale, topic)`, `null` hides "Read the full guide") so
  Enterprise can point at its own pages; Lite's default is the ezychat.ai guide above.
- The desktop app opens tip links in the OS browser through the existing external-link handling (checked by
  `npm run e2e:electron-links`).
- Tests: InfoTip (opens on click and Enter, closes on Esc, steps/note/links shown only when set, accessible name),
  one per screen that it renders, catalogs, `web-client-contract` unaffected (no API calls).

**Enterprise (`packages/*-web`, after a Lite release exports `InfoTip`)**

- WhatsApp Business API setup (`ent-wa-cloud-web`): **Business API vs linked phone**, **Phone number ID**,
  **WhatsApp Business Account ID**, **Access token** (permanent system-user token), **App secret** — each with the
  Meta steps already in `guide1…4`, moved into the tips so the form gets shorter.
- Custom connectors (`ent-connectors-web`): **MCP server URL**, sign-in methods (**OAuth**, **Bearer token**,
  **Custom headers**).
- Licence (`ent-licence-web`): **Trial**, **Waiting for activation**.
- Strings through `useExtensionTranslation()` (`ext.*` keys, en/ms/zh-CN); a separate Enterprise mock round is
  needed for these screens.

## Open questions for the owner

1. Marker: **?** (proposed; reads "what is this?") or **!** as in the request (in the app **!** means a warning:
   `Banner` tone warning uses a triangle). One-line change either way.
2. Show the tip as a card that opens on click (proposed), or also show a one-time "New here? Tap ? to learn" hint
   in the setup wizard?
3. Enterprise screens in the same release, or Lite first and Enterprise in the next one (proposed: Lite first, since
   Enterprise needs the exported component)?

## Confirmation

Owner reviewed round 1 ("too many text"), asked for the shorter round 2 cards ("yes"), reviewed them and set the goal 2026-10-30 ("build it, test it for ezychat lite and enterprise, than merge, no need release"). Open questions defaulted to the proposals: the ? marker; Enterprise tips in the same change.
The mock revision is recorded in `docs/features/mock-index.json` (`latestConfirmed`).

## Implementation notes (2026-10-30)

- Lite: `components/app/InfoTip.tsx` (core topics by name, or an edition's own `title`/`body`/`steps`/`action`/
  `guideHref`, https links only), `lib/tips.ts`, `common.json` `tips.*`, `Field` `tip` and `PageHeader` `titleTip`,
  `AppLinks.guide` (null hides "Full guide"); exported from `@ezychat/web` (`InfoTip`, `TIP_TOPICS`).
- Enterprise: Business API setup fields (Phone number ID, WhatsApp Business Account ID, Access token, App secret)
  get tips now through the published 0.1.65 `Popover`, because the core `InfoTip` export ships only with the next
  Lite release; they move to the core component when Enterprise takes that release (`docs/backlog.md` there).
- The Hand-off / Hand-over naming split stays as found (see Screen review); tracked in `docs/backlog.md`.
