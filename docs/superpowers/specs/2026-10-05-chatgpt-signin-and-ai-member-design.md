# ChatGPT sign-in (no Codex), inline AI settings and AI member page — design

Date: 2026-10-05 · Status: for owner review · Branch: `spike/chatgpt-direct-login` (proved working)

## 1. Goal

- ChatGPT sign-in works without installing or bundling Codex. The owner tested it: sign-in completed, the live
  model list loaded (GPT-6.1-Sol … GPT-5.5), and the AI Sales Agent answered a customer correctly.
- AI settings are edited in place, with no popup.
- Setting up the AI Sales Agent is simple, safe and testable before it goes live.

Owner decisions so far:
- Use the direct ChatGPT token like OpenClaw/Hermes, and accept that the endpoint is not public.
- Don't bundle Codex.
- Put the AI connection on the AI tab, inline.
- Redesign Add AI member.

## 2. ChatGPT sign-in — hardening the spike

Keep the spike's design (`ai/chatgpt-oauth.ts`, `chatgpt-backend.ts`, `chatgpt-direct.ts`) and finish it:

| Area | Rule |
| --- | --- |
| Login flow | PKCE S256 and a 128-bit `state`, compared in constant time. Only one sign-in at a time. A new sign-in cancels the old one. |
| Callback | A one-shot listener on `127.0.0.1:1455`, `GET /auth/callback` only, loopback `Host` only. It closes on success, failure, cancel or after 5 minutes. If the port is busy, the user sees a clear 409 message. |
| Remote admins (tunnel/LAN) | Fallback: the admin pastes the final `http://localhost:1455/auth/callback?code=…&state=…` URL from their browser into the app. The server checks `state` and exchanges the code exactly as the listener would. |
| Token storage | Access, refresh and id tokens plus the account id are kept only as encrypted settings (`secret.key`). Signing out deletes them. Turning ChatGPT mode off keeps them until the user signs out. |
| Refresh | Single-flight. Runs 2 minutes before expiry and once after a 401. If the refresh token is rejected, the state becomes "expired", with the message "Sign in again". |
| Blocked or changed endpoint | A 403/404, or an unexpected response shape, sets the connection to `error` with a clear message. The AI agent stops claiming chats (they stay unassigned for humans), and admins get one banner on the AI tab and on the AI member page. Customers never receive error text. |
| Logging | Log only event names, HTTP status, model and timings. Tokens, codes, `state`, verifier, JWTs and full URLs are redacted from live logs and support exports, with tests. |
| Access control | Every `/api/ai/*` route is admin-only and passes the existing Origin/Host checks. Starting a sign-in is rate-limited. |
| Identity | Requests send `originator`/User-Agent as the spike does, labelled experimental in code. The model list comes from the backend `models` endpoint, with the static fallback list from the spike. |

Codex: the ChatGPT connection mode uses the direct client only. Remove the Codex download from the build
(`scripts/fetch-codex.mjs` call in desktop `dist`) and the bundled `resources/codex`; this shrinks the installer by about
140 MB. Keep `codex-*.ts` out of the runtime path. Delete them if nothing else uses them; the fallback to a
locally installed Codex CLI is a later option if the direct path breaks.

## 3. Settings → AI tab, inline

The tab shows the connection form directly; the "Configure" popup goes away.

- **Connection:** a segmented switch, `OpenAI API key | ChatGPT sign-in`, with ChatGPT labelled *Experimental*.
- **ChatGPT signed out:** a one-click "Sign in with ChatGPT" button, with an "Open sign-in" link if a popup is blocked and the paste-URL fallback.
- **ChatGPT signed in:** "Signed in as <email>" and a Sign out button.
- **API key mode:** the key field, masked and write-only.
- **Model:** a dropdown with **Auto (recommended)** first, then the live model list.
- **Test connection:** shows the reply and the model name, or the error.
- **Save:** one Save button; unsaved changes show a small "Unsaved" marker.

`AiMemberPanel` is split into presentational sections; the AI tab uses only the connection section.

## 4. AI member page (replaces the "Add AI member" popup)

Route: `/admin/members/ai`. "Add AI member", and clicking the AI row in the Members list, open this page.
The AI row in the list shows a 🤖 badge.

```
Members ▸ AI Sales Agent                       ● Off   [ Turn on ]
① Name & role    name field; role line
② Knowledge      Instructions (with example placeholder) · Business notes · FAQs (add/remove rows)
                 Documents (upload works immediately; first upload saves a draft member)
③ Try it         [ customer question ] [Ask] → AI answer + model, using the CURRENT (unsaved) knowledge
ⓘ How it works   collapsed: 10-second wait, takes ownership, hand-off to humans, resolves only on confirmation
Connection: ChatGPT ✓ connected · Settings → AI   (deep link to /admin/settings/ai)
                                            [ Save ]   (sticky on mobile)
```

- **Status pill:** Off / On / Needs connection / Needs knowledge. **Turn on** is disabled, with the reason shown, until the connection works and at least one of instructions, notes, FAQs or a document exists. Turning on saves the page first.
- **Try it:** a new admin endpoint, `POST /api/ai/try`, with `{ question, draft knowledge }`. It returns `{ reply, model }`, never touches a chat and never sends WhatsApp. It is rate-limited (e.g. 10/min) and capped at 500 characters.
- Works at 360px with token classes and shadcn primitives. All copy goes through `t()` in en / ms / zh-CN.

## 5. Testing

- **Server:**
  - OAuth: URL, PKCE, state, the Host check on the callback, timeout, port in use, paste-URL exchange;
  - refresh (single-flight, 401, revoked);
  - the blocked/403 state, and that the AI stops claiming chats in that state;
  - redaction (live logs and support export);
  - route access control: admin-only and Origin;
  - `/api/ai/try`: no chat side effects, rate limit, cap.
- **Web:**
  - the AI tab inline flows: one-click, popup blocked, paste URL, Test connection, the dropdown with Auto;
  - the AI member page: Turn on guard, Try it, upload before the first save;
  - the Members row link and the deep link to the AI tab.
- The every-screen smoke covers `/admin/settings/ai` and `/admin/members/ai`, desktop and mobile.
- **Owner Dev Build test:**
  - sign in;
  - pick a model;
  - Try it;
  - Turn on;
  - a simulated customer message gets an AI reply.

## 6. Out of scope

- Several AI members.
- Per-chat AI settings.
- A paid OpenAI organisation login.
- The local-Codex-CLI fallback.
- Translating customer replies.
