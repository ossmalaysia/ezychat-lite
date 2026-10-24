# EzyChat Lite roadmap

EzyChat Lite is an open-source rewrite of our internal EzyChat tool. We want businesses to
manage sales conversations easily, with security and straightforward setup built into the
foundation. Inspired by [EzyChat](https://ezychat.ai/), Lite is a free team inbox that runs
on a computer you control: no per-seat fees and no per-message fees.

This is a direction, not a release schedule. Planned features are not available yet; priorities
may change with feedback from businesses using the inbox. Last reviewed: October 2026.

| Stage                               | Status               | What it covers                                                                                                                                                                                        |
| ----------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team inbox                          | Available; improving | One linked WhatsApp number, shared conversations, assignments, internal notes, quick replies, member roles, mobile access, notifications, voice notes, emoji reactions, group info and local backups. |
| Security and easy setup             | Ongoing              | Setup wizard, clear connection status, guided remote access, dependable updates, recovery and accessible desktop/mobile workflows.                                                                    |
| AI agents                           | In preview           | Sales, FAQ or custom AI agents that answer from your business context, hand off to people and close chats only after the customer confirms. Your own OpenAI or Claude API key, or ChatGPT sign-in.    |
| AI assistant access (MCP)           | Available; improving | Let an AI assistant such as Claude or ChatGPT read the inbox, review and tune the AI agent, and send replies only with a token you allowed to send.                                                   |
| Light CRM                           | In progress          | Customer profiles, tags and optional profile suggestions are available. Next: follow-up reminders, simple stages and owners.                                                                          |
| Business workflows and integrations | Exploring            | Saved views, basic reporting, import/export, webhooks and integrations with tools businesses already use.                                                                                             |

## Next: easier to start, safer to run

- **Signed installers**, so Windows and macOS stop warning on the first install.
- **Connect an AI assistant in one step:** approve the connection in EzyChat instead of copying a
  token, with the same permission choices (read only, or also send).
- **WhatsApp usernames:** as WhatsApp introduces usernames, customers may write without showing a
  phone number. The inbox, customer profiles and search will keep working for these chats.
- **Lighter on your computer:** less memory use while the window is closed and the app runs in the
  tray.
- **Protect your number:** clear sending limits and warnings, so normal team use stays within what
  WhatsApp expects. EzyChat Lite is built for conversations, not bulk messaging.

## AI agents

Available in preview:

- Sales, FAQ and custom agents, each with its own name, instructions, hand-over rules and business
  context (uploaded TXT/PDF/MD/DOCX files and text you add), with **Try it**, **Edit with AI** and a
  history of setup changes.
- Connect with your own OpenAI or Claude API key, or, experimentally, a ChatGPT sign-in.
- Customer voice messages are transcribed on your computer, so the agent can answer them.
- It answers from your context only, hands complaints, refunds and missing facts to a person, and
  closes a chat only after the customer confirms. Customers never see error messages.

Next:

- **AI actions:** a clear set of things the agent may do in the inbox (add an internal note, tag a
  customer, set a follow-up), each with checks, an audit trail and an admin switch; risky actions
  become "AI drafts, a person approves".
- Reply drafts and conversation summaries that people review before sending.
- Usage controls and a clear view of what leaves the machine. AI providers may charge for usage;
  your own key does not mean free AI.

## Light CRM

- Keep one useful customer profile alongside the conversation history (available).
- Follow-up reminders: "remind me tomorrow" on a chat, and a list of who needs a next action.
- Simple stages and an owner per customer, without turning the inbox into a large CRM.
- Customer import/export and a small set of reports: response times, open chats, who replied.

## Help shape it

Tell us the business workflow you are trying to improve, who uses it, and what is difficult today.
[Request a feature](https://github.com/ossmalaysia/ezychat-lite/issues/new?template=feature_request.yml)
or [contribute](CONTRIBUTING.md). Suggestions are welcome; inclusion here does not promise a
delivery date.
