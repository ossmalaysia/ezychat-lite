# Dream Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each night an AI agent reads its inbox's take-over chats, learns from the team's replies, and saves checked
setup changes that an admin applies (or that apply by themselves for Business context facts).

**Architecture:** A `dream` service (`packages/server/src/ai/dream/`) ticks like scheduled tasks, collects take-over
chats (forwarded and unsafe messages removed, text cleaned), runs one lesson call per chat and one merge call, checks
each change (privacy, leak, grounding, replay previews), and stores runs and changes in three new tables. Apply/Undo
share one core with Ask Ezy and write `ai_setup_versions` with `via: 'dream'`. The web adds a Dream mode card and a
See change dialog on the agent page.

**Tech Stack:** TypeScript (strict, ESM), Fastify, better-sqlite3, zod (`@ezychat/shared`), Vercel AI SDK structured
calls (as `ai/agent/extract-customer.ts`), React + TanStack Query + shadcn/ui, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-dream-mode-design.md` (approved 2026-11-14). Mock:
`docs/features/dream-mode/mock/index.html`.

## Global Constraints

- Off by default: `enabled = 0`, `auto_apply = 0`, `run_time = '02:00'`; times in `ai_timezone`, every day.
- Limits: 30 take-over chats per agent per night; last 20 messages per chat; 0–3 lessons per chat; 5 changes per night;
  10 regression questions; 40 previews per run, one at a time; 60-minute grace, then `missed`; waiting changes expire
  after 14 days; history shows the last 30 runs.
- Never read: forwarded messages (`forwarding_score > 0`) in either direction, revoked messages, system/event rows,
  Safety High or still-checking messages, scheduled-task messages, captionless media, groups.
- Apply by itself: `context_text` only; instructions and hand-off rules always wait.
- A change failing any check is dropped (never stored); runs count `dropped`.
- Nothing is sent to a customer; previews store nothing.
- Logs: ids, counts, ms, model, outcome only — never message, lesson or change text.
- Audit: `dream.settings` {before, after}, `dream.change.applied` {changeId, auto}, `dream.change.dismissed`,
  `dream.change.undone`.
- Tests and e2e never call a model (mock providers). User-facing strings via `t()` in en, ms, zh-CN.
- Coverage ≥ 90 % of changed lines (`npm run coverage:changed`); totals stay above the floors.
- Migration: next free number (`045` when written; re-check `ls packages/server/src/db/migrations` before naming).

## Review Focus

1. A take-over whose only team reply is a forwarded message (or a forwarded price list) yields no lesson and no
   change — Task 4 test `skips a take-over whose only team reply was forwarded`.
2. A customer name, phone number or email inside the team reply never reaches a prompt, a lesson or a stored change —
   Task 4 test `cleans names, numbers and emails before the lesson call`, Task 6 test `drops a change with a phone
   number`.
3. The admin edits the Business context item after the suggestion: Apply answers 409 `setup_changed` and the change
   becomes `stale`; Undo after a later edit answers 409 — Task 3 tests.
4. The agent is switched off, deleted, or its inbox removed between ticks or mid-run: no change is saved and the run is
   `skipped` with a reason — Task 7 test `skips and saves nothing when the agent is switched off mid-run`.
5. The PC sleeps past 02:00 + 60 min: the slot is `missed` and not run later; a new `run_time` set after the slot does
   not run that slot — Task 7 tests.

---

### Task 1: Shared contract

**Files:**
- Create: `packages/shared/src/dream.ts`, `packages/shared/src/dream.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

**Interfaces:**
- Produces (zod + types): `DreamSettings {enabled: boolean, runTime: string /*HH:MM*/, autoApply: boolean}`,
  `DreamSettingsBody` (all optional, `runTime` regex `^([01]\d|2[0-3]):[0-5]\d$`), `DreamTarget = 'context_text' |
  'instructions' | 'handoff_rules'`, `DreamChangeStatus = 'waiting'|'applied'|'dismissed'|'undone'|'stale'|'expired'`,
  `DreamRunStatus = 'running'|'done'|'skipped'|'missed'|'failed'`, `DreamRunReason = 'ai_unavailable'|'access_closed'|
  'agent_off'|null`, `DreamCheck {name: 'privacy'|'leak'|'grounding'|'replay'|'regression', ok: boolean, detail?:
  string}`, `DreamChange {id, runId, target, itemId: number|null, itemName: string|null, summary, status, auto:
  boolean, sourceCount: number, createdAt, decidedAt: number|null}`, `DreamRun {id, slot, status, reason, chatsRead,
  takeovers, saved, dropped, changes: DreamChange[]}`, `DreamHistory {settings: DreamSettings, runs: DreamRun[],
  nextBefore: number|null, aiReady: boolean}`, `DreamChangeDetail extends DreamChange {before: string, after: string,
  checks: DreamCheck[], sources: {role: 'customer'|'team', name: string|null, at: number, text: string}[]}`.

- [ ] **Step 1: Write the failing test** `dream.test.ts`: `DreamSettingsBody.safeParse({runTime: '24:00'}).success`
  is false; `{runTime: '02:00'}` true; `DreamChangeDetail.parse` of a full object round-trips; unknown status rejected.
- [ ] **Step 2: Run** `npx vitest run packages/shared/src/dream.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** the schemas in `dream.ts`; export from `index.ts`.
- [ ] **Step 4: Run** the test — PASS; `npm run typecheck -w @ezychat/shared` — 0 errors.
- [ ] **Step 5: Commit** `feat(shared): dream mode contract`.

### Task 2: Migration, repository, Lite import

**Files:**
- Create: `packages/server/src/db/migrations/045_ai_dream.sql`, `packages/server/src/ai/dream/repo.ts`,
  `packages/server/src/ai/dream/repo.test.ts`
- Modify: `packages/server/src/lite-import/merge-tables.ts` (`TABLE_PLAN`), the Lite merge code that copies
  `ai_scheduled_tasks` switched off (follow it), `packages/server/test/upgrade-from-oldest.test.ts` (only if it lists
  tables), `AGENTS.md` (architecture paragraph, see Task 10)

**Interfaces:**
- Produces: tables `ai_dream_settings(agent_id PK → ai_agents ON DELETE CASCADE, enabled, run_time, auto_apply,
  updated_at)`, `ai_dream_runs(id, agent_id → ai_agents ON DELETE CASCADE, slot, status, reason, chats_read,
  takeovers, saved, dropped, started_at, finished_at, UNIQUE(agent_id, slot))`, `ai_dream_changes(id, run_id → runs
  ON DELETE CASCADE, agent_id, target, item_id, item_name, before, after, summary, source_message_ids TEXT /*JSON
  int[]*/, checks TEXT /*JSON DreamCheck[]*/, status, version_id, auto, decided_by, created_at, decided_at)`, index on
  `(agent_id, status)`.
- `class DreamRepo` (only SQL for these tables): `settings(agentId): DreamSettings`, `saveSettings(agentId, body,
  now): {before, after}`, `enabledAgents(): {agentId, runTime, autoApply}[]`, `claimRun(agentId, slot, now): number |
  null`, `finishRun(runId, {status, reason, chatsRead, takeovers, saved, dropped}, now)`, `lastFinishedAt(agentId):
  number | null`, `addChange(runId, agentId, row): number`, `change(id): ChangeRow | null`, `setStatus(id, status,
  {versionId?, decidedBy?, now})`, `history(agentId, before: number | null, limit = 30): {runs, nextBefore}`,
  `expireWaiting(now)` (14 days).

- [ ] **Step 1: Failing tests** in `repo.test.ts` (temp DB via the test helper other repo tests use): defaults
  `{enabled:false, runTime:'02:00', autoApply:false}`; `claimRun` twice for one slot → second `null`;
  `history` returns newest first, 30 per page, `nextBefore`; `expireWaiting` turns a 15-day-old `waiting` into
  `expired` and leaves a 13-day-old one; deleting the agent removes its settings, runs and changes.
- [ ] **Step 2: Run** `npx vitest run packages/server/src/ai/dream/repo.test.ts` — FAIL.
- [ ] **Step 3: Write** `045_ai_dream.sql` (adds-only) and `DreamRepo`.
- [ ] **Step 4: Lite import**: add the three tables to `TABLE_PLAN`; copy `ai_dream_settings` with `enabled = 0`,
  skip runs and changes (reason text like the scheduled runs entry). Extend `lite-import-merge.test.ts` with one case:
  an enabled Lite setting arrives disabled, no runs.
- [ ] **Step 5: Run** the repo test, `lite-import-merge*.test.ts`, `upgrade-from-oldest.test.ts`,
  `packages/server/src/db/migrate.test.ts` — PASS.
- [ ] **Step 6: Commit** `feat(dream): tables and repository`.

### Task 3: Shared apply/undo core and `via: 'dream'`

**Files:**
- Create: `packages/server/src/ai/setup-apply.ts`, `packages/server/src/ai/setup-apply.test.ts`
- Modify: `packages/server/src/ai/setup-versions.ts` (`SetupVia` and `SetupChangeSource.via` gain `'dream'`),
  `packages/server/src/ask-ezy/changes.ts` (use the core; behaviour unchanged), the web version-history label if it
  maps `via` (search `via ===` in `apps/web/src`; add "Dream mode" in en/ms/zh-CN)

**Interfaces:**
- Produces: `applySetupText(ctx, {agentId, target, itemId: number|null, name: string|null, before: string|null, after:
  string}, actor: SetupActor): {itemId: number|null}` — throws `HttpError(409, 'setup_changed', …)` when the current
  text ≠ `before` (`before === null` = a new item); `undoSetupText(ctx, {agentId, target, itemId, before, after},
  actor)` — 409 when current ≠ `after`; a new item is removed. `SetupActor = {kind: 'user', user: User, ip: string|null,
  via: 'app'} | {kind: 'dream'}`; the dream actor records `userId: null, via: 'dream', reason: 'Dream mode: <summary>'`.
- Consumes: `AiService.addText/updateText/removeDocument`, `recordSetupVersion`.

- [ ] **Step 1: Failing tests**: apply edits an item and records a version with `via 'dream'`; apply with stale
  `before` → 409 `setup_changed`; undo after a later edit → 409; undo of an added item removes it; instructions and
  hand-off targets apply and undo.
- [ ] **Step 2: Run** the test — FAIL.
- [ ] **Step 3: Implement** `setup-apply.ts`; move Ask Ezy's apply/undo bodies onto it.
- [ ] **Step 4: Run** `setup-apply.test.ts` and every existing Ask Ezy test (`npx vitest run packages/server -t "Ask
  Ezy"` plus `ask-ezy` test files) — PASS, unchanged.
- [ ] **Step 5: Commit** `refactor(ai): one apply/undo core for Ask Ezy and dream mode`.

### Task 4: Collect take-over chats

**Files:**
- Create: `packages/server/src/ai/dream/collect.ts`, `packages/server/src/ai/dream/collect.test.ts`

**Interfaces:**
- Produces: `collectTakeovers(ctx, {agentId, from: number, to: number, limit = 30}): TakeoverChat[]` with
  `TakeoverChat {chatJid, kind: 'handoff'|'reply_over_ai', handoffReason: AiHandoffReason|null, messages:
  {localId: number, messageId: number, role: 'customer'|'ai'|'team', at: number, text: string}[]}` (≤ 20, cleaned,
  oldest first, `localId` 1..n). `questionsAnsweredByAi(ctx, {agentId, from, to, limit = 10}): string[]` (cleaned
  customer texts the AI answered without a hand-off; for regression).
- Consumes: audit `ai.handoff` rows (`meta.agentId`), `chat_events` `assigned` rows with reason `reply`
  (`messages/service.ts` `claimOnReply`), `messages` columns `from_me`, `sent_by_user_id`, `forwarding_score`,
  revoke/edit state, `scheduled_task_id`, Safety state via `ctx.services.safety`, `cleanTeamReply` +
  customer names of the inbox (as `ai/phrases`).

- [ ] **Step 1: Failing tests** (seed with the server test helpers): hand-off then teammate reply → one chat
  `kind 'handoff'`; teammate replies while the AI owns the chat → `kind 'reply_over_ai'`; linked-phone reply counts;
  `skips a take-over whose only team reply was forwarded`; a forwarded customer message is left out of `messages`;
  revoked, Safety High, scheduled-task and captionless-media messages are left out; groups are never returned;
  `cleans names, numbers and emails before the lesson call` ("Hi Ahmad, call 0123456789 or a@b.com" → no `Ahmad`, no
  digits run, no `@`); 31 take-overs → 30, most recent; a chat of another agent's inbox is not returned.
- [ ] **Step 2: Run** `npx vitest run packages/server/src/ai/dream/collect.test.ts` — FAIL.
- [ ] **Step 3: Implement** `collect.ts` (SQL kept in `repo.ts` or here as read-only queries over existing tables;
  no writes).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(dream): collect take-over chats`.

### Task 5: Lesson and merge calls

**Files:**
- Create: `packages/server/src/ai/agent/dream.ts` (+ `.test.ts`), `packages/server/src/ai/dream/prompts.ts`
  (`DREAM_LESSON_RULES`, `DREAM_MERGE_RULES`, fixed strings, no interpolation)
- Modify: `packages/server/src/ai/provider-types.ts` (optional `dreamLessons?` / `dreamMerge?` like `extractCustomer?`),
  the API-key, Claude and ChatGPT providers (same pattern as `extractCustomer`), `packages/server/src/ai/service.ts`
  (`AiService.dreamLessons`, `AiService.dreamMerge`), the test mock provider(s)

**Interfaces:**
- Produces: `AiService.dreamLessons(chat: TakeoverChat, signal): Promise<DreamLesson[]>` on the "Model for
  suggestions" (`replySuggestionsModel`); `DreamLesson {kind: 'fact'|'answer'|'handoff'|'style', text, teamMessageIds:
  number[]}` (local ids). `AiService.dreamMerge({lessons, instructions, handoffRules, items: {id, name, text}[]},
  signal): Promise<DreamProposal[]>` on the connection's main model; `DreamProposal {target, itemId: number|null,
  name: string|null, after: string, summary: string, lessonIds: number[]}`, at most 5. Both: no tools, no retries,
  `store: false`, logs `dream_lessons` / `dream_merge` with counts, ms, model.

- [ ] **Step 1: Failing tests**: the lesson prompt for a chat contains no forwarded text and no `messageId` (only local
  ids); output over 3 lessons is cut to 3; a lesson citing no team message is dropped; merge output over 5 is cut to
  5; Internal items are never in the merge input; `answerReady() === false` → throws `AiUnavailable`-style error the
  service maps to `skipped ai_unavailable`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(dream): lesson and merge calls`.

### Task 6: Checks and replay previews

**Files:**
- Create: `packages/server/src/ai/dream/checks.ts` (+ `.test.ts`)
- Modify: `packages/server/src/ai/service.ts` (`AiService.previewWithSetup`)

**Interfaces:**
- Produces: `AiService.previewWithSetup(agentId, override: {instructions?: string, handoffRules?: string, items?:
  {id: number|null, name: string, text: string}[]}, question: string, signal): Promise<AiTryResult>` — like
  `tryAnswer`, never writes; `items` replaces the matching saved text items (`id`) or adds one (`id: null`).
  `checkChange(ctx, {agentId, proposal: DreamProposal, before: string|null, sources: TakeoverChat[], teamText:
  string, regression: string[], budget: {previews: number}}, signal): Promise<{ok: boolean, checks: DreamCheck[]}>`
  — privacy (email, phone-like run of ≥ 7 digits, customer names of the inbox), `findLeak` vs Internal items,
  grounding (`ungroundedNumbers(added, teamText)` empty), replay and regression with the per-target rules of spec §6;
  a preview error or a look-up failure = "could not check" = fail; stops when `budget.previews` hits 0 (= fail).

- [ ] **Step 1: Failing tests** (mock provider scripts preview decisions): `drops a change with a phone number`;
  leak → fail; a number not in the team text → fail; `context_text` passes when one source question now answers;
  `handoff_rules` passes only when a source question now hands over; regression: one answered question now hands
  over → fail; budget 0 → fail without calling the provider; the preview never writes (`ai_documents` row count
  unchanged).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(dream): checks and replay previews`.

### Task 7: Run and schedule

**Files:**
- Create: `packages/server/src/ai/dream/service.ts` (+ `packages/server/test/dream.test.ts`)
- Modify: `packages/server/src/services.ts` (init after scheduled tasks), `packages/server/src/routes/dev.ts`
  (`POST /api/dev/dream-run {agentId}`, only `--mode dev --fake-wa`, admins; runs now with slot = now)

**Interfaces:**
- Produces: `ctx.services.dream: DreamService {runNow(agentId): Promise<number /*runId*/>, tick(): Promise<void>,
  close(): void}`. Tick every 60 s (unref'd), first after 20 s. One run at a time per install. Run: skip reasons
  (`ai_unavailable`, `access_closed`, `agent_off`) → `finishRun(..., status 'skipped')`; window `max(lastFinishedAt,
  slot − 24 h) .. slot`; collect → lessons per chat (errors counted, continue) → merge → per proposal `checkChange` →
  save passing ones (`waiting`, or apply via `applySetupText` with the dream actor when `autoApply && target ===
  'context_text'`, status `applied`, `auto 1`, audit `dream.change.applied {auto: true}`) → `finishRun` with counts.
  Re-check the agent is still on and present before each save. `expireWaiting` once per tick.

- [ ] **Step 1: Failing tests** (fake timers, mock provider): a slot runs once at 02:00 in `Asia/Kuala_Lumpur`;
  02:00 + 61 min → `missed`, never run later; `run_time` changed after the slot → that slot is not run; AI not ready →
  `skipped ai_unavailable`; `skips and saves nothing when the agent is switched off mid-run`; auto-apply on: a
  `context_text` proposal is applied with a version `via 'dream'`, a `handoff_rules` proposal stays `waiting`; a
  failing proposal is not stored and counts in `dropped`; logs contain no change text (spy on the logger).
- [ ] **Step 2: Run** `npx vitest run packages/server/test/dream.test.ts` — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(dream): nightly run and schedule`.

### Task 8: Routes

**Files:**
- Create: `packages/server/src/routes/ai-dream.ts` (+ cases in `packages/server/test/dream-routes.test.ts`)
- Modify: `packages/server/src/routes/index.ts`

**Interfaces:**
- Produces (admins; Origin rules): `GET /api/ai/agents/:agentId/dream` → `DreamHistory` (`?before=<runId>`);
  `PUT /api/ai/agents/:agentId/dream` `DreamSettingsBody` → `DreamSettings` (audit `dream.settings` before/after);
  `GET /api/ai/agents/:agentId/dream/changes/:id` → `DreamChangeDetail` (sources read live from `messages`; a deleted
  message is left out); `POST …/changes/:id/apply|dismiss|undo` → `DreamChange` (apply/undo via Task 3; 409
  `setup_changed` → status `stale`; 409 `change_not_waiting` / `change_not_applied` for wrong states). Unknown agent or
  a change of another agent → 404.

- [ ] **Step 1: Failing tests**: agent (non-admin) → 403; PUT validates `runTime`; apply → version recorded, status
  `applied`; dismiss; undo; apply after the item changed → 409 and `stale`; change of agent 2 under agent 1 → 404;
  detail leaves out a deleted source message. Run `packages/server/test/web-client-contract.test.ts` after Task 9.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(dream): admin routes`.

### Task 9: Web card and dialog

**Files:**
- Create: `apps/web/src/api/dream.ts`, `apps/web/src/admin/AgentDreamCard.tsx`,
  `apps/web/src/admin/DreamChangeDialog.tsx` (+ `.test.tsx` for both)
- Modify: `apps/web/src/admin/AiMemberPage.tsx` (card after Business context, before `AgentResolutionCard`, not on
  the new-agent page), `apps/web/src/i18n/locales/{en,ms,zh-CN}/admin.json` (`ai.dream.*`)

**Interfaces:**
- Consumes: Task 8 routes; `DreamHistory`, `DreamChangeDetail`.
- Produces: `useDream(agentId)`, `useSaveDream(agentId)`, `useDreamChange(agentId, id)`, `useDreamAction(agentId)`
  (`apply|dismiss|undo`, invalidates the history and the agent's setup queries).
- Look and copy follow the confirmed mock: intro line; Dream mode switch; "Runs every night at" time select (30-min
  steps) with the time zone; Apply by itself switch with the scope line; History (date · chats read · taken over ·
  changes/suggestions · dropped) with status chips Applied / Waiting for you / Dismissed / Undone / Outdated / Expired;
  actions Apply, See change, Dismiss, Undo; paused note when `aiReady` is false; dialog: before (struck) / after,
  "Why: what the team wrote after taking over" quotes, checks list, Dismiss / Apply. Design-system tokens and shadcn
  components only; 360 px without horizontal scroll.

- [ ] **Step 1: Failing tests**: switch on sends `PUT {enabled:true}`; Apply calls `/apply` and shows "Applied";
  Undo shown only on applied; the paused note when `aiReady` false; the dialog lists checks and quotes; Outdated chip
  for `stale` with no Apply button.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/admin/AgentDreamCard.test.tsx apps/web/src/admin/DreamChangeDialog.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** — PASS; `npx vitest run packages/server/test/web-client-contract.test.ts`
  — PASS; i18n catalog tests — PASS.
- [ ] **Step 5: Commit** `feat(web): Dream mode card and See change dialog`.

### Task 10: Docs, e2e, Dev Build, screens, verification

**Files:**
- Create: `e2e/dream-mode.spec.ts`, `docs/workbooks/feat__dream-mode.md`
- Modify: `AGENTS.md` (a **Dream mode** paragraph in Architecture: tables, service, routes, limits, forwarded rule),
  `CHANGELOG.md` `[Unreleased] Added`, `docs/features/mock-index.json` (dream-mode proposal `confirmed-quick-mock`,
  next `creationOrder`; prune the oldest feature folder per the retention rule, keep `template-store`),
  `e2e/agents-devbuild.ts` or a new `e2e/devbuild-dream-check.mjs` (mock model), `docs/dev-build-checks.md`,
  `docs/screenshots/` (agent page shots)

- [ ] **Step 1: e2e** `dream-mode.spec.ts` (fake WhatsApp, placeholder AI key, no model calls): turn dream mode on,
  change the time, turn Apply by itself on; seed one run through `POST /api/dev/dream-run` with the mock model (if the
  e2e server has no mock model, add `POST /api/dev/fake-dream-run` that inserts a run with given changes, dev + fake
  WA only), open See change, Apply, Undo.
- [ ] **Step 2: Consolidated verification (main agent only, once):** `npm run typecheck`, `npm run lint`,
  `npm run test:coverage`, `npm run coverage:changed`, `npm run e2e -- --workers=1`, `npm run e2e:electron-links` —
  all PASS. Record `node scripts/build-summary.mjs record e2e pass "…"`.
- [ ] **Step 3: Dev Build check** (mock model, fake WhatsApp, temp data): hand-off chat + teammate reply with a fact,
  a forwarded teammate message, a reply-over-AI chat → `/api/dev/dream-run` → one waiting/applied change from the
  fact, none from the forwarded message; Apply/Undo writes versions. Log a row per check in
  `docs/dev-build-checks.md` with the short commit; `build-summary.mjs record devbuild pass`.
- [ ] **Step 4: Screen review** at 1280 and 360, light and dark, states off / waiting / auto / change / paused /
  stale, compared with `docs/features/dream-mode/mock/screens/`; fix findings; refresh `docs/screenshots/`; record
  `screen`; publish the screenshots to the owner (private Artifact page).
- [ ] **Step 5:** `/code-review` on the branch; fix or report findings; open the PR; run
  `node scripts/release-review.mjs <pr>` and report the score.
- [ ] **Step 6: Commit** each part with its files (`git add <paths>`), conventional messages.
