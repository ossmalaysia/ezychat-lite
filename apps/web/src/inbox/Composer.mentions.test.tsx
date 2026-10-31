import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupMember } from '@ezychat/shared';
import { Composer } from './Composer';

afterEach(() => cleanup());
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

const member = (over: Partial<GroupMember> & Pick<GroupMember, 'jid'>): GroupMember => ({
  phone: null,
  lid: null,
  name: null,
  username: null,
  role: 'member',
  isMe: false,
  chatJid: null,
  ...over,
});

const MEMBERS: GroupMember[] = [
  member({
    jid: '60000000000@s.whatsapp.net',
    phone: '60000000000',
    name: 'Kopi Apong',
    isMe: true,
  }),
  member({
    jid: '60126677889@s.whatsapp.net',
    phone: '60126677889',
    name: 'Nurul Huda',
    role: 'admin',
  }),
  member({ jid: '60123110021@s.whatsapp.net', phone: '60123110021', name: 'Farah Aziz' }),
  member({ jid: '269088374935676@lid', lid: '269088374935676@lid', name: 'Tan Wei Jie' }),
  member({ jid: '60190000999@s.whatsapp.net', phone: '60190000999' }),
];

function setup(mentions: Parameters<typeof Composer>[0]['mentions'] = undefined) {
  const onSend = vi.fn();
  const onOpen = vi.fn();
  render(
    <Composer
      quickReplies={[]}
      onSend={onSend}
      onAttach={vi.fn()}
      mentions={mentions === undefined ? { members: MEMBERS, error: false, onOpen } : mentions}
    />,
  );
  const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  return { onSend, onOpen, box, user: userEvent.setup() };
}

describe('Composer @ tags in groups', () => {
  it('lists the members without the linked number, named first, with the Admin chip', async () => {
    const { box, user, onOpen } = setup();
    await user.type(box, 'Morning @');
    const picker = await screen.findByTestId('mention-picker');
    const names = within(picker)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toHaveLength(4);
    expect(names[0]).toContain('Farah Aziz');
    expect(names[1]).toContain('Nurul Huda');
    expect(names[1]).toContain('Admin');
    expect(names[2]).toContain('Tan Wei Jie');
    expect(names[3]).toContain('No name shared');
    expect(names.join()).not.toContain('Kopi Apong');
    expect(onOpen).toHaveBeenCalled();
  });

  it('filters, picks with Enter and click, and sends @<number> tags with the addresses', async () => {
    const { box, user, onSend } = setup();
    await user.type(box, 'Morning @fa');
    expect(within(screen.getByTestId('mention-picker')).getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(box.value).toBe('Morning @Farah Aziz ');
    await user.type(box, 'and @wei');
    await user.click(screen.getByRole('option', { name: /Tan Wei Jie/ }));
    await user.type(box, 'beans Friday');
    expect(box.value).toBe('Morning @Farah Aziz and @Tan Wei Jie beans Friday');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith(
      'Morning @60123110021 and @269088374935676 beans Friday',
      ['269088374935676@lid', '60123110021@s.whatsapp.net'],
      'Morning @Farah Aziz and @Tan Wei Jie beans Friday',
    );
    expect(box.value).toBe('');
  });

  it('moves with the arrow keys and picks with Tab', async () => {
    const { box, user } = setup();
    await user.type(box, '@');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{ArrowUp}{ArrowUp}{Tab}');
    // Up from the first row wraps to the last: the member without a name, tagged by number.
    expect(box.value).toBe('@+60190000999 ');
  });

  it('sends a tag whose name was edited as plain text, without mentions', async () => {
    const { box, user, onSend } = setup();
    await user.type(box, '@far');
    await user.keyboard('{Enter}');
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(box.value).toBe('@Farah A');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('@Farah A');
  });

  it('closes with Escape and keeps the typed text; no match and loading states', async () => {
    const { box, user, onSend } = setup();
    await user.type(box, 'Hi @zzz');
    expect(screen.getByTestId('mention-picker').textContent).toContain('No member matches “@zzz”');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    expect(box.value).toBe('Hi @zzz');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('Hi @zzz');
    cleanup();

    const loading = setup({ members: null, error: false, onOpen: vi.fn() });
    await loading.user.type(loading.box, '@');
    expect(screen.getByTestId('mention-picker').textContent).toContain('Loading members…');
    cleanup();

    const failed = setup({ members: null, error: true, onOpen: vi.fn() });
    await failed.user.type(failed.box, '@');
    expect(screen.getByTestId('mention-picker').textContent).toContain('couldn’t be loaded');
  });

  it('opens no picker without group tagging, or for an email address', async () => {
    const plain = setup(null);
    await plain.user.type(plain.box, 'Hi @far');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    cleanup();

    const group = setup();
    await group.user.type(group.box, 'mail me at a@far');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
  });
});
