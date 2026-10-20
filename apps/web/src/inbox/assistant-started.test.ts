import { describe, expect, it } from 'vitest';
import { assistantStartedChat } from './assistant-started';

const ours = { fromMe: true };
const assistant = { fromMe: true, viaAssistant: true };
const customer = { fromMe: false };

describe('assistantStartedChat', () => {
  it('is true for a direct chat with only our messages, one from the assistant', () => {
    expect(assistantStartedChat({ type: 'dm' }, [assistant], false)).toBe(true);
    expect(assistantStartedChat({ type: 'dm' }, [assistant, ours], false)).toBe(true);
  });

  it('is false once the customer wrote, for groups, without assistant messages or empty', () => {
    expect(assistantStartedChat({ type: 'dm' }, [assistant, customer], false)).toBe(false);
    expect(assistantStartedChat({ type: 'group' }, [assistant], false)).toBe(false);
    expect(assistantStartedChat({ type: 'dm' }, [ours], false)).toBe(false);
    expect(assistantStartedChat({ type: 'dm' }, [], false)).toBe(false);
  });

  it('is false while older messages are not loaded (one of them may be from the customer)', () => {
    expect(assistantStartedChat({ type: 'dm' }, [assistant], true)).toBe(false);
  });
});
