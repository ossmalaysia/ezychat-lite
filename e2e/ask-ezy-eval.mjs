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
const ROOM = (status.agents?.length ?? 0) < (status.maxAgents ?? 1);
console.log(
  `agents ${status.agents?.length ?? '?'} of ${status.maxAgents ?? '?'}: a new agent is ${ROOM ? 'possible' : 'not possible'}\n`,
);

/** One Ask Ezy turn through the real route. */
async function turn(question, history) {
  const started = Date.now();
  const res = await fetch(BASE + '/api/ask-ezy', {
    method: 'POST',
    headers: { ...api.headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ question, history }),
  });
  const events = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const last = events.at(-1);
  const answer = last?.type === 'answer' ? last.answer : null;
  return { answer, error: last?.type === 'error' ? last.code : null, ms: Date.now() - started };
}
const blocksOf = (a, type) => (a?.blocks ?? []).filter((b) => b.type === type);

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
    mustAskChat: true,
  },
  existing: {
    open: 'Every Monday at 10am, remind Aisyah Rahman to send the weekly order list',
    answers: [[/kopi|sales|existing|use/i], [/aisyah|…7733/i]],
    expect: { newAgent: false, chatEnding: '7733', time: '10:00', dayRule: 'custom', days: [1] },
    mustAsk: false, // one Aisyah, time and day given: proposing at once is right
  },
  ambiguous: {
    open: 'Send Jee Fong a good morning message on weekdays at 8:30 with a new agent',
    answers: [[/new agent|create/i], [/jee fong lim|…5521/i]],
    expect: { newAgent: true, chatEnding: '5521', time: '08:30', dayRule: 'weekdays' },
    mustAsk: true,
    mustAskChat: true,
  },
};

async function runScenario(name, s) {
  const history = [];
  const log = [];
  const record = (question, r) => {
    history.push({ role: 'user', text: question });
    if (r.answer) history.push({ role: 'assistant', text: r.answer.text });
    log.push({
      question,
      ms: r.ms,
      error: r.error,
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
  for (let i = 0; i < 4; i++) {
    const qs = blocksOf(r.answer, 'question');
    if (qs.length === 0) break;
    if (qs.length > 1) oneQuestionEach = false;
    const q = qs[0];
    if (COMPOUND.test(q.text)) oneQuestionEach = false;
    if (/which|chat|jee fong/i.test(q.text) && q.choices.some((c) => /…\d{4}/.test(c)))
      askedChat = true;
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
  return {
    scenario: name,
    checks,
    score: Object.values(checks).filter(Boolean).length,
    of: Object.keys(checks).length,
    turns: log,
  };
}

const results = [];
for (const [name, s] of Object.entries(SCENARIOS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (let run = 1; run <= RUNS; run++) {
    const result = await runScenario(name, s);
    results.push({ run, ...result });
    const failed = Object.entries(result.checks)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    console.log(
      `${name.padEnd(10)} run ${run}: ${result.score}/${result.of}${failed.length ? '  ✗ ' + failed.join(', ') : '  all checks pass'}`,
    );
  }
}
const total = results.reduce((n, r) => n + r.score, 0);
const max = results.reduce((n, r) => n + r.of, 0);
console.log(
  `\nTOTAL ${total}/${max} (${Math.round((100 * total) / Math.max(1, max))} %) over ${results.length} conversations`,
);
const byCheck = {};
for (const r of results)
  for (const [k, ok] of Object.entries(r.checks)) byCheck[k] = (byCheck[k] ?? 0) + (ok ? 1 : 0);
for (const [k, n] of Object.entries(byCheck))
  console.log(`  ${k.padEnd(24)} ${n}/${results.length}`);
if (OUT)
  writeFileSync(
    OUT,
    JSON.stringify({ at: new Date().toISOString(), port: PORT, results }, null, 2),
  );
