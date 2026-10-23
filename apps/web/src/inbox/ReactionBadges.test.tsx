import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Message, MessageReaction } from '@ezychat/shared';
import { MessageBubble } from './MessageBubble';
import { ReactionBadges, groupReactions } from './ReactionBadges';
import type { Directory } from './useDirectory';

afterEach(cleanup);

const r = (emoji: string, at: number, extra: Partial<MessageReaction> = {}): MessageReaction => ({
  emoji,
  senderJid: `60${at}0000000@s.whatsapp.net`,
  senderName: `Person ${at}`,
  fromMe: false,
  at,
  sentByUserId: null,
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

describe('MessageBubble: react as the linked number', () => {
  const base: Message = {
    id: 'M-2',
    chatJid: '60123456789@s.whatsapp.net',
    senderJid: '60123456789@s.whatsapp.net',
    senderName: null,
    fromMe: false,
    sentByUserId: null,
    type: 'text',
    body: 'Is the hall free on Saturday?',
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
  const directory = {
    me: { id: 1 },
    nameOf: (id: number | null | undefined) => (id === 2 ? 'Aisyah' : null),
  } as unknown as Directory;
  const mine = (emoji: string, sentByUserId: number | null) =>
    r(emoji, 9, { fromMe: true, senderJid: null, senderName: null, sentByUserId });

  function bubble(
    message: Message,
    props: { reactDisabledReason?: string | null; onReply?: boolean } = {},
  ) {
    const onReact = vi.fn();
    render(
      <MessageBubble
        message={message}
        showSender={false}
        outboundLabel={null}
        quoted={null}
        directory={directory}
        onReply={props.onReply === false ? undefined : () => {}}
        onReact={onReact}
        reactDisabledReason={props.reactDisabledReason ?? null}
      />,
    );
    return onReact;
  }

  it('the 🙂 button opens the bar; an emoji reacts, the same emoji again removes it', async () => {
    const onReact = bubble(base);
    await userEvent.click(screen.getByTestId('reaction-picker-button'));
    const bar = await screen.findByTestId('reaction-picker');
    expect(
      within(bar)
        .getAllByRole('button', { name: /^React with/ })
        .map((b) => b.textContent),
    ).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏']);
    await userEvent.click(within(bar).getByRole('button', { name: 'React with 👍' }));
    expect(onReact).toHaveBeenLastCalledWith(base, '👍');
    expect(screen.queryByTestId('reaction-picker')).toBeNull();
    cleanup();

    const again = bubble({ ...base, reactions: [mine('👍', 1)] });
    await userEvent.click(screen.getByTestId('reaction-picker-button'));
    const current = await screen.findByRole('button', { name: 'React with 👍' });
    expect(current.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Select your emoji again to remove it.')).toBeTruthy();
    await userEvent.click(current);
    expect(again).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'M-2' }), '');
  });

  it('an emoji from the grid; a current emoji outside the bar shows first', async () => {
    const onReact = bubble({ ...base, reactions: [mine('🔥', null)] });
    await userEvent.click(screen.getByTestId('reaction-picker-button'));
    const bar = await screen.findByTestId('reaction-picker');
    expect(within(bar).getAllByRole('button', { name: /^React with/ })[0]!.textContent).toBe('🔥');
    await userEvent.click(within(bar).getByRole('button', { name: 'More emojis' }));
    const grid = within(bar).getByRole('group', { name: 'More emojis' });
    expect(within(grid).getAllByRole('button').length).toBe(40);
    await userEvent.click(within(grid).getByRole('button', { name: 'React with 🎉' }));
    expect(onReact).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'M-2' }), '🎉');
  });

  it('names the teammate behind the linked number’s reaction; the list removes it', async () => {
    const onReact = bubble({ ...base, reactions: [mine('❤️', 2)] });
    await userEvent.click(screen.getByTestId('reaction-picker-button'));
    expect(
      await screen.findByText(
        'Aisyah reacted ❤️. Your choice replaces it: the team shares one reaction.',
      ),
    ).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByTestId('reaction-badges'));
    const list = await screen.findByTestId('reaction-list');
    expect(within(list).getByText('Aisyah (team)')).toBeTruthy();
    await userEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    expect(onReact).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'M-2' }), '');
    cleanup();

    bubble({ ...base, reactions: [mine('❤️', 1)] });
    await userEvent.click(screen.getByTestId('reaction-badges'));
    expect(within(await screen.findByTestId('reaction-list')).getByText('You')).toBeTruthy();
    cleanup();

    bubble({ ...base, reactions: [mine('❤️', 99)] });
    await userEvent.click(screen.getByTestId('reaction-badges'));
    expect(
      within(await screen.findByTestId('reaction-list')).getByText('Someone (team)'),
    ).toBeTruthy();
  });

  it('WhatsApp offline: the bar is disabled and says why; the list has no Remove', async () => {
    const onReact = bubble(
      { ...base, reactions: [mine('👍', 1)] },
      { reactDisabledReason: 'WhatsApp is not connected. You can react when it is back.' },
    );
    await userEvent.click(screen.getByTestId('reaction-picker-button'));
    expect((await screen.findByRole('status')).textContent).toContain('WhatsApp is not connected');
    const thumbs = screen.getByRole('button', { name: 'React with 👍' }) as HTMLButtonElement;
    expect(thumbs.disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByTestId('reaction-badges'));
    const list = await screen.findByTestId('reaction-list');
    expect(within(list).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(onReact).not.toHaveBeenCalled();
  });

  it('no 🙂 button where no reply is possible (unsent message, no reply action)', () => {
    bubble({ ...base, id: 'local-x', status: 'pending' });
    expect(screen.queryByTestId('reaction-picker-button')).toBeNull();
    cleanup();
    bubble(base, { onReply: false });
    expect(screen.queryByTestId('reaction-picker-button')).toBeNull();
  });
});
