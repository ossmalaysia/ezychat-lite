import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';
import { installMediaMocks, removeMediaMocks } from './voice/test-media';

afterEach(() => {
  cleanup();
  removeMediaMocks();
});
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onVoice = vi.fn();
  render(
    <Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} onVoice={onVoice} {...props} />,
  );
  return { onVoice, user: userEvent.setup() };
}

describe('Composer voice notes', () => {
  it('has no mic button when voice notes are not wired up', () => {
    installMediaMocks();
    render(<Composer quickReplies={[]} onSend={vi.fn()} onAttach={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('shows the mic while the draft is empty and Send once there is text', async () => {
    installMediaMocks();
    const { user } = renderComposer();
    const mic = screen.getByRole('button', { name: 'Record voice note' });
    expect(mic.className).toContain('size-11'); // 44px touch target
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hi');
    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('hides recording on browsers that can only record MP4/AAC and explains why', async () => {
    installMediaMocks({ supported: ['audio/mp4'] });
    renderComposer();
    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
    const info = screen.getByRole('button', { name: 'Voice notes unavailable' });
    expect(info.getAttribute('title')).toMatch(/Chrome, Edge or Firefox/);
  });

  it('explains that plain-HTTP access cannot use the microphone', () => {
    installMediaMocks({ secure: false });
    renderComposer();
    const info = screen.getByRole('button', { name: 'Voice notes unavailable' });
    expect(info.getAttribute('title')).toMatch(/HTTPS/);
  });

  it('records, lets the user listen back, then sends the voice note', async () => {
    installMediaMocks();
    const confirmSend = vi.fn(() => true);
    const { user, onVoice } = renderComposer({ confirmSend });
    await user.click(screen.getByRole('button', { name: 'Record voice note' }));
    const stop = await screen.findByRole('button', { name: 'Stop recording' });
    expect(screen.getByRole('timer').textContent).toMatch(/0:0\d/);
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();

    // wait past the 1-second minimum
    await new Promise((r) => setTimeout(r, 1_100));
    await user.click(stop);
    const preview = await screen.findByLabelText('Voice note preview');
    expect(preview.tagName).toBe('AUDIO');
    expect(preview.getAttribute('src')).toBe('blob:voice-preview');
    expect(preview.className).toContain('min-w-0'); // shrinks at 360px instead of overflowing
    expect(onVoice).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send voice note' }));
    await waitFor(() => expect(onVoice).toHaveBeenCalledTimes(1));
    expect(confirmSend).toHaveBeenCalled();
    const note = onVoice.mock.calls[0]![0] as { blob: Blob; mime: string; seconds: number };
    expect(note.mime).toBe('audio/webm;codecs=opus');
    expect(note.blob).toBeInstanceOf(Blob);
    expect(note.seconds).toBeGreaterThanOrEqual(1);
    expect(await screen.findByRole('button', { name: 'Record voice note' })).toBeTruthy();
  });

  it('keeps the recording when the reply-anyway confirmation is declined', async () => {
    installMediaMocks();
    const { user, onVoice } = renderComposer({ confirmSend: () => false });
    await user.click(screen.getByRole('button', { name: 'Record voice note' }));
    const stop = await screen.findByRole('button', { name: 'Stop recording' });
    await new Promise((r) => setTimeout(r, 1_100));
    await user.click(stop);
    await user.click(await screen.findByRole('button', { name: 'Send voice note' }));
    expect(onVoice).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Voice note preview')).toBeTruthy();
  });

  it('cancel discards the recording and returns to the draft', async () => {
    installMediaMocks();
    const { user, onVoice } = renderComposer();
    await user.click(screen.getByRole('button', { name: 'Record voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Discard voice note' }));
    expect(onVoice).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record voice note' })).toBeTruthy();
  });

  it('explains a blocked microphone', async () => {
    installMediaMocks({ deny: 'NotAllowedError' });
    const { user } = renderComposer();
    await user.click(screen.getByRole('button', { name: 'Record voice note' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Microphone access is blocked/);
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeTruthy();
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss.className).toContain('size-11'); // 44px touch target
    await user.click(dismiss);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
