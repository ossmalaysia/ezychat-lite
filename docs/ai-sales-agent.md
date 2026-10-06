# AI Sales Agent

## Setup

1. Open **Admin → Settings → AI → Configure AI connection**. Choose OpenAI API key or
   ChatGPT sign-in and save the shared connection. An empty API model uses `gpt-4.1-mini`;
   ChatGPT uses `gpt-5.4` and also supports `gpt-5.3-codex`.
2. ChatGPT sign-in uses the official bundled Codex helper. Complete browser sign-in on the
   computer hosting the inbox because its callback is localhost. Tokens use the operating
   system's secure credential store. If an OS service cannot access that store, use API mode.
   OpenAI API usage is billed separately from a ChatGPT subscription.
3. Open **Admin → Members → AI Sales Agent**. The first version supports one AI member with
   the fixed business role **Sales Agent**. Besides its name it has exactly two settings:
   - **AI instructions** (up to 8,000 characters): how the AI behaves — tone, language, what
     to answer and what to leave to humans. A new member starts with recommended default
     instructions (`DEFAULT_AI_INSTRUCTIONS` in `packages/shared/src/ai.ts`: friendly, short,
     the customer's language, exact facts from the context, no guessing); "Use default
     instructions" restores them, and blank saved instructions also fall back to them.
   - **Business context**: a list of items, like a project knowledge panel. Each item is an
     uploaded file or text content added in the app, shown with its name, size and added
     date. Search filters by name; **Select** deletes several items after a confirmation;
     **Add ▾** offers **Upload from device** and **Add text content**. Click an item to open
     it: text items (name up to 120 characters, text up to 100,000 characters counted as
     Unicode code points so an emoji counts once) can be edited; files show a read-only
     preview of their extracted text (the first 20,000 characters). Below 640px the table
     becomes a stacked list.

   Turn on requires at least one context item with text: the AI answers only from business
   facts, so instructions alone are not enough (the status shows "Needs business context").
   Context items belong to the AI member, so the first upload or text item saves the member as
   a disabled draft.

4. Upload Markdown, UTF-8 text, Word `.docx` or PDFs containing selectable text. Each file
   can be at most 10 MB and 100,000 extracted characters; PDFs can have at most 100 pages.
   The inbox accepts at most 20 context items (files and text together) and 500,000
   characters of text in total. Convert legacy `.doc` files and apply OCR to scanned PDFs
   before upload.

API: `GET /api/ai` lists the items (`documents`: id, name, `kind` `file`/`text`, `size` in
bytes of the upload or of the text in UTF-8, characters, `createdAt`, `updatedAt`).
`POST /api/ai/documents` uploads a file, `POST /api/ai/documents/text` adds text content
(`{ name, text }`), `GET /api/ai/documents/:id` returns an item with its text (full for text
items, a preview for files, with `truncated`), `PATCH /api/ai/documents/:id` edits a text item
(`{ name?, text? }`; files are read-only) and `DELETE /api/ai/documents/:id` removes an item.
All are admin-only and audited without content.

**Upgrading from earlier versions.** Earlier versions stored member knowledge in the AI
settings: first separate business notes and an FAQ list, later one Business context text.
When the settings are read, that text becomes ONE text item named **Business context** (notes,
then `Q: <question>` / `A: <answer>` for each FAQ, separated by blank lines), and the old
fields are removed from the settings. The setting `ai_context_migrated` marks the move done, so
it never creates a second item; empty old knowledge just drops the fields. The item is older
than anything added afterwards, so it stays first. Only if the text exceeds 100,000 code
points is it cut: the first 100,000 code points are kept (never splitting an emoji) and the
server logs a warning (`mod: "ai"`, `event: "ai_context_truncated"`); the move itself logs
`event: "ai_context_migrated"`. Unsaved page drafts from an older shape are discarded. An
install that was turned on with instructions only stays on, but hands every chat to a human
until a context item is added.

Installs already at the 20-item limit can end up with a 21st item after this migration (the
migrated **Business context** item is added on top of existing items). Nothing is lost; new
adds are blocked until an item is removed.

Connection/model settings belong to the whole inbox. They are stored separately from the
Sales Agent's instructions and knowledge so a future Follow-up Agent can share the provider.
Editing a member cannot overwrite the inbox connection or its credentials. Chat-internal
notes are not automatically included in the approved business knowledge.

## Chat behavior

- Only live incoming messages in direct customer chats start fallback. Imported WhatsApp
  history and group chats do not. Chats owned by humans remain with their owners.
- An unassigned chat waits 10 seconds after the latest incoming customer message. A human
  reply or assignment cancels fallback. AI claims the chat when fallback starts.
- Once AI owns a chat, further messages use a brief 300 ms debounce rather than the initial
  10-second wait. The normal WhatsApp send queue still spaces outgoing messages.
- Assigning a chat to a human cancels generation and queued AI replies. Ownership and the
  latest customer message are checked again immediately before WhatsApp sending. A message
  already transmitted to WhatsApp cannot be recalled by this cancellation.
- AI answers only from relevant approved knowledge and the current conversation. It cannot
  browse, execute commands, place orders or make payments. Hand-offs come in two layers:
  - **System hand-offs** (fixed in `ai/prompt.ts`, business-agnostic, cannot be removed): the
    customer asks for a person (`asked_for_human`), a request the AI cannot carry out such as
    placing, changing or cancelling an order, booking or paying (`needs_action`), facts missing
    from the business context (`missing_facts`), and legal, medical or personal-data matters
    (`sensitive`). Unsupported/non-text messages and provider failures also hand off.
  - **Business hand-off rules** (Members → AI Sales Agent → "Hand-off rules", stored as
    `handoffRules`): cases this business wants a person to handle, e.g. complaints, refunds,
    quotations or price negotiation. A new member starts with `DEFAULT_AI_HANDOFF_RULES`; a
    saved blank value means no extra rules. A match hands off with reason `business_rule`.
  The reason is recorded on the chat event and shown in the timeline and in Try it. Every reply
  reads the saved Business context items afresh, so edits apply to the next answer.
- Handoff selects an enabled human with the **Agent** sign-in role, no open assigned chats,
  and an active inbox connection. If nobody qualifies, it tells the customer a human will
  help and returns the chat to unassigned. AI stays paused after handoff; a human can
  explicitly assign AI again to resume it.
- After answering, the AI asks "Does that answer your question?" in the customer's language
  (it does not invite new questions). After that question, the chat closes when the model
  decides the customer confirmed — in any words ("Ok noted, yes that answers it. Thank you!",
  "Ok baik, terima kasih", "好的，明白了，谢谢", or closings such as "no thanks", "that's all",
  "tak ada lagi", "没有了") — unless any customer message since the AI's last reply has a
  question mark, a negation or hesitation ("no", "not", "didn't", "but", "however", "tidak",
  "bukan", "tapi", "不", "没", "但是") or a new request ("also", "one more thing", "need").
  After two resolution questions in a row answered with confirming-looking replies, the server
  closes the chat so customers are never asked forever; a new question or objection restarts
  that count, and the server never turns an answer into a resolution. A human can resolve an
  AI-owned chat at any time.
- Order, booking and delivery-slot questions get the known facts (prices, totals, delivery fee)
  and "the team will confirm the slot/order"; the AI keeps the chat. It hands off only when a
  human is requested, facts are missing or conflicting, or the topic is sensitive.
- Resolution clears ownership. A later customer message reopens the chat and starts a new
  fallback opportunity. Disabling AI stops automatic work and releases its open chats.

## Implementation and validation

AI members are assignment identities, not sign-in accounts: no passwords, sessions, role
promotion or credential actions. Admin-only routes enforce existing Host/Origin guards and
recheck sessions after asynchronous uploads/sign-in. API keys use encrypted settings; model
inputs, OAuth URLs and credentials are omitted from logs and audits.

Document parsing runs in a worker with a 15-second deadline and bounded V8 memory. Word archive
expansion and extracted text are capped. Knowledge retrieval is local (no vector database) and
bounds provider context. The AI instructions always go to the system prompt; the knowledge
sources are the context items, oldest first (by added date, then id; editing an item never
moves it), each labelled `[<item name>]` and treated as data, never instructions. When the item
texts total at most 40,000 characters, all of it is sent in that order. Above that, the items
are split into chunks (blank-line paragraphs packed up to 1,500 characters) and the 14 best
matches for the latest customer messages are sent (at most 24,000 characters), always including
the first chunk of the oldest text item (the business overview, for example the migrated
"Business context"). Matching counts shared words (two or more letters,
ignoring a few English/Malay stop words) and, for Chinese, Japanese and Korean, overlapping
two-character pairs, because those languages have no spaces. Known limit: a question in one
language about a fact written in another (for example Malay about an English fact) deep in a
very large context may miss that fact; typical briefs fit the full-context budget.

Try it answers with the page's current (possibly unsaved) name and instructions and the saved
context items; items are saved as soon as they are added, so there is no unsaved context.

### Prompt layout and caching

Live replies and Try it share one builder (`ai/prompt.ts`), laid out most-stable-first so
provider prefix caching can reuse it:

1. `instructions`: the fixed system rules plus the administrator instructions. They hold no
   per-call values, so they are identical for every chat until an admin edits the AI member.
2. `input`: one JSON object whose keys are always in this order:
   `businessKnowledge` (byte-identical across calls while the knowledge fits the 40,000-character
   full-context budget: sources in a fixed order, no timestamps or ids), then `conversation`, then
   `currentSituation` (always last): `date` (`YYYY-MM-DD`), English `weekday`, local `time`
   (`HH:mm`), `timeZone`, and `resolution` ("Resolution confirmation is currently awaited / NOT
   awaited."). A system rule tells the model to use this block for "today", "tomorrow" or "open now".

The time zone comes from the optional setting `ai_timezone` (an IANA name such as
`Europe/London`; no UI yet). If the setting is missing or the zone is unknown, the default is
`Asia/Kuala_Lumpur`. The builder is pure: the service passes `now` and the zone.

Cache key: on first use the server stores a random per-install id in the setting `ai_install_id`.
Both providers send `prompt_cache_key = "ezychat-" + first 16 hex of sha256(install id + "\n" +
model)`, so the key is stable for this inbox and model, differs by model, and never contains
customer data. The ChatGPT backend also gets the same value as its `session_id` header. pi-ai
sends one value for both, and docs/ai-chatgpt-protocol.md lists `session_id` as optional, so the key is not
per-request. The connection test, which has no install id, still uses a random id. The OpenAI
Responses API accepts `prompt_cache_key`, and its prefix caching is automatic.

A saved ChatGPT model that is no longer in the live or documented model list (for example a
Codex-era `gpt-5.4`) falls back to Auto. Each fallback is logged with the model and the
reason (`event: "chatgpt_model_unavailable"`, `reason: "not_in_live_list"` or
`"not_in_fallback_list"`), at most once an hour per saved model. The server limits concurrent AI workflows and persists only live inbound work to
avoid generating replies from imported history after restart.

ChatGPT uses a pinned, checksum-verified Codex 0.114.0 helper and verifies its protocol version.
The helper has a private app-owned home, keyring-only authentication, an authoritative
text-only model catalog, disabled execution/search/app capabilities and denied approval/tool
requests. This prevents customer prompts from gaining access to local app data or credentials.

Unit tests use fake providers, fake WhatsApp and temporary databases. Live provider login and
generation require credentials configured through the admin UI; no real customer messages
are sent by automated tests.
