# Images from customers: image detail setting

Owner request 2026-10-23: the AI answered a customer's form screenshot with "I can't determine why submission
failed". Cause: with a ChatGPT sign-in or an OpenAI API key, customer images go with OpenAI `detail: 'low'`
(`packages/server/src/ai/provider-types.ts` `AI_IMAGE_DETAIL`), which shrinks them to about 512 × 512 px, so the
model sees the layout but cannot read small text. The owner asked for an admin setting ("can this become setting
in admin?") and agreed to **Detailed** as the default ("yes"). Status: **proposal**, waiting for confirmation of
the mock.

## Decisions

| Topic     | Decision                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Place     | Settings → AI, a card "Images from customers" beside Voice messages (same card and radio pattern).                                                                           |
| Choices   | **Detailed** (OpenAI `detail: 'high'`): reads small text in screenshots, forms and receipts. **Fast** (`detail: 'low'`): lower cost, general picture only.                   |
| Default   | **Detailed**, for new installs and existing ones (owner, 2026-10-23). Existing installs change behaviour on update: replies with images cost more and may take 1–3 s longer. |
| Claude    | Claude has no detail option and reads images up to its own size limit: the choice is replaced by a note. The saved choice stays for a later switch back to OpenAI.           |
| Save      | Saved on selection, toast "Image setting saved", like Voice messages.                                                                                                        |
| Who       | Admins only. Each change writes an audit row (`ai.image_detail` with before/after).                                                                                          |
| Scope     | One setting for all AI agents (they share one connection). Try it stays text-only. Customer enrichment never reads images.                                                   |
| Cost note | A phone screenshot at `high` is about 1,100–1,500 input tokens instead of 85; at most 3 images per reply (`AI_MAX_IMAGES`).                                                  |

## Source baseline

- Feature **emoji-reactions**, path `docs/features/emoji-reactions/mock/`, on branch `feat/emoji-reactions` at
  `988db65a` (`latestConfirmed` revision `6d17669` plus its screen-review fix). The unconfirmed `send-reactions`
  proposal is not a baseline.
- Reused: `AiVoiceSection.tsx` (card, radio cards, save on selection), `src/mock/claude.ts` (the mock's Claude
  connection, to show the note).

## Mock

- Run: `npx tsx --conditions=ezychat-source docs/features/ai-image-detail/mock/run.ts --fake-wa`, then
  `http://localhost:7481/admin/settings/ai`, open **More AI features** (API `7479`).
- Mock state: the choice lives in the browser (`localStorage` `mock.imageDetail.v1`, `src/mock/imageDetail.ts`).
- Screenshots: `node docs/features/ai-image-detail/mock/image-detail-shots.mjs` (desktop 1280 / mobile 360,
  light / dark) into `mock/screenshots/`.

## Screen and state checklist

| Area      | Screen / state                                                | Mock |
| --------- | ------------------------------------------------------------- | ---- |
| Settings  | Card with Detailed selected (default) and the Fast option     | yes  |
| Settings  | Fast selected after a click; toast                            | yes  |
| Settings  | Claude connection: the note replaces the choice               | yes  |
| Layout    | Desktop 1280 / mobile 360, light / dark, no horizontal scroll | yes  |
| Not shown | Audit row (server), agents (not admins) cannot open Settings  | —    |

## Changed and added files (mock)

- Changed: `src/admin/SettingsPage.tsx` (card in the AI tab), `src/i18n/locales/{en,ms,zh-CN}/admin.json`
  (`ai.images.*` translated; the More AI features hint).
- Added: `src/admin/AiImageSection.tsx`, `src/mock/imageDetail.ts`, `image-detail-shots.mjs`.
- Runner: `run.ts` (ports 7481/7479, temp-folder prefix), shot scripts' default port.

## Implementation notes (for after confirmation)

- Setting `ai_image_detail` (`'detailed' | 'fast'`, missing = `detailed`) in `ai/settings-keys.ts`; read per turn.
- Contract: `AiSettings.imageDetail` (zod default `'detailed'`); `PATCH /api/ai/connection` accepts it (admin).
- `ai/agent/turn.ts` and `chatgpt-backend.ts` (`userMessageContent`): `detail` from the setting instead of the
  constant `AI_IMAGE_DETAIL`; Claude unchanged (`forClaude` drops OpenAI options).
- Docs: `docs/ai-sales-agent.md` → Images.

## Retention

Adding this sixth feature folder removes the oldest by `creationOrder`, `docs/features/token-permissions`
(creation order 5; last revision with the folder `988db65a`). The `send-reactions` branch makes the same
removal; whichever merges second keeps both index entries.
