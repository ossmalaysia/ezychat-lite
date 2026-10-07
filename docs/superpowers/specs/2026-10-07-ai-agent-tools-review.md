# AI data access review: tool calls and an agent SDK

Status: **proposal for the owner's decision** (no code yet). Date: 2026-10-07. Requirement: the agent must be LLM-agnostic.

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

You already decided (2026-10-06) not to hand-write the loop and tools, and the agent must be
**LLM-agnostic**: OpenAI (API key and ChatGPT sign-in) today, and later Claude, Gemini, local models
(Ollama) or OpenRouter without rewriting the agent. Other constraints: streaming-only ChatGPT
route, structured final output together with tools, abort, mock models in tests, no data sent
elsewhere by default, and bundling into the desktop's single CommonJS server file (esbuild,
`format: 'cjs'`).

| | Vercel AI SDK `ai` 7.x | OpenAI Agents SDK `@openai/agents` 0.19 |
| --- | --- | --- |
| **Other vendors** | **Native**: official providers for OpenAI, Anthropic, Google, OpenAI-compatible (Ollama, OpenRouter, …); one tool/agent API | OpenAI-first; other models only through `@openai/agents-extensions` → AI SDK adapter, **still beta**, no tool namespaces through it |
| Tool loop, max steps | `tool()` + zod, `stopWhen` | `tool()` + zod, `maxTurns` |
| Final structured output with tools | `Output.object` + one extra step | `outputType` (zod), native |
| ChatGPT route (stream-only, namespaced tools, some fields rejected) | `streamText`; `createOpenAI({ baseURL, fetch, headers })` — a custom `fetch` can rewrite the request (group tools into a namespace, drop rejected fields); **to prove in the spike** | streaming runs; `toolNamespace()` native |
| Abort | `abortSignal` (also passed to tools) | `signal` |
| Test without network | `MockLanguageModel` (`ai/test`) | `ScriptedModel`, `assertComplete()` |
| Sends data elsewhere by default | Nothing unless telemetry is registered | **Tracing on by default in servers** (must be disabled) |
| Maturity | Breaking major about every 6 months | 0.x, still changing |
| License | Apache-2.0 | MIT |

Others: Mastra (heavier, adds deps for a framework we don't need), LangGraph.js (a graph runtime,
more than one agent needs). Claude Agent SDK runs Claude models only, the opposite of agnostic.

### Measured comparison (2026-10-07)

Two checks, four SDKs: a docs review against our needs (source for every cell) and a hands-on test.
The test builds the same agent in each (two zod tools; the chat id given by the server, not the
model; a structured `{ action, reply }` answer), runs it on each SDK's **mock model** (no AI calls),
bundles it the way the desktop app does (esbuild, one CommonJS file), and logs every network
attempt.

| | Vercel AI SDK `ai` 7.0 | OpenAI Agents 0.19 | Mastra 1.75 | Google ADK TS 2.2 |
| --- | --- | --- | --- | --- |
| OpenAI key + ChatGPT route from TypeScript | `createOpenAI({ fetch, headers })`; a custom fetch reshapes requests for ChatGPT | native, incl. `toolNamespace()` | through the AI SDK | **no OpenAI model in TS** (LiteLLM is Python-only): we would write the whole model adapter |
| Chat id into tools (not chosen by the model) | typed per-tool context | run context | `RequestContext` | session state |
| Structured answer + tools | `Output.object` | `outputType` | `structuredOutput` | `set_model_response` tool |
| Sessions required | no (we pass history) | no | no | **yes** (Runner + session service) |
| Sends data elsewhere by default (docs) | nothing | **traces to OpenAI** | **PostHog analytics** (server/CLI paths; 0 attempts in our test) | nothing (OTLP only if configured) |
| Official mock model | `ai/test` | `@openai/agents/testing` | AI SDK mock | **none** |
| Dependency tree / node_modules | 50 lines / 38 MB | 73 / 87 MB | 395 / 155 MB | 360 / 156 MB |
| One-file CJS bundle | **OK, 1.2 MB, no warnings** | OK, 4.5 MB | OK, 11.4 MB | **crashes at load** (`createRequire(import.meta.url)`), OK only with a shim; 7.4 MB |
| Run time (bare Node ≈ 830 ms) | ≈ 900 ms | ≈ 1,030 ms | ≈ 1,175 ms | ≈ 1,045 ms |
| Network attempts in the test | 0 | 0 | 0 | 0 |
| Already-aborted signal | throws | throws | returns empty | ends silently |
| Maturity | major every ~6 months | 0.x | very frequent releases | 2 majors in 4 months |

**Google ADK, fairly:** strong guardrails (callbacks, a security plugin, per-tool confirmation),
cancellation down to the model, nothing sent by default, MCP. But for this app it is Gemini-first:
we would write and maintain the OpenAI adapter ourselves, run its session layer next to our SQLite
history, and patch the bundle. It becomes a real option only if Gemini becomes the main model.

**Mastra** works, but it adds a framework layer we don't use, 10× the bundle and analytics we
would have to keep off. **OpenAI Agents** is the runner-up: clean bundle and the best test kit, but
traces go to OpenAI unless disabled, and it is still 0.x.

Whichever SDK we use, add a test that cancelling a reply really stops it: two of the four return
quietly instead of throwing.

**Recommendation: adopt the Vercel AI SDK**, behind a thin port of our own, so the vendor choice is
configuration, not code:

```ts
// ai/agent/port.ts — the only thing service.ts calls
runAgentTurn(input: {
  model: AgentModelConfig;      // { vendor: 'openai' | 'chatgpt' | 'anthropic' | 'google' | 'openai-compatible', model, credentials }
  instructions: string;         // unchanged prompt.ts output
  input: string;                // businessKnowledge → conversation → currentSituation
  images: AiPromptImage[];
  tools: AiReadTool[];          // chat-bound (section 2)
  signal: AbortSignal;
}): Promise<{ decision: AiDecision; proposals: AiProposal[]; usage }>;
```

- `openai` = `@ai-sdk/openai` Responses with the API key; `chatgpt` = the same provider pointed at the
  official route with the sign-in token and a request-rewriting `fetch`; other vendors are one
  provider package each, added when wanted.
- Prompt caching stays vendor-neutral because the layout is already "most stable first"; per-vendor
  hints (OpenAI `promptCacheKey`, Anthropic cache breakpoints) go through `providerOptions`.
- Weaker models (small local ones) may call tools badly or miss the output schema: the server
  guards still decide, and a schema failure hands the chat to the team as today.
- Pin the major version; budget a short upgrade PR per AI SDK major.

The OpenAI Agents SDK stays the better choice only if we were OpenAI-only: it has native namespaced
tools and a richer test kit, but agnostic use means the beta adapter on top of the AI SDK anyway.

## 5. Plan, in small PRs

1. **Spike (throwaway, 1 day):** `ai` + `@ai-sdk/openai` bundled into `server.cjs`; one
   `streamText` run with a function tool and `Output.object` on (a) the API key, (b) the official
   ChatGPT route through a rewriting `fetch` (namespaced tools, rejected fields removed), and (c) one
   non-OpenAI provider (e.g. a local Ollama model) to prove the port is vendor-neutral;
   `MockLanguageModel` test. Report: bundle size, cold start, rejected fields, tool-call quality.
2. **ChatGPT mode → official route** (if you approve it): new token audience and host id, same UX.
   Useful on its own, even without tools.
3. **Parity swap:** replace the two hand-written providers with `runAgentTurn` and **no tools**, same
   `AiDecision` output. Every existing test and the Dev Build checks must pass unchanged.
4. **First read tools:** `search_business_context`, `get_chat_history`, with the invariants above;
   Dev Build checks logged in `docs/dev-build-checks.md`.
5. **More vendors** (Settings → AI gets a vendor picker) and **action proposals**
   (`add_internal_note`, then booking drafts), in the order you prefer.

## 6. Decisions needed from the owner

1. Adopt the Vercel AI SDK for an LLM-agnostic agent (recommended)?
2. Move ChatGPT sign-in to OpenAI's official route? This requires confirming that EzyChat Lite fits
   "open-source and locally hosted". Otherwise we stay on the undocumented endpoint OpenAI says not
   to use.
3. Which vendor after OpenAI (Claude, Gemini, local Ollama, OpenRouter), and which first tools:
   deeper knowledge search, older history, or an integration such as orders or bookings?
