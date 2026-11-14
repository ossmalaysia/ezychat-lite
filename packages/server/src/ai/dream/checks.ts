import type { AiTryResult, DreamCheck } from '@ezychat/shared';
import type { AppContext } from '../../context.js';
import { ungroundedNumbers } from '../draft-check.js';
import { findLeak } from '../leak-check.js';
import type { PreviewItem } from '../service.js';
import type { TakeoverChat } from './collect.js';
import { contactsIn, type DreamProposal } from './prompts.js';
import { nameMatcher } from '../phrases/check.js';

/**
 * The checks every dream mode change passes before it is saved (design §6): privacy, leak, grounding, then replay
 * previews of the source questions and a regression run on questions the AI answered last night. Nothing is saved.
 */
export interface CheckInput {
  agentId: number;
  proposal: DreamProposal;
  /** The target's text when the change was made ('' for a new item). */
  before: string;
  sources: readonly TakeoverChat[];
  /** The team replies the change came from (numbers must come from here). */
  teamText: string;
  /** Customer questions the AI answered last night without a hand-off. */
  regression: readonly string[];
  /** Customer names of the inbox. */
  names: readonly string[];
  /** Previews left this night; each preview takes one. */
  budget: { previews: number };
}

export interface CheckResult {
  ok: boolean;
  checks: DreamCheck[];
}

class OutOfPreviews extends Error {}

/** Lines of `after` that `before` does not have: only new text is checked. */
const addedText = (before: string, after: string) => {
  const old = new Set(before.split('\n').map((l) => l.trim()));
  return after
    .split('\n')
    .filter((l) => l.trim() && !old.has(l.trim()))
    .join('\n');
};

const holdsName = (text: string, names: readonly string[]) =>
  names.some((n) => {
    const re = nameMatcher(n);
    return !!re && re.test(text);
  });

/** The question each source chat asked before the team stepped in. */
const sourceQuestions = (sources: readonly TakeoverChat[]) =>
  sources.flatMap((chat) => {
    const firstTeam = chat.messages.findIndex((m) => m.role === 'team');
    const question = chat.messages
      .slice(0, firstTeam < 0 ? chat.messages.length : firstTeam)
      .reverse()
      .find((m) => m.role === 'customer');
    return question ? [question.text] : [];
  });

export async function checkChange(
  ctx: AppContext,
  input: CheckInput,
  signal: AbortSignal,
): Promise<CheckResult> {
  const ai = ctx.services.ai!;
  const { proposal } = input;
  const added = addedText(input.before, proposal.after);
  const status = ai.agentStatus(input.agentId);
  const internal = status.documents
    .filter((d) => d.internal && d.kind === 'text')
    .flatMap((d) => {
      const doc = ai.document(input.agentId, d.id);
      return doc.kind === 'text' ? [doc.text] : [];
    });

  // The summary and a new item's name are stored and shown too: they get the same privacy and leak checks.
  const checked = [
    added,
    proposal.summary,
    proposal.itemId === null ? (proposal.name ?? '') : '',
  ].join('\n');
  const checks: DreamCheck[] = [
    // An edited line keeps what the old text already had: only new contact details and names fail.
    {
      name: 'privacy',
      ok:
        !contactsIn(checked).some((c) => !input.before.includes(c)) &&
        !holdsName(
          checked,
          input.names.filter((n) => !holdsName(input.before, [n])),
        ),
    },
    { name: 'leak', ok: !findLeak(checked, internal) },
    // A number is grounded in the team's reply or in the old text (an edited line keeps its prices).
    {
      name: 'grounding',
      ok: ungroundedNumbers(added, `${input.teamText}\n${input.before}`).length === 0,
    },
  ];
  if (checks.some((c) => !c.ok)) return { ok: false, checks };

  const itemName =
    proposal.itemId === null
      ? (proposal.name ?? 'Dream mode')
      : (status.documents.find((d) => d.id === proposal.itemId)?.name ?? '');
  const override =
    proposal.target === 'instructions'
      ? { instructions: proposal.after }
      : proposal.target === 'handoff_rules'
        ? { handoffRules: proposal.after }
        : {
            items: [{ id: proposal.itemId, name: itemName, text: proposal.after }] as PreviewItem[],
          };
  let leaked = false;
  const preview = async (question: string): Promise<AiTryResult> => {
    if (input.budget.previews <= 0) throw new OutOfPreviews();
    input.budget.previews--;
    signal.throwIfAborted();
    const result = await ai.previewWithSetup(input.agentId, override, question);
    if (!result.ok) throw new Error('preview failed');
    if (result.reply && findLeak(result.reply, internal)) leaked = true;
    return result;
  };

  const handoff = proposal.target === 'handoff_rules';
  try {
    const replays = [];
    for (const q of sourceQuestions(input.sources)) replays.push(await preview(q));
    const replayOk = handoff
      ? replays.some((r) => r.action === 'handoff')
      : replays.some((r) => r.action !== null && r.action !== 'handoff');
    checks.push({ name: 'replay', ok: replayOk && !leaked });
    let regressionOk = true;
    for (const q of input.regression)
      if ((await preview(q)).action === 'handoff') regressionOk = false;
    checks.push({ name: 'regression', ok: regressionOk && !leaked });
  } catch (error) {
    if (signal.aborted) throw error;
    // A preview that could not run (no previews left, a failed model or look-up) fails the change.
    const detail = error instanceof OutOfPreviews ? 'no previews left tonight' : 'could not check';
    if (!checks.some((c) => c.name === 'replay'))
      checks.push({ name: 'replay', ok: false, detail });
    else checks.push({ name: 'regression', ok: false, detail });
  }
  return { ok: checks.every((c) => c.ok), checks };
}
