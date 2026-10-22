import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Message, MessageReaction } from '@ezychat/shared';
import { MessageBubble } from './MessageBubble';
import { ReactionBadges, groupReactions } from './ReactionBadges';

afterEach(cleanup);

const r = (emoji: string, at: number, extra: Partial<MessageReaction> = {}): MessageReaction => ({
  emoji,
  senderJid: `60${at}0000000@s.whatsapp.net`,
  senderName: `Person ${at}`,
  fromMe: false,
  at,
  ...extra,
});

describe('groupReactions', () => {
  it('puts the most used emoji first, then the one used first', () => {
    const groups = groupReactions([r('❤️', 1), r('👍', 2), r('👍', 3), r('😂', 0)]);
    expect(groups.map((g) => [g.emoji, g.reactions.length])).toEqual([
      ['👍', 2],
      ['😂', 1],
      ['❤️', 1],
    ]);
  });
});

describe('ReactionBadges', () => {
  it('shows nothing without reactions', () => {
    const view = render(<ReactionBadges reactions={[]} out={false} />);
    expect(view.container.innerHTML).toBe('');
  });

  it('one reaction: just the emoji under the left corner of an inbound bubble', () => {
    render(<ReactionBadges reactions={[r('👍', 1)]} out={false} />);
    const badge = screen.getByTestId('reaction-badges');
    expect(badge.textContent).toBe('👍');
    expect(badge.getAttribute('aria-label')).toBe('Reactions: 👍 1');
    expect(badge.className).toContain('left-2');
  });

  it('several: at most three emojis and the total; the list names everyone, long names truncate', async () => {
    const long = 'Muhammad Hafiz bin Abdul Rahman Shah (Kopi Apong Butterworth branch)';
    const reactions = [
      r('👍', 1),
      r('👍', 2, { senderName: long }),
      r('❤️', 3, { fromMe: true, senderJid: null, senderName: null }),
      r('😂', 4),
      r('😮', 5, { senderName: null, senderJid: '60129998877@s.whatsapp.net' }),
      r('🙏', 6, { senderName: null, senderJid: '999@lid' }),
    ];
    render(<ReactionBadges reactions={reactions} out />);
    const badge = screen.getByTestId('reaction-badges');
    expect(badge.textContent).toBe('👍❤️😂6');
    expect(badge.className).toContain('right-2');
    await userEvent.click(badge);
    const list = await screen.findByTestId('reaction-list');
    const rows = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      '👍Person 1',
      `👍${long}`,
      '❤️You (phone)',
      '😂Person 4',
      '😮+60129998877',
      '🙏Unknown contact',
    ]);
    expect(within(list).getByText(long).className).toContain('truncate');
  });

  it('a direct chat names the customer like the header when the server has no name', async () => {
    render(
      <ReactionBadges
        reactions={[r('👍', 1, { senderName: null })]}
        out
        contactName="Farah Aziz"
      />,
    );
    await userEvent.click(screen.getByTestId('reaction-badges'));
    expect(await screen.findByText('Farah Aziz')).toBeTruthy();
  });
});

describe('MessageBubble reactions', () => {
  const message: Message = {
    id: 'M-1',
    chatJid: '60123456789@s.whatsapp.net',
    senderJid: '60123456789@s.whatsapp.net',
    senderName: null,
    fromMe: false,
    sentByUserId: null,
    type: 'text',
    body: 'Can I book catering?',
    mediaUrl: null,
    mediaMime: null,
    mediaName: null,
    mediaStatus: 'none',
    quotedId: null,
    status: 'delivered',
    error: null,
    timestamp: 1_700_000_000_000,
    clientId: null,
    reactions: [],
  };

  it('shows the badge on the bubble and leaves room below it; none without reactions', () => {
    const view = render(
      <MessageBubble
        message={{ ...message, reactions: [r('👍', 1)] }}
        showSender={false}
        outboundLabel={null}
        quoted={null}
      />,
    );
    expect(screen.getByTestId('reaction-badges').closest('[data-message-id]')).toBeTruthy();
    expect((view.container.firstElementChild as HTMLElement).className).toContain('mb-4');
    cleanup();
    const plain = render(
      <MessageBubble
        message={{ ...message, reactions: undefined as never }}
        showSender={false}
        outboundLabel={null}
        quoted={null}
      />,
    );
    expect(screen.queryByTestId('reaction-badges')).toBeNull();
    expect((plain.container.firstElementChild as HTMLElement).className).not.toContain('mb-4');
  });
});
