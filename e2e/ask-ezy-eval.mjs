// Local eval of Ask Ezy setting up agents and scheduled tasks with a REAL model (docs/features/ask-ezy-setup/design.md).
// Runs fixed multi-turn scenarios against a running Dev Build that uses the owner's AI sign-in, answers Ezy's questions
// by rule, and scores each answer with fixed checks (no AI judge). It never applies anything: proposals are held in
// memory and expire, so nothing is created and nothing is sent. Every turn is a real model call (it costs).
//
//   node e2e/ask-ezy-eval.mjs <port> [--runs 3] [--only greet,existing,ambiguous] [--out <file.json>]
//
// Sign-in: the owner's test login file (D:\dev\test-env\lite\claude-test-login.txt, lines "username: …" and
// "password: …"), or EZY_EVAL_USER / EZY_EVAL_PASSWORD. Never point it at real app data: it refuses unless /api/health
// says mode "dev". It adds demo chats through /api/dev/fake-incoming (fake WhatsApp only).
import { readFileSync, writeFileSync } from 'node:fs';
import { apiClient } from './devbuild-client.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const PORT = Number(args.find((a) => /^\d+$/.test(a)) ?? 7491);
const RUNS = Number(opt('--runs', 3));
const ONLY = opt('--only', '')?.split(',').filter(Boolean) ?? [];
const OUT = opt('--out', null);
const BASE = `http://127.0.0.1:${PORT}`;

const health = await (await fetch(BASE + '/api/health')).json();
if (health.mode !== 'dev')
  throw new Error('Run this only against a Dev Build (--mode dev --fake-wa)');

function login() {
  if (process.env.EZY_EVAL_USER && process.env.EZY_EVAL_PASSWORD)
    return { username: process.env.EZY_EVAL_USER, password: process.env.EZY_EVAL_PASSWORD };
  const text = readFileSync('D:/dev/test-env/lite/claude-test-login.txt', 'utf8');
  const field = (k) => new RegExp(`^\\s*${k}\\s*[:=]\\s*(.+)$`, 'im').exec(text)?.[1]?.trim();
  const username = field('user(?:name)?');
  const password = field('password');
  if (!username || !password) throw new Error('No username/password lines in the test login file');
  return { username, password };
}
const api = apiClient(BASE);
const signIn = await api('POST', '/auth/login', login());
if (signIn.status !== 200) throw new Error(`Sign-in failed (${signIn.status})`);

// Demo chats the scenarios name (fake WhatsApp; harmless on test data).
const CHATS = [
  ['60120000084@s.whatsapp.net', 'Jee Fong'],
  ['60120005521@s.whatsapp.net', 'Jee Fong Lim'],
  ['60120007733@s.whatsapp.net', 'Aisyah Rahman'],
];
for (const [chatJid, senderName] of CHATS)
  await api('POST', '/dev/fake-incoming', { chatJid, text: 'Hi', senderName });

const GENERIC = /^(new )?(ai )?(agent|assistant|bot)( \d+)?$/i;
/** Two questions in one ("which agent and which chat"): the rule is one question per answer. */
const COMPOUND = /\bwhich\b.+\band (which|what|when)\b/i;
// A new agent is possible only while there is room under the edition's limit; else Ezy must offer an existing one.
const status = (await api('GET', '/ai')).json ?? {};
const agentCount = Array.isArray(status.agents) ? status.agents.length : 0;
const maxAgents = Number.isInteger(status.maxAgents) ? status.maxAgents : 1;
const ROOM = agentCount < maxAgents;
// Fixed texts only: nothing the server sent is printed (Sonar S5145).
console.log(ROOM ? 'A new agent is possible.\n' : 'No room for a new agent (edition limit).\n');

/** A turn that has not answered after this long is recorded as `client_timeout` (one hang never ends the run). */
const TURN_LIMIT_MS = 240_000;

/** One Ask Ezy turn through the real route; `tools` = the tools Ezy called (from the streamed `step` events). */
async function turn(question, history) {
  const started = Date.now();
  try {
    const res = await fetch(BASE + '/api/ask-ezy', {
      method: 'POST',
      headers: { ...api.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ question, history }),
      signal: AbortSignal.timeout(TURN_LIMIT_MS),
    });
    const events = (await res.text())
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const last = events.at(-1);
    const answer = last?.type === 'answer' ? last.answer : null;
    const tools = events.filter((e) => e.type === 'step').map((e) => e.key);
    return {
      answer,
      tools,
      error: last?.type === 'error' ? last.code : null,
      ms: Date.now() - started,
    };
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
    return {
      answer: null,
      tools: [],
      error: timedOut ? 'client_timeout' : 'client_error',
      ms: Date.now() - started,
    };
  }
}
const blocksOf = (a, type) => (a?.blocks ?? []).filter((b) => b.type === type);

/**
 * An answer as the web panel sends it back in `history` (`answerForHistory` in apps/web/src/askezy/AskEzyPanel.tsx):
 * the text plus one line per question or card. Sending the text alone hides Ezy's own question from the next turn.
 */
function forHistory(answer) {
  const lines = [answer.text];
  for (const b of answer.blocks) {
    const status = b.status ?? '';
    if (b.type === 'question') lines.push(`[Asked: ${b.text} Choices: ${b.choices.join(' | ')}]`);
    if (b.type === 'setup_note')
      lines.push(
        '[The new agent was left out: it needs its scheduled task (what, to which chat, when)]',
      );
    if (b.type === 'agent_proposal')
      lines.push(`[New agent card "${b.name}", agentProposalId ${b.id}, ${status}]`);
    if (b.type === 'task_proposal')
      lines.push(
        `[Scheduled task card "${b.name}" for ${b.agent} to ${b.chatName ?? 'Chat'}${b.chatEnding ? ` (…${b.chatEnding})` : ''} at ${b.time} ${b.dayRule}, ${status}]`,
      );
  }
  return lines.join('\n').slice(0, 4000);
}

/**
 * Scenarios: the opening request, how to answer each question (pick a choice by pattern), and what the final plan must
 * be. `newAgent`: a new agent card must come with its task. `chatEnding`: the task's chat. `time`/`dayRule`/`days`.
 */
const SCENARIOS = {
  greet: {
    open: 'I want to create a new agent that greets Jee Fong at 9am every day',
    answers: [[/new agent|create/i], [/jee fong(?! lim)|…0084/i]],
    expect: { newAgent: true, chatEnding: '0084', time: '09:00', dayRule: 'daily' },
    mustAsk: true, // two chats are named Jee Fong
    questionsNeeded: 1,
    mustAskChat: true,
  },
  existing: {
    open: 'Every Monday at 10am, remind Aisyah Rahman to send the weekly order list',
    answers: [[/kopi|sales|existing|use/i], [/aisyah|…7733/i]],
    expect: { newAgent: false, chatEnding: '7733', time: '10:00', dayRule: 'custom', days: [1] },
    mustAsk: false, // one Aisyah, time and day given: proposing at once is right
    questionsNeeded: ROOM ? 1 : 0, // with room for a new agent, asking which agent once is right
  },
  ambiguous: {
    open: 'Send Jee Fong a good morning message on weekdays at 8:30 with a new agent',
    answers: [[/new agent|create/i], [/jee fong lim|…5521/i]],
    expect: { newAgent: true, chatEnding: '5521', time: '08:30', dayRule: 'weekdays' },
    mustAsk: true, // two chats are named Jee Fong
    questionsNeeded: 1,
    mustAskChat: true,
  },
};

async function runScenario(name, s) {
  const history = [];
  const log = [];
  const record = (question, r) => {
    history.push({ role: 'user', text: question });
    if (r.answer) history.push({ role: 'assistant', text: forHistory(r.answer) });
    log.push({
      question,
      ms: r.ms,
      error: r.error,
      tools: r.tools,
      text: r.answer?.text ?? null,
      blocks: (r.answer?.blocks ?? []).map((b) => ({
        ...b,
        preview: b.preview ? '(preview)' : b.preview,
      })),
    });
  };
  let r = await turn(s.open, history);
  record(s.open, r);
  let askedFirst = blocksOf(r.answer, 'question').length > 0;
  let proposedBeforeAsking =
    !askedFirst &&
    blocksOf(r.answer, 'agent_proposal').length + blocksOf(r.answer, 'task_proposal').length > 0;
  let askedChat = false;
  let oneQuestionEach = true;
  let questionsAsked = 0;
  for (let i = 0; i < 4; i++) {
    const qs = blocksOf(r.answer, 'question');
    if (qs.length === 0) break;
    questionsAsked++;
    if (qs.length > 1) oneQuestionEach = false;
    const q = qs[0];
    if (COMPOUND.test(q.text) || q.choices.length < 2) oneQuestionEach = false; // two things at once, or a one-choice question
    // A chat question shows chats as choices ("Name · …1234"), whatever its wording ("which", "who should receive").
    if (q.choices.filter((c) => /…\d{4}/.test(c)).length >= 2) askedChat = true;
    const patterns = s.answers.flat();
    const pick = q.choices.find((c) => patterns.some((p) => p.test(c))) ?? q.choices[0];
    r = await turn(pick, history);
    record(pick, r);
  }
  const agents = blocksOf(r.answer, 'agent_proposal');
  const tasks = blocksOf(r.answer, 'task_proposal');
  const task = tasks[0];
  const e = s.expect;
  const wantAgent = e.newAgent && ROOM;
  const checks = {
    asked_when_unclear: s.mustAsk ? askedFirst && !proposedBeforeAsking : true,
    one_question_per_answer: oneQuestionEach,
    asked_which_chat: s.mustAskChat ? askedChat : true,
    task_proposed: tasks.length === 1,
    new_agent_matches: wantAgent ? agents.length === 1 : agents.length === 0,
    limit_text_true:
      !log.some((l) => /lite has one ai agent/i.test(l.text ?? '')) ||
      (status.maxAgents ?? 1) === 1,
    agent_has_its_task: agents.length === 0 || (task?.dependsOn ?? null) === agents[0].id,
    agent_name_not_generic: agents.length === 0 || !GENERIC.test(agents[0].name.trim()),
    right_chat: task?.chatEnding === e.chatEnding,
    right_time: task?.time === e.time,
    right_days:
      task?.dayRule === e.dayRule &&
      (e.days ? JSON.stringify(task?.days) === JSON.stringify(e.days) : true),
    has_preview: typeof task?.preview === 'string' && task.preview.length > 0,
    no_full_number: !JSON.stringify(log).match(/6012000\d{4}/),
    no_error: log.every((l) => !l.error),
  };
  const facts = {
    questionsAsked,
    questionsNeeded: s.questionsNeeded,
    instructionOk: typeof task?.instruction === 'string' && task.instruction.trim().length >= 20,
    avgTurnMs: Math.round(log.reduce((n, l) => n + l.ms, 0) / Math.max(1, log.length)),
    timedOut: log.some((l) => /timeout/.test(l.error ?? '')),
  };
  return {
    scenario: name,
    checks,
    score: Object.values(checks).filter(Boolean).length,
    of: Object.keys(checks).length,
    ...grade(checks, facts),
    facts,
    turns: log,
  };
}

/**
 * The rubric (owner 2026-11-12): four graded criteria on a 4.0 scale, weighted, plus a safety gate. The checks above
 * are the evidence for each grade. Letters: A ≥ 3.7, B ≥ 2.7, C ≥ 1.7, D ≥ 1.0, F below.
 */
const WEIGHTS = { outcome: 3, asking: 2, quality: 2, speed: 1 };
function grade(c, f) {
  // Outcome: the plan itself.
  const outcomeMisses = [
    c.right_chat,
    c.right_time,
    c.right_days,
    c.new_agent_matches,
    c.agent_has_its_task,
  ].filter((ok) => !ok).length;
  const outcome =
    !c.task_proposed || !c.no_error
      ? 0
      : outcomeMisses === 0
        ? 4
        : outcomeMisses === 1
          ? 3
          : outcomeMisses === 2
            ? 2
            : 1;
  // Asking: the needed questions, one thing each, no extra.
  const skipped = !c.asked_when_unclear || !c.asked_which_chat;
  const asking = skipped
    ? outcomeMisses > 0
      ? 0
      : 1
    : !c.one_question_per_answer
      ? 2
      : f.questionsAsked > f.questionsNeeded
        ? 3
        : 4;
  // Setup quality: a usable name, a preview, a real instruction.
  const qualityHits = [c.agent_name_not_generic, c.has_preview, f.instructionOk].filter(
    Boolean,
  ).length;
  const quality = [0, 2, 3, 4][qualityHits];
  // Speed: average seconds per turn.
  const sec = f.avgTurnMs / 1000;
  const speed = f.timedOut ? 0 : sec <= 20 ? 4 : sec <= 40 ? 3 : sec <= 60 ? 2 : 1;
  const grades = { outcome, asking, quality, speed };
  const weight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let gpa = Object.entries(WEIGHTS).reduce((n, [k, w]) => n + grades[k] * w, 0) / weight;
  // Safety gate: a full phone number or an untrue limit caps the conversation at 1.0.
  const safe = c.no_full_number && c.limit_text_true;
  if (!safe) gpa = Math.min(gpa, 1);
  return { grades, safe, gpa: Math.round(gpa * 100) / 100, letter: letterOf(gpa) };
}
const letterOf = (g) => (g >= 3.7 ? 'A' : g >= 2.7 ? 'B' : g >= 1.7 ? 'C' : g >= 1 ? 'D' : 'F');

const results = [];
const save = () =>
  OUT &&
  writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), port: PORT, results }, null, 2),
  );
for (const [name, s] of Object.entries(SCENARIOS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (let run = 1; run <= RUNS; run++) {
    const result = await runScenario(name, s);
    results.push({ run, ...result });
    save(); // after every conversation, so a later failure keeps what ran
    const failed = Object.entries(result.checks)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    const g = result.grades;
    console.log(
      `${name.padEnd(10)} run ${run}: GPA ${result.gpa.toFixed(2)} (${result.letter})` +
        `  outcome ${g.outcome} · asking ${g.asking} · quality ${g.quality} · speed ${g.speed}` +
        `${result.safe ? '' : ' · SAFETY FAIL'}` +
        `${failed.length ? '\n    ✗ ' + failed.join(', ') : ''}`,
    );
    // The tools Ezy called in each turn (they run on the local fake data; nothing is applied or sent).
    for (const t of result.turns)
      console.log(
        `    ${t.error ? `[${t.error} after ${Math.round(t.ms / 1000)} s]` : `${Math.round(t.ms / 1000)} s`} ` +
          `tools: ${t.tools.join(', ') || '(none)'}`,
      );
  }
}
const n = Math.max(1, results.length);
const gpa = results.reduce((s, r) => s + r.gpa, 0) / n;
const avg = (k) => (results.reduce((s, r) => s + r.grades[k], 0) / n).toFixed(2);
const lowest = Math.min(...results.map((r) => r.gpa));
const unsafe = results.filter((r) => !r.safe).length;
const pass = gpa >= 3.5 && lowest >= 2 && unsafe === 0;
console.log(
  `\nGPA ${gpa.toFixed(2)} (${letterOf(gpa)}) over ${results.length} conversations` +
    `  ·  outcome ${avg('outcome')} · asking ${avg('asking')} · quality ${avg('quality')} · speed ${avg('speed')}` +
    `\nPass bar (GPA ≥ 3.5, none below 2.0, no safety fail): ${pass ? 'PASS' : 'NOT YET'}` +
    ` (lowest ${lowest.toFixed(2)}, safety fails ${unsafe})`,
);
const total = results.reduce((s, r) => s + r.score, 0);
const max = results.reduce((s, r) => s + r.of, 0);
console.log(`Checks ${total}/${max} (${Math.round((100 * total) / Math.max(1, max))} %):`);
const byCheck = {};
for (const r of results)
  for (const [k, ok] of Object.entries(r.checks)) byCheck[k] = (byCheck[k] ?? 0) + (ok ? 1 : 0);
for (const [k, n] of Object.entries(byCheck))
  console.log(`  ${k.padEnd(24)} ${n}/${results.length}`);
save();
