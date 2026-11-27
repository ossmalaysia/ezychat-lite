# AI assistants (MCP) for team members

Lasting rules and decision log (the feature folder `docs/features/mcp-for-members/` holds the confirmed mock and is
pruned later). Security wording lives in AGENTS.md → "Security invariants" (AI assistant access, MCP sign-in).

## Rules

- Admin switch **Members can connect AI assistants** (`mcp_members_enabled`, default off, needs AI assistant access on;
  audit `settings.mcp_members` before/after + revoked count). Off revokes every member's connection, and so does
  turning AI assistant access itself off (the members switch goes off with it; it cannot be armed while access is
  off: 409).
- A team member connects **only through the app sign-in** (OAuth `/oauth/authorize`, for themselves). Personal access
  tokens are admins' "master tokens" (`POST /api/integrations/tokens` and `ApiTokenService.create` refuse members).
- A member's token is rechecked on every call (`mcp/settings.ts#mcpHolderRefusal`) and reaches exactly what the
  member opens in the app: every chat through `canOpenChat`, chosen chats through `chatJids`. Never `ai:setup`
  (`ROLE_SCOPES`, at issue and at resolve). Counts (`get_stats`, `get_activity`) are admins only over MCP
  (`ToolDef.adminOnly`).
- Send is off by default: the member ticks **Let it send** on the approval page (`canSend`, carried in the one-time code,
  audited on `mcp.app_approve`) or later in **Your account → My AI assistants** (Permissions). Sends go only into
  existing chats they can open; new numbers only while the New chat service allows them (`openChecked` → `inboxFor`).
- Any role change revokes the person's tokens; disabling them stops their tokens at once.
- A member asking about another person's token (PATCH, DELETE) gets 404, never a hint it exists.
- Admins see every member's connected app in Settings → Integrations (Member badge) and can revoke it.

## Decision log

- 2026-11-20 — Owner request: members may use MCP within their own permissions and send into their own chats.
- 2026-11-20 — Owner: "no need mcp token, use dynamic oauth will do, mcp token still consider master token for now":
  members connect only through OAuth; personal access tokens stay admin-only.
- 2026-11-20 — Owner confirmed the mock: switch off revokes members' connections; stats for members later (chats only
  now); admins see and revoke members' apps; read always, send optional and off by default; any role change revokes;
  resolve/reopen for members after PR #388 merges, limited to their chats (follow-up).
