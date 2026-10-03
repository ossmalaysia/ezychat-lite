# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository.

- **Read [CLAUDE.md](CLAUDE.md)** — commands, architecture, security invariants and UI rules. It applies to every agent.
- **Read [docs/LEARNINGS.md](docs/LEARNINGS.md) before starting**, and **append to it before finishing** any run
  that changed code: what went wrong or was slow, the root cause, and the rule that prevents it. If a lesson
  changes how agents must work here, update the rule in CLAUDE.md too.
  (Claude Code enforces this with a Stop hook in `.claude/settings.json`.)
