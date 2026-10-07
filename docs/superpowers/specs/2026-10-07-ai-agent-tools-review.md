# AI data access review: tool calls and an agent SDK

Status: **proposal for the owner's decision** (no code yet). Date: 2026-10-07.

## 1. How the AI reads data today

One model call per customer turn. The server decides **everything** the model sees and pushes it
into one prompt, then the model returns one structured decision.

| What the AI sees | Where | How it is chosen |
| --- | --- | --- |
| System rules, admin instructions, hand-off rules | `instructions` (static, cached) | Always |
| Business context (up to 20 items) | `input.businessKnowledge` | Everything up to 40,000 chars, else a CJK-aware keyword pick on the customer's message |
| Last 20 messages, voice transcripts, image markers | `input.conversation` (+ `input_image` parts) | Always |
| Date, time, zone, resolution state, saved customer details (no tags) | `input.currentSituation` (last) | Always (customer only when saved) |

The model returns `AiDecision` (`answer` / `ask_resolution` / `resolve` / `handoff` + reply +
hand-off reason). `service.ts` then decides: ownership (`owned()`), resolution guard, voice rules,
stale-customer-details check, send queue, hand-off. Both providers (API key → `api.openai.com`,
ChatGPT → `chatgpt.com/backend-api/codex`) send Responses-API requests with `tools: []`.

**What works well:** cheap (one call), predictable, prompt-cache friendly, easy to test with a mock
provider, privacy controlled in one place (tags and internal notes never leave), and "model
proposes, code decides" is enforced by the server.

**Where it stops scaling:**

1. Every new source of information means editing `prompt.ts`, `service.ts`, the system text and
   the tests, and it is sent on **every** turn even when irrelevant (the address goes with an
   opening-hours question): more tokens, more data exposure.
2. The AI cannot look anything up on demand: order status, stock, booking slots, older history,
   a second knowledge search with better terms. That needs tool calls.
3. Knowledge selection above 40,000 chars is a single keyword pass on the customer's message; the
   model cannot ask for more.
4. Actions are a fixed enum. Adding "write an internal note" or "draft a booking" changes the
   shared schema, the service and the prompt together.
5. `service.ts` (1,100 lines) mixes scheduling, the model call, guards and side effects.

## 2. Proposed architecture: context + read tools + proposed actions

Keep a **small pushed context** for what almost every reply needs; let the model **pull** the rest
through tools; let it **propose** actions that the server validates.

```
customer message ─► Agent run (max 4 steps, AbortSignal per chat)
                     instructions (static)        ◄─ cached prefix
                     tools (static list)          ◄─ cached prefix
                     input: knowledge summary? → conversation → currentSituation (+customer)
                     ├─ read tool call ─► server handler (bound to THIS chat) ─► data
                     ├─ action tool call ─► server records a proposal (no side effect)
                     └─ final output: AiDecision (same schema as today)
                   ─► server guards decide: send / hand off / resolve / apply proposals
```

**Tool contract** (one small module per tool, registered in a list, no custom loop):

```ts
interface AiReadTool<I, O> {
  name: string;                 // e.g. 'search_business_context'
  description: string;          // what it returns and when to use it
  input: z.ZodType<I>;          // never contains a chat id, phone or user id
  run(input: I, ctx: { chatJid: string; db: DB; signal: AbortSignal }): Promise<O>;
  // O is redacted and size-capped by the tool itself (no tags, no internal notes, ≤ N chars)
}
```

**Invariants (each needs a test):**

- **Bound to the chat:** the server injects `chatJid`; tools have no identity arguments, so a
  prompt injection cannot read another customer.
- **Read tools are read-only. Actions are proposals:** the server applies them after the run with
  the same guards as today (ownership, resolution guard, hand-off rules). The final output stays
  `AiDecision`.
- **Redaction lives in the tool:** tags and internal notes never leave; outputs are size-capped.
- **Limits:** at most 4 model steps and a total timeout per reply; the existing per-chat
  `AbortController` cancels the run when a teammate takes over.
- **Cache:** the tool list is static and comes before the conversation; tool results come after it.
- **Audit:** log every tool call (name, duration, size; never its content).

**First tools (read):**

| Tool | Replaces / adds |
| --- | --- |
| `search_business_context(query)` | Replaces the single keyword pass above 40,000 chars; the model can search again with better words |
| `get_chat_history(before?)` | Older messages beyond the last 20, on demand |
| `get_customer_profile()` | Optional: keep the pushed `currentSituation.customer` (small, used on most turns) |
| later: `get_order_status`, `check_booking_slots` | Integrations with the business's own systems |

**Actions (proposals), later:** `add_internal_note(text)`, `draft_booking(...)`, and the existing
hand-off and resolve.

**Cost:** a tool step is one more model round trip (about 1–3 s and its tokens). Most replies need
none, so the pushed context stays; tools are for the long tail.

## 3. A finding about ChatGPT sign-in

OpenAI now documents "ChatGPT plan usage" for **open-source and locally hosted apps**
(developers.openai.com/siwc/token-sharing-open-source). The ChatGPT sign-in token goes to the
**public** `POST https://api.openai.com/v1/responses`, and the docs say: *"do not point it at
ChatGPT's `backend-api` endpoints"*. That is the endpoint our ChatGPT mode uses today.

On that official route:

- `store: false` and `stream: true` are required;
- `temperature`, `max_output_tokens`, `metadata`, `prompt_cache_retention`, `truncation`, `user`,
  `previous_response_id` and `system` role messages are rejected;
- **function tools are supported** when grouped in namespaces (or sent as `additional_tools`);
- registration is dynamic and needs a stable, opaque `ext_agent_host_id` per install.

EzyChat Lite is public (MIT) and runs on the customer's own computer. Paid or remotely hosted apps
must use OpenAI's interest form instead, so **whether this route fits how you sell and host the app
is the owner's call.** If it fits, both modes use one endpoint and differ only in the token and the
streaming rule. That makes the SDK choice below simpler and removes the undocumented endpoint.

## 4. Should we bring in an agent SDK?

You already decided (2026-10-06) not to hand-write the loop and tools. Candidates, checked against
this app's constraints: both sign-in modes, streaming-only ChatGPT route, structured final output
with tools, abort, mock models in tests, no data sent elsewhere by default, and bundling into the
desktop's single CommonJS server file (esbuild, `format: 'cjs'`).

| | OpenAI Agents SDK `@openai/agents` 0.19 | Vercel AI SDK `ai` 7.x |
| --- | --- | --- |
| Tool loop, max steps | `tool()` + zod, `maxTurns` | `tool()` + zod, `stopWhen` |
| Final structured output with tools | `outputType` (zod), native | `Output.object` + one extra step |
| ChatGPT route (stream-only, namespaces) | streaming runs; `toolNamespace()`; custom `Model` possible | needs `streamText` or a custom provider; namespaces unverified |
| Abort | `signal` | `abortSignal` (also passed to tools) |
| Test without network | `ScriptedModel`, `assertComplete()` | `MockLanguageModel` |
| Sends data elsewhere by default | **Tracing on by default in servers** → must call `setTracingDisabled(true)` | Nothing unless enabled |
| Maturity | 0.x, still changing | Breaking major about every 6 months |
| License | MIT | Apache-2.0 |

Others: Mastra (heavy, extra deps), LangGraph.js (a graph runtime, more than one agent needs).
Claude Agent SDK runs Claude models, not this app's OpenAI/ChatGPT accounts.

**Recommendation: yes, adopt `@openai/agents`**, behind a thin port of our own
(`runAgentTurn(chat, signal) → AiDecision + proposals`). It is Responses-native (namespaced tools,
`store`, input items), is made by the same vendor as both endpoints, has the best test kit for
multi-step tool runs, and keeps our guards outside the model. Conditions:

1. Tracing disabled at startup, with a test that asserts it (otherwise chats go to OpenAI's trace
   dashboard and tests would call OpenAI).
2. Pin the version; it is 0.x.
3. A spike first proves it bundles into `server.cjs` and runs in the packaged app.

Choose the AI SDK only if multi-vendor models (e.g. Gemini, Claude) become a goal.

## 5. Plan, in small PRs

1. **Spike (throwaway, 1 day):** `@openai/agents` bundled into `server.cjs`; one streaming run
   with a function tool on both the API key and the official ChatGPT route; tracing off;
   `ScriptedModel` test. Report: bundle size, cold start, any rejected request field.
2. **ChatGPT mode → official route** (if you approve it): new token audience and host id, same
   UX. Useful on its own, even without tools.
3. **Parity swap:** replace the single provider call with an Agents SDK run that has **no tools**
   and the same `AiDecision` output. Every existing test and the Dev Build checks must pass unchanged.
4. **First read tools:** `search_business_context`, `get_chat_history`, with the invariants above;
   Dev Build checks logged in `docs/dev-build-checks.md`.
5. **Action proposals:** `add_internal_note`, then booking drafts.

## 6. Decisions needed from the owner

1. Adopt `@openai/agents` (recommended) or the Vercel AI SDK?
2. Move ChatGPT sign-in to OpenAI's official route? This requires confirming that EzyChat Lite fits
   "open-source and locally hosted". Otherwise we stay on the undocumented endpoint OpenAI says not
   to use.
3. Which first tools matter most for your customers: deeper knowledge search, older history, or an
   integration such as orders or bookings?
