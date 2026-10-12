import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as recorder from '@/lib/voice-recorder';
import { VoiceStartFailure, startVoiceRecording, voiceSupport } from '@/lib/voice-recorder';
import { Composer } from './Composer';

vi.mock('@/lib/voice-recorder', async (importOriginal) => ({
  ...(await importOriginal<typeof recorder>()),
  voiceSupport: vi.fn(() => 'ok'),
  startVoiceRecording: vi.fn(),
}));

const recording = () => ({
  level: vi.fn(() => 0.5),
  stop: vi.fn(
    async () => new Blob([new Uint8Array([0x4f, 0x67, 0x67, 0x53])], { type: 'audio/ogg' }),
  ),
  cancel: vi.fn(),
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  URL.createObjectURL = vi.fn(() => 'blob:voice');
  URL.revokeObjectURL = vi.fn();
});
beforeEach(() => {
  vi.mocked(voiceSupport).mockReturnValue('ok');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderComposer(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onVoiceNote = vi.fn();
  render(
    <Composer
      quickReplies={[]}
      onSend={vi.fn()}
      onAttach={vi.fn()}
      onVoiceNote={onVoiceNote}
      {...over}
    />,
  );
  return { onVoiceNote };
}

describe('Composer voice notes', () => {
  it('offers the mic while the box is empty and Send once there is text', async () => {
    renderComposer();
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hi');
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('records, lets you review, and sends an Ogg file as a voice note', async () => {
    const rec = recording();
    vi.mocked(startVoiceRecording).mockResolvedValue(rec);
    const { onVoiceNote } = renderComposer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    expect(await screen.findByRole('timer')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const review = await screen.findByTestId('voice-review');
    expect(rec.stop).toHaveBeenCalled();
    await user.click(within(review).getByRole('button', { name: 'Send voice note' }));
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
    const file = onVoiceNote.mock.calls[0]![0] as File;
    expect(file.type).toBe('audio/ogg');
    expect(file.name).toBe('voice-note.ogg');
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeTruthy();
  });

  it('sends straight from recording, and Delete throws the recording away', async () => {
    const first = recording();
    const second = recording();
    vi.mocked(startVoiceRecording).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { onVoiceNote } = renderComposer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Send voice note' }));
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Delete recording' }));
    expect(second.cancel).toHaveBeenCalled();
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
  });

  it('stops by itself at five minutes and opens the review', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(startVoiceRecording).mockResolvedValue(recording());
    renderComposer();
    await act(async () => screen.getByRole('button', { name: 'Record a voice note' }).click());
    await screen.findByRole('timer');
    await act(async () => {
      vi.advanceTimersByTime(300_100);
    });
    expect(await screen.findByTestId('voice-review')).toBeTruthy();
  });

  it('explains a blocked microphone and lets you try again or cancel', async () => {
    vi.mocked(startVoiceRecording)
      .mockRejectedValueOnce(new VoiceStartFailure('blocked'))
      .mockResolvedValueOnce(recording());
    renderComposer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Microphone is blocked.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('timer')).toBeTruthy();
  });

  it('greys out the mic with the reason on an insecure (LAN http) page', () => {
    vi.mocked(voiceSupport).mockReturnValue('insecure');
    renderComposer();
    const mic = screen.getByRole('button', { name: 'Record a voice note' }) as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('Voice notes need a secure link');
  });

  it('shows no mic where the browser cannot record, or without a voice note handler', () => {
    vi.mocked(voiceSupport).mockReturnValue('unsupported');
    renderComposer();
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).toBeNull();
    cleanup();
    vi.mocked(voiceSupport).mockReturnValue('ok');
    renderComposer({ onVoiceNote: undefined });
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).toBeNull();
  });

  it('keeps the recording in Review when the send confirmation is declined', async () => {
    vi.mocked(startVoiceRecording).mockResolvedValue(recording());
    let allow = false;
    const { onVoiceNote } = renderComposer({ confirmSend: () => allow });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Send voice note' }));
    const review = await screen.findByTestId('voice-review');
    expect(onVoiceNote).not.toHaveBeenCalled();
    allow = true;
    await user.click(within(review).getByRole('button', { name: 'Send voice note' }));
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
  });

  it('switches the microphone off when Delete is pressed while it is still starting', async () => {
    const rec = recording();
    let resolveStart: (r: typeof rec) => void = () => {};
    vi.mocked(startVoiceRecording).mockReturnValue(new Promise((r) => (resolveStart = r)));
    renderComposer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Delete recording' }));
    await act(async () => resolveStart(rec));
    expect(rec.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeTruthy();
  });

  it('keeps a voice note whose upload failed, and resends it with the same id', async () => {
    vi.mocked(startVoiceRecording).mockResolvedValue(recording());
    const onVoiceNote = vi
      .fn<(file: File, clientId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce();
    renderComposer({ onVoiceNote });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Send voice note' }));
    const review = await screen.findByTestId('voice-review');
    expect(within(review).getByRole('alert').textContent).toBe('Couldn’t send. Try again.');
    await user.click(within(review).getByRole('button', { name: 'Send voice note' }));
    expect(onVoiceNote).toHaveBeenCalledTimes(2);
    expect(onVoiceNote.mock.calls[1]![1]).toBe(onVoiceNote.mock.calls[0]![1]);
    expect(screen.queryByTestId('voice-review')).toBeNull();
  });

  it('never brings back a recording deleted while it was still finishing', async () => {
    const rec = recording();
    let finishStop: (b: Blob) => void = () => {};
    rec.stop.mockReturnValue(new Promise<Blob>((r) => (finishStop = r)));
    vi.mocked(startVoiceRecording).mockResolvedValue(rec);
    renderComposer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Delete recording' }));
    await act(async () => finishStop(new Blob(['x'], { type: 'audio/ogg' })));
    expect(screen.queryByTestId('voice-review')).toBeNull();
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeTruthy();
  });

  it('says so when a recording could not be finished, instead of waiting forever', async () => {
    const rec = recording();
    rec.stop.mockRejectedValue(new Error('encoder failed'));
    vi.mocked(startVoiceRecording).mockResolvedValue(rec);
    const { onVoiceNote } = renderComposer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    await user.click(await screen.findByRole('button', { name: 'Send voice note' }));
    expect((await screen.findByRole('alert')).textContent).toContain('couldn’t be saved');
    expect(onVoiceNote).not.toHaveBeenCalled();
  });

  it('switches the microphone off when the chat closes while it is still starting', async () => {
    const rec = recording();
    let resolveStart: (r: typeof rec) => void = () => {};
    vi.mocked(startVoiceRecording).mockReturnValue(new Promise((r) => (resolveStart = r)));
    renderComposer();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Record a voice note' }));
    cleanup();
    await act(async () => resolveStart(rec));
    expect(rec.cancel).toHaveBeenCalled();
  });
});
