import { describe, expect, it } from 'vitest';
import { AiAgentGroups, AiGroupChat } from './ai-groups';

describe('AI in groups contract', () => {
  it('reads an answer from a server before Open chat by its enabled flag', () => {
    const before = {
      agentId: 3,
      agentName: 'Aina',
      agentEnabled: true,
      agentAnswersGroups: true,
      paused: false,
    };
    expect(AiGroupChat.parse({ ...before, enabled: true })).toMatchObject({
      setting: 'default',
      mode: 'tag',
      agentMode: 'tag',
      agentScope: 'selected',
    });
    // A switched-off group stays off: never shown as answering.
    expect(AiGroupChat.parse({ ...before, enabled: false })).toMatchObject({
      setting: 'off',
      mode: 'off',
    });
    const agent = AiAgentGroups.parse({
      enabled: true,
      loopGuard: 10,
      groups: [
        { jid: 'a@g.us', name: 'On', memberCount: 3, enabled: true },
        { jid: 'b@g.us', name: 'Off', memberCount: null, enabled: false },
      ],
    });
    expect(agent).toMatchObject({ scope: 'selected', mode: 'tag', inboxName: null });
    expect(agent.groups.map((g) => [g.setting, g.mode])).toEqual([
      ['default', 'tag'],
      ['off', 'off'],
    ]);
  });

  it('keeps the values a current server sends', () => {
    expect(
      AiGroupChat.parse({
        enabled: true,
        setting: 'open',
        mode: 'open',
        agentId: 3,
        agentName: 'Aina',
        agentMode: 'tag',
        agentScope: 'all',
        agentEnabled: true,
        agentAnswersGroups: true,
        paused: false,
      }),
    ).toMatchObject({ setting: 'open', mode: 'open', agentScope: 'all' });
  });
});
