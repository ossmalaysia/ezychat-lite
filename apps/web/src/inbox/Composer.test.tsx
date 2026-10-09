import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('Composer', () => {
  it('inserts an emoji at the saved selection and returns focus to the draft without sending', async () => {
    const onSend = vi.fn();
    render(<Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} />);
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await user.type(box, 'Hi Alex!');
    box.setSelectionRange(3, 7);
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(screen.getByRole('button', { name: 'Smiling face' }));
    expect(box.value).toBe('Hi 😊!');
    expect(box.selectionStart).toBe(5);
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard(' See you');
    expect(box.value).toBe('Hi 😊 See you!');
  });

  it('searches emoji by meaning and recovers from an empty result', async () => {
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(screen.getByRole('button', { name: 'Hearts' }));
    expect(screen.getByRole('button', { name: 'Red heart' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delivery truck' })).toBeNull();
    const search = screen.getByRole('searchbox', { name: 'Search emoji' });
    await user.type(search, 'delivery');
    expect(screen.getByRole('button', { name: 'Package' })).toBeTruthy();
    await user.clear(search);
    await user.type(search, 'zzzz');
    expect(screen.getByRole('status').textContent).toContain('No emoji found');
    await user.click(screen.getByRole('button', { name: 'Clear search emoji' }));
    expect(screen.getByRole('button', { name: 'Red heart' })).toBeTruthy();
  });

  it('allows selecting the same emoji again and leaves the caret after it', async () => {
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(screen.getByRole('button', { name: 'Smiling face' }));
    box.setSelectionRange(0, 2);
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(screen.getByRole('button', { name: 'Smiling face' }));
    expect(box.value).toBe('😊');
    expect(box.selectionStart).toBe(2);
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('supports keyboard navigation and sends an emoji-only message', async () => {
    const onSend = vi.fn();
    render(<Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.click(screen.getByRole('button', { name: 'Grinning face' }));
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    screen.getByRole('button', { name: 'Grinning face' }).focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe(
      '😀😊',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('😀😊');
  });

  it('dismisses emoji with Escape without changing the draft', async () => {
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await user.type(box, 'Draft');
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Emoji choices' })).toBeNull();
    expect(box.value).toBe('Draft');
  });

  it('keeps short drafts free of scrollbars, caps long drafts and shrinks again', () => {
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    // Tailwind's preflight makes every border solid; a border-style of none computes to width 0.
    box.style.borderStyle = 'solid';
    box.style.borderTopWidth = '1px';
    box.style.borderBottomWidth = '1px';
    // A real browser measures content + padding, excluding the border.
    Object.defineProperty(box, 'scrollHeight', {
      configurable: true,
      get: () => (box.value.length > 100 ? 250 : 44),
    });
    fireEvent.change(box, { target: { value: 'Short draft' } });
    expect(box.style.height).toBe('46px');
    expect(box.style.overflowY).toBe('hidden');
    fireEvent.change(box, { target: { value: 'Long draft '.repeat(40) } });
    expect(box.style.height).toBe('160px');
    expect(box.style.overflowY).toBe('auto');
    fireEvent.change(box, { target: { value: '' } });
    expect(box.style.height).toBe('46px');
    expect(box.style.overflowY).toBe('hidden');
  });

  it('disables emoji along with the composer', () => {
    render(<Composer disabled quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    expect(
      (screen.getByRole('button', { name: 'Insert emoji' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('opens quick replies without losing a draft, appends the chosen reply and does not send', async () => {
    const onSend = vi.fn();
    const reply = { id: 1, shortcut: 'delivery', body: 'Delivery takes two days.', updatedAt: 0 };
    render(<Composer quickReplies={[reply]} onSend={onSend} onAttach={vi.fn()} />);
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await user.type(box, 'Hello Alex');
    await user.click(screen.getByRole('button', { name: 'Quick replies' }));
    expect(box.value).toBe('Hello Alex');
    await user.click(screen.getByRole('option', { name: /delivery/ }));
    expect(box.value).toBe('Hello Alex\nDelivery takes two days.');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('dismisses the quick reply browser with Escape and preserves the draft', async () => {
    render(
      <Composer
        quickReplies={[{ id: 1, shortcut: 'help', body: 'How can I help?', updatedAt: 0 }]}
        onSend={vi.fn()}
        onAttach={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await user.type(box, 'Draft');
    await user.click(screen.getByRole('button', { name: 'Quick replies' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).toBeNull();
    expect(box.value).toBe('Draft');
  });
  it('sends on Enter and clears the textarea', async () => {
    const onSend = vi.fn();
    render(<Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(box, 'Hello there{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hello there');
    expect(box.value).toBe('');
  });

  it('inserts a newline on Shift+Enter instead of sending', async () => {
    const onSend = vi.fn();
    render(<Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe('line one\nline two');
  });

  it('does not send blank text and sends via the Send button', async () => {
    const onSend = vi.fn();
    render(<Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(box, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
    await user.clear(box);
    await user.type(box, 'hi');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('keeps the text when the send confirmation is declined', async () => {
    const onSend = vi.fn();
    const confirmSend = vi.fn(async () => false);
    render(
      <Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} confirmSend={confirmSend} />,
    );
    const box = screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(box, 'wait{Enter}');
    expect(confirmSend).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe('wait');
  });

  it('emits typing while the user types', async () => {
    const onTyping = vi.fn();
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} onTyping={onTyping} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'abc');
    expect(onTyping).toHaveBeenCalled();
  });

  it('desktop keyboards label Enter as send', () => {
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /message/i }).getAttribute('enterkeyhint')).toBe(
      'send',
    );
  });

  it('on touch devices Enter inserts a newline and the keyboard key is not labelled Send', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: q === '(pointer: coarse)',
        media: q,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    try {
      const onSend = vi.fn();
      render(<Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} />);
      const box = screen.getByRole('textbox', { name: /message/i }) as HTMLTextAreaElement;
      expect(box.getAttribute('enterkeyhint')).toBe('enter');
      const user = userEvent.setup();
      await user.type(box, 'a{Enter}b');
      expect(onSend).not.toHaveBeenCalled();
      expect(box.value).toBe('a\nb');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Composer reply bar', () => {
  const replyTo = {
    id: 'WA-1',
    author: 'Koh',
    preview: 'Noted. However, our company only prefer online transfer',
  };

  it('shows who is being replied to, focuses the box, and cancels with Esc or ✕', async () => {
    const onCancelReply = vi.fn();
    render(
      <Composer
        quickReplies={[]}
        onSend={vi.fn()}
        onAttach={vi.fn()}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
      />,
    );
    const bar = screen.getByTestId('reply-bar');
    expect(bar.textContent).toContain('Replying to Koh');
    expect(bar.textContent).toContain('online transfer');
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(document.activeElement).toBe(box);
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onCancelReply).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(onCancelReply).toHaveBeenCalledTimes(2);
  });

  it('shows no bar without a reply', () => {
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    expect(screen.queryByTestId('reply-bar')).toBeNull();
  });
});
