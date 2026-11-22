import { describe, expect, it } from 'vitest';
import { aiModelHasThinking, aiModelTier, defaultTaskThinking } from '@ezychat/shared';
import type { SettingsStore } from '../db/settings.js';
import {
  migrateTaskModels,
  readTaskModels,
  resolveTask,
  taskModelsStatus,
  type TaskConnection,
} from './task-models.js';

const CHATGPT: TaskConnection = {
  mode: 'chatgpt',
  mainModel: 'gpt-6.1-sol',
  fastModel: 'gpt-6-luna',
  models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-terra'],
};
const API: TaskConnection = {
  mode: 'api',
  mainModel: 'gpt-4.1',
  fastModel: 'gpt-4.1-mini',
  models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5.5'],
};
const CLAUDE: TaskConnection = {
  mode: 'claude',
  mainModel: 'claude-sonnet-5-5',
  fastModel: 'claude-haiku-5-5',
  models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
};

/** A settings store kept in memory (only get/set are used here). */
function store(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: <T>(key: string, fallback: T): T => (values.has(key) ? (values.get(key) as T) : fallback),
    set: (key: string, value: unknown) => void values.set(key, value),
    getSecret: () => null,
  } as unknown as SettingsStore & { values: Map<string, unknown> };
}

describe('resolveTask', () => {
  it('keeps the behaviour before the feature for every default row', () => {
    expect(resolveTask('agentReplies', undefined, CHATGPT)).toEqual({
      group: 'agentReplies',
      choice: 'main',
      savedThinking: null,
      model: 'gpt-6.1-sol',
      thinking: 'medium',
      // Balanced as a default: the model's own level, nothing sent.
      reasoningEffort: undefined,
      unavailable: null,
      isDefault: true,
    });
    for (const group of ['askEzy', 'translate', 'writing', 'background'] as const)
      expect(resolveTask(group, undefined, CHATGPT)).toMatchObject({
        choice: 'fast',
        model: 'gpt-6-luna',
        thinking: 'low',
        reasoningEffort: 'low',
        isDefault: true,
      });
  });

  it('runs a listed model at the saved level, and AI agent replies on Fast at Faster', () => {
    expect(
      resolveTask('translate', { choice: 'gpt-6.1-sol', thinking: 'high' }, CHATGPT),
    ).toMatchObject({ model: 'gpt-6.1-sol', thinking: 'high', reasoningEffort: 'high' });
    expect(resolveTask('agentReplies', { choice: 'fast' }, CHATGPT)).toMatchObject({
      model: 'gpt-6-luna',
      thinking: 'low',
      reasoningEffort: 'low',
      isDefault: false,
    });
    // Balanced chosen on purpose is sent.
    expect(
      resolveTask('agentReplies', { choice: 'main', thinking: 'medium' }, CHATGPT),
    ).toMatchObject({ reasoningEffort: 'medium' });
  });

  it('falls back to Main (agent replies) or Fast at the default level when a saved model is gone', () => {
    expect(
      resolveTask('agentReplies', { choice: 'gpt-5.6-sol', thinking: 'high' }, CHATGPT),
    ).toMatchObject({
      choice: 'gpt-5.6-sol',
      savedThinking: 'high',
      model: 'gpt-6.1-sol',
      reasoningEffort: undefined,
      unavailable: 'gpt-5.6-sol',
    });
    expect(
      resolveTask('writing', { choice: 'gpt-5.6-sol', thinking: 'high' }, CHATGPT),
    ).toMatchObject({ model: 'gpt-6-luna', thinking: 'low', reasoningEffort: 'low' });
  });

  it('on an OpenAI key sends a level only when the admin chose one (Balanced by default)', () => {
    expect(resolveTask('writing', { choice: 'gpt-5.5' }, API)).toMatchObject({
      thinking: 'medium',
      reasoningEffort: undefined,
    });
    expect(aiModelHasThinking('api', 'gpt-5-chat-latest')).toBe(false);
    expect(aiModelHasThinking('api', 'o1-mini')).toBe(false);
  });

  it('sends a level only to models that have one', () => {
    expect(resolveTask('writing', { choice: 'main', thinking: 'high' }, API)).toMatchObject({
      model: 'gpt-4.1',
      thinking: null,
      reasoningEffort: undefined,
    });
    expect(resolveTask('writing', { choice: 'gpt-5.5', thinking: 'high' }, API)).toMatchObject({
      thinking: 'high',
      reasoningEffort: 'high',
    });
    expect(resolveTask('agentReplies', undefined, CLAUDE)).toMatchObject({
      model: 'claude-sonnet-5-5',
      thinking: null,
      reasoningEffort: undefined,
    });
  });
});

describe('taskModelsStatus', () => {
  it('shows the current connection only, with tiers and levels per model', () => {
    const status = taskModelsStatus(
      {
        claude: { translate: { choice: 'claude-opus-5-5' } },
        api: { writing: { choice: 'main' } },
      },
      { ...API, models: [...API.models, 'gpt-4.1'] },
    );
    expect(status.mode).toBe('api');
    expect(status.models).toEqual([
      { id: 'gpt-4.1-mini', thinking: false, tier: 'fast' },
      { id: 'gpt-4.1', thinking: false, tier: 'balanced' },
      { id: 'gpt-5.5', thinking: true, tier: 'smart' },
    ]);
    expect(status.tasks.writing).toMatchObject({ choice: 'main', isDefault: false });
    expect(status.tasks.translate).toMatchObject({ choice: 'fast', isDefault: true });
    expect(status.defaults.agentReplies).toEqual({ choice: 'main' });
  });
});

describe('readTaskModels', () => {
  it('skips only an unreadable row; the others keep their choices', () => {
    expect(
      readTaskModels(
        store({
          ai_task_models: {
            chatgpt: { writing: 'x', translate: { choice: 'main' } },
            api: { writing: { choice: 'ft:gpt-4.1-mini:acme::abc' } },
            claude: 'broken',
            future: { writing: { choice: 'main' } },
          },
        }),
      ),
    ).toEqual({
      chatgpt: { translate: { choice: 'main' } },
      api: { writing: { choice: 'ft:gpt-4.1-mini:acme::abc' } },
    });
    expect(readTaskModels(store())).toEqual({});
    expect(readTaskModels(store({ ai_task_models: 'x' }))).toEqual({});
  });
});

describe('migrateTaskModels', () => {
  const run = (initial: Record<string, unknown>) => {
    const s = store(initial);
    migrateTaskModels(s);
    return s.values.get('ai_task_models');
  };
  it('moves the old Model for suggestions into Writing help of the saved connection', () => {
    const main = { writing: { choice: 'main' } };
    expect(run({ ai_reply_suggestions_model: 'agent' })).toEqual({
      api: main,
      chatgpt: main,
      claude: main,
    });
    expect(
      run({
        ai_reply_suggestions_model: 'claude-opus-5-5',
        ai_inbox_provider: { mode: 'claude', model: '' },
      }),
    ).toEqual({ claude: { writing: { choice: 'claude-opus-5-5' } } });
  });
  it('keeps the defaults for Fast, nothing or an unreadable value', () => {
    expect(run({ ai_reply_suggestions_model: 'fast' })).toEqual({});
    expect(run({})).toEqual({});
    expect(run({ ai_reply_suggestions_model: 'not a model' })).toEqual({});
    expect(run({ ai_reply_suggestions_model: 42 })).toEqual({});
  });
  it('runs once: saved rows are never replaced', () => {
    const saved = { api: { translate: { choice: 'gpt-4.1' } } };
    expect(run({ ai_task_models: saved, ai_reply_suggestions_model: 'agent' })).toBe(saved);
  });
});

describe('shared model facts', () => {
  it('knows which models take a level and their tier', () => {
    expect(aiModelHasThinking('chatgpt', 'anything')).toBe(true);
    expect(aiModelHasThinking('api', 'o4-mini')).toBe(true);
    expect(aiModelHasThinking('api', 'gpt-4.1')).toBe(false);
    expect(aiModelHasThinking('claude', 'claude-opus-5-5')).toBe(false);
    expect(aiModelTier('chatgpt', 'gpt-6.1-sol')).toBe('smart');
    expect(aiModelTier('chatgpt', 'gpt-6-astra')).toBe('balanced');
    expect(aiModelTier('chatgpt', 'gpt-5.5')).toBe('balanced');
    expect(aiModelTier('claude', 'claude-haiku-5-5')).toBe('fast');
    expect(aiModelTier('api', 'gpt-9-unknown')).toBeNull();
    expect(defaultTaskThinking('agentReplies', 'fast')).toBe('low');
    expect(defaultTaskThinking('translate', 'main')).toBe('low');
    expect(defaultTaskThinking('translate', 'fast', 'api')).toBe('medium');
  });
});
