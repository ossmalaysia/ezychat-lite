# AI Sales Agent

## Setup

1. Open **Admin → Settings → AI → Configure AI connection**. Choose OpenAI API key or
   ChatGPT sign-in and save the shared connection. An empty API model uses `gpt-4.1-mini`;
   ChatGPT uses `gpt-5.4` and also supports `gpt-5.3-codex`.
2. ChatGPT sign-in uses the official bundled Codex helper. Complete browser sign-in on the
   computer hosting the inbox because its callback is localhost. Tokens use the operating
   system's secure credential store. If an OS service cannot access that store, use API mode.
   OpenAI API usage is billed separately from a ChatGPT subscription.
3. Open **Admin → Members → Add AI member**. The first version supports one AI member with
   the fixed business role **Sales Agent**. Set its name, instructions, approved business
   notes and FAQs. Save it before uploading documents, then enable automatic replies.
4. Upload Markdown, UTF-8 text, Word `.docx` or PDFs containing selectable text. Each file
   can be at most 10 MB and 100,000 extracted characters; PDFs can have at most 100 pages.
   The inbox accepts at most 20 documents and 500,000 extracted document characters.
   Convert legacy `.doc` files and apply OCR to scanned PDFs before upload.

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
  browse, execute commands, place orders or make payments. Unsupported/non-text questions,
  missing facts, a request for a human, or a provider failure trigger handoff.
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
expansion and extracted text are capped. Knowledge retrieval is local and bounds provider
context. The server limits concurrent AI workflows and persists only live inbound work to
avoid generating replies from imported history after restart.

ChatGPT uses a pinned, checksum-verified Codex 0.114.0 helper and verifies its protocol version.
The helper has a private app-owned home, keyring-only authentication, an authoritative
text-only model catalog, disabled execution/search/app capabilities and denied approval/tool
requests. This prevents customer prompts from gaining access to local app data or credentials.

Unit tests use fake providers, fake WhatsApp and temporary databases. Live provider login and
generation require credentials configured through the admin UI; no real customer messages
are sent by automated tests.
