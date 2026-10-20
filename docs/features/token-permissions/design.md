# Change what an access token may do

Owner request (2026-10-20): "it is troublesome to reissue access token, please allow to update access
token permission like allow send msg". Status: **server done; the UI waits for the mock confirmation**
(AGENTS.md: mock first).

## Goal

An admin turns "Can send WhatsApp messages" and "Can also message new numbers" on or off for a token
they already use, in Settings → Integrations, without creating a new token and connecting the AI
assistant again.

## Rules (security first)

| Rule                                                                                                                                                                                                               | Why                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Only the **owner** of a token can change it (403 for another admin); a revoked or unknown token is 404, an expired one 400.                                                                                        | A token acts as its owner: another admin must not make it send in someone else's name. |
| Only in a signed-in session (`PATCH /api/integrations/tokens/:id`, admin-only, Origin check, rate-limited with token creation). `/api` never accepts a token, so **a token can never change its own permissions**. | No privilege escalation from a leaked token.                                           |
| The same options, dependency and warnings as Create token: "new numbers" only together with "Can send".                                                                                                            | One set of rules, one set of warnings.                                                 |
| Only the send scopes change; reading the inbox and the AI setup tools stay.                                                                                                                                        | The change does what its label says, nothing more.                                     |
| Audit `api_token.update` {tokenId, name, prefix, before, after}.                                                                                                                                                   | Who allowed sending, and when.                                                         |
| The change applies on the assistant's next request (the token's scopes are read on every call); the tool list changes with it.                                                                                     | No reconnect.                                                                          |

This changes the AGENTS.md invariant "a token never gains a scope later" to "only its owner, in
Settings, audited; never through a token".

## UI (needs the mock confirmation)

1. Token list: a **Permissions** button next to **Revoke** on the signed-in admin's own tokens that
   have not expired. On phones the two buttons move to their own row under the details, so the token
   name keeps the full width.
2. Permissions dialog ("Permissions of “<name>”"): the two checkboxes as they are now, with the Create
   token hints and warnings, the line "The change applies on the assistant's next request…", Cancel
   and Save. Save stays off until something changed; a toast "Permissions saved" after it, and the
   badges update.

### Mock

- Runnable mock: `docs/features/token-permissions/mock/` (README: run, walkthrough, checks).
- Source: the latest owner-confirmed reference **mcp-send-message** at git revision
  `b3a5479b92cc4b519b141ebb013758c13bcea67c`, cloned whole (its earlier drift fixes are kept).
- This proposal changes 4 files (`IntegrationsSection.tsx`, the `admin` catalogs in en, ms and zh-CN)
  and adds `src/admin/TokenPermissionsDialog.tsx`; `snapshot.mjs --check` verifies the rest.
- Screenshots (1280 px and 360 px): `mock/screenshots/01-token-list`, `02-permissions-dialog`,
  `03-permissions-new-numbers`, `04-saved` (desktop). No page errors, no horizontal scroll.
- **Confirmation: pending** (owner). Production UI starts only after it.

## Plan

| #   | Step                                                                                                                                                                      | Tests                                                                                       | State                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Shared `UpdateApiTokenBody` / `UpdateApiTokenResponse`; `ApiTokenService.updatePermissions` (owner only, keeps other scopes, audit); `PATCH /api/integrations/tokens/:id` | `api-token-permissions.test.ts` (real route + real `/mcp` tool list), admin-only route list | done                  |
| 2   | HTML mock (Permissions button, dialog, phone layout)                                                                                                                      | `perm-shots.mjs` at 1280/360 px                                                             | done, waits for owner |
| 3   | UI after confirmation: `useUpdateApiToken`, the dialog, the row layout, i18n en/ms/zh-CN, web tests, e2e, screen review                                                   | web tests + e2e + screens.smoke                                                             | after confirmation    |
| 4   | Docs: AGENTS.md security invariant, CHANGELOG                                                                                                                             | —                                                                                           | done                  |
