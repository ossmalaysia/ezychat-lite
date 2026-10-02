import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

afterEach(() => cleanup());

describe('Composer', () => {
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
});
