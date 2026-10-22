import { describe, expect, it } from 'vitest';
import { AiHandoffReason } from '@ezychat/shared';
import { handoffReasonLabel, isHandoffReason } from './ai-handoff';

describe('handoffReasonLabel', () => {
  it.each(AiHandoffReason.options)('has a readable label for %s', (reason) => {
    const label = handoffReasonLabel(reason);
    expect(label).toBeTruthy();
    expect(label).not.toContain('handoffReason');
  });

  it('says a reply that would reveal an Internal item was not sent', () => {
    expect(handoffReasonLabel('confidential_leak')).toBe(
      'the reply would have revealed an Internal item',
    );
    expect(isHandoffReason('confidential_leak')).toBe(true);
    expect(isHandoffReason('made_up')).toBe(false);
  });
});
