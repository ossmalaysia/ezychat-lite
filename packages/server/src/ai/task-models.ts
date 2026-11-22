import {
  AI_TASK_DEFAULTS,
  AI_TASK_GROUPS,
  AiConnectionMode,
  AiTaskModel,
  type AiTaskModelsSetting,
  AiTaskChoice,
  aiModelHasThinking,
  aiModelTier,
  defaultTaskThinking,
  type AiTaskGroup,
  type AiTaskModelsBody,
  type AiTaskModelsStatus,
  type AiThinking,
} from '@ezychat/shared';
import { audit } from '../db/audit.js';
import type { DB } from '../db/index.js';
import type { SettingsStore } from '../db/settings.js';
import { HttpError } from '../http/errors.js';
import { aiProviderSettings } from './settings-keys.js';

/**
 * AI models per task (docs/ai-models.md). The setting `ai_task_models` holds, per connection mode, the rows an
 * admin changed; this module resolves a row into the model and reasoning level a call uses. No model call here.
 */
export const TASK_MODELS_KEY = 'ai_task_models';
/** The old "Model for suggestions" (`fast`, `agent` or a model id): read once by `migrateTaskModels`. */
export const LEGACY_SUGGEST_MODEL_KEY = 'ai_reply_suggestions_model';

/** What the current connection offers: its main and fast model and every model it lists. */
export interface TaskConnection {
  mode: AiConnectionMode;
  mainModel: string;
  fastModel: string;
  models: readonly string[];
  /** False while the list may miss models (ChatGPT before its live list is read): a saved id is then kept. */
  listComplete?: boolean;
}

/** A row resolved for one call. */
export interface ResolvedTask {
  group: AiTaskGroup;
  /** The saved choice, or the row's default. */
  choice: AiTaskChoice;
  /** The saved level, null = the default. */
  savedThinking: AiThinking | null;
  /** The model id the call uses (after the fallback). */
  model: string;
  /** The level that runs, null = the model has none (for the screen and the logs). */
  thinking: AiThinking | null;
  /** The reasoning effort to send; undefined = send nothing (the model's own). */
  reasoningEffort: AiThinking | undefined;
  /** A saved model the connection no longer lists. */
  unavailable: string | null;
  isDefault: boolean;
}

/** The saved rows; an unreadable row (or mode) is skipped on its own, so the others keep their choices. */
export function readTaskModels(settings: SettingsStore): AiTaskModelsSetting {
  const raw = settings.get<unknown>(TASK_MODELS_KEY, {});
  const out: AiTaskModelsSetting = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const mode of AiConnectionMode.options) {
    const rows = (raw as Record<string, unknown>)[mode];
    if (!rows || typeof rows !== 'object') continue;
    const kept: Partial<Record<AiTaskGroup, AiTaskModel>> = {};
    for (const group of AI_TASK_GROUPS) {
      const row = AiTaskModel.safeParse((rows as Record<string, unknown>)[group]);
      if (row.success) kept[group] = row.data;
    }
    out[mode] = kept;
  }
  return out;
}

/** Resolves one row: an unlisted saved model falls back to Main (agent replies) or Fast at the default level. */
export function resolveTask(
  group: AiTaskGroup,
  saved: AiTaskModel | undefined,
  conn: TaskConnection,
): ResolvedTask {
  const choice: AiTaskChoice = saved?.choice ?? AI_TASK_DEFAULTS[group];
  const listed =
    choice === 'fast' ||
    choice === 'main' ||
    conn.models.includes(choice) ||
    conn.listComplete === false;
  const runs: AiTaskChoice = listed ? choice : AI_TASK_DEFAULTS[group];
  const model = runs === 'fast' ? conn.fastModel : runs === 'main' ? conn.mainModel : runs;
  const fallbackLevel = defaultTaskThinking(group, runs, conn.mode);
  const chosenLevel = listed && saved?.thinking ? saved.thinking : null;
  const hasLevel = aiModelHasThinking(conn.mode, model);
  return {
    group,
    choice,
    savedThinking: saved?.thinking ?? null,
    model,
    thinking: hasLevel ? (chosenLevel ?? fallbackLevel) : null,
    // Balanced as a default keeps the model's own level (nothing sent), exactly as before the feature.
    reasoningEffort: !hasLevel
      ? undefined
      : (chosenLevel ?? (fallbackLevel === 'medium' ? undefined : fallbackLevel)),
    unavailable: listed ? null : choice,
    isDefault: !saved,
  };
}

/** The screen's view of the current connection's rows. */
export function taskModelsStatus(
  saved: AiTaskModelsSetting,
  conn: TaskConnection,
): AiTaskModelsStatus {
  const rows = saved[conn.mode] ?? {};
  const tasks = Object.fromEntries(
    AI_TASK_GROUPS.map((group) => {
      const r = resolveTask(group, rows[group], conn);
      return [
        group,
        {
          choice: r.choice,
          thinking: r.savedThinking,
          model: r.model,
          effectiveThinking: r.thinking,
          unavailable: r.unavailable,
          isDefault: r.isDefault,
        },
      ];
    }),
  ) as AiTaskModelsStatus['tasks'];
  const defaults = Object.fromEntries(
    AI_TASK_GROUPS.map((group) => [group, { choice: AI_TASK_DEFAULTS[group] }]),
  ) as AiTaskModelsStatus['defaults'];
  return {
    mode: conn.mode,
    mainModel: conn.mainModel,
    fastModel: conn.fastModel,
    models: [...new Set(conn.models)].map((id) => ({
      id,
      thinking: aiModelHasThinking(conn.mode, id),
      tier: aiModelTier(conn.mode, id),
    })),
    tasks,
    defaults,
  };
}

/**
 * Saves the changed rows of the current connection (another connection's choices stay). Every row is checked
 * before anything is saved; each real change is audited with its before/after choice and level only.
 */
export function saveTaskModels(
  db: DB,
  settings: SettingsStore,
  body: AiTaskModelsBody,
  conn: TaskConnection,
  actor: { userId: number | null; ip: string | null },
): void {
  const entries = Object.entries(body.tasks) as [AiTaskGroup, AiTaskModel | null | undefined][];
  for (const [, value] of entries) {
    if (!value) continue;
    const { choice } = value;
    if (choice !== 'fast' && choice !== 'main' && !conn.models.includes(choice)) {
      // The account's list could not be read: never store a name nobody could check.
      if (conn.listComplete === false)
        throw new HttpError(
          503,
          'model_list_unavailable',
          'The model list cannot be read now. Try again in a minute.',
        );
      throw new HttpError(400, 'model_not_listed', 'Choose a model this AI connection offers.');
    }
    const model = choice === 'fast' ? conn.fastModel : choice === 'main' ? conn.mainModel : choice;
    if (value.thinking && !aiModelHasThinking(conn.mode, model))
      throw new HttpError(
        400,
        'thinking_not_supported',
        'This model has no speed and quality level.',
      );
  }
  const all = readTaskModels(settings);
  const rows = { ...(all[conn.mode] ?? {}) };
  for (const [group, value] of entries) {
    if (value === undefined) continue;
    const before = rows[group];
    if (value === null) delete rows[group];
    else
      rows[group] = {
        choice: value.choice,
        ...(value.thinking ? { thinking: value.thinking } : {}),
      };
    const after = rows[group];
    if (before?.choice === after?.choice && before?.thinking === after?.thinking) continue;
    audit(db, {
      userId: actor.userId,
      action: 'settings.ai_task_model',
      ip: actor.ip,
      meta: {
        mode: conn.mode,
        task: group,
        before: { choice: before?.choice ?? null, thinking: before?.thinking ?? null },
        after: { choice: after?.choice ?? null, thinking: after?.thinking ?? null },
      },
    });
  }
  settings.set(TASK_MODELS_KEY, { ...all, [conn.mode]: rows });
}

/**
 * Permanent start-up step (the updater may jump many versions): while `ai_task_models` is missing, the old
 * "Model for suggestions" becomes the Writing help row of the connection saved now (`agent` → Main model, a
 * model id the connection lists → that model; `fast`, nothing or an unlisted id → the default). Translate, the
 * phrase list and Dream lessons start on Fast. The old key stays (a downgrade still reads it).
 */
export function migrateTaskModels(settings: SettingsStore, listed: readonly string[]): void {
  if (settings.get<unknown>(TASK_MODELS_KEY, null) !== null) return;
  const old = settings.get<unknown>(LEGACY_SUGGEST_MODEL_KEY, null);
  // "Same as the AI agent" meant every connection's main model; a model id belongs to the connection saved now.
  if (old === 'agent') {
    const writing = { writing: { choice: 'main' as const } };
    settings.set(TASK_MODELS_KEY, { api: writing, chatgpt: writing, claude: writing });
    return;
  }
  const id = AiTaskChoice.safeParse(old);
  const mode = aiProviderSettings(settings).mode;
  settings.set(
    TASK_MODELS_KEY,
    // Only a model the connection saved now lists: an id of an earlier connection would only ever fall back.
    id.success && id.data !== 'fast' && id.data !== 'main' && listed.includes(id.data)
      ? { [mode]: { writing: { choice: id.data } } }
      : {},
  );
}
