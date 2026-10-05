import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { VOICE_NOTE_MAX_SECONDS } from '@wa-team-inbox/shared';
import { useVoiceRecorder, voiceRecordingMime, voiceSupport } from './useVoiceRecorder';
import { FakeMediaRecorder, installMediaMocks, removeMediaMocks } from './test-media';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  removeMediaMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function startRecording() {
  const hook = renderHook(() => useVoiceRecorder());
  await act(async () => {
    hook.result.current.start();
  });
  await flush();
  return hook;
}

describe('voiceSupport', () => {
  it('records Opus where the browser can (OGG preferred, WebM otherwise)', () => {
    installMediaMocks({ supported: ['audio/webm;codecs=opus'] });
    expect(voiceSupport()).toBe('ok');
    expect(voiceRecordingMime()).toBe('audio/webm;codecs=opus');
    installMediaMocks({ supported: ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus'] });
    expect(voiceRecordingMime()).toBe('audio/ogg;codecs=opus');
  });

  it('is unsupported where only MP4/AAC can be recorded (Safari) or MediaRecorder is missing', () => {
    installMediaMocks({ supported: ['audio/mp4'] });
    expect(voiceSupport()).toBe('unsupported');
    vi.stubGlobal('MediaRecorder', undefined);
    expect(voiceSupport()).toBe('unsupported');
  });

  it('needs a secure connection for the microphone', () => {
    installMediaMocks({ secure: false });
    expect(voiceSupport()).toBe('insecure');
  });
});

describe('useVoiceRecorder', () => {
  it('reports a denied microphone permission without recording', async () => {
    installMediaMocks({ deny: 'NotAllowedError' });
    const { result } = await startRecording();
    expect(result.current.state).toEqual({ status: 'idle', error: 'denied' });
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('reports a missing microphone', async () => {
    installMediaMocks({ deny: 'NotFoundError' });
    const { result } = await startRecording();
    expect(result.current.state).toEqual({ status: 'idle', error: 'no-mic' });
  });

  it('records mono Opus with a running timer, then offers the recording for listening back', async () => {
    const m = installMediaMocks();
    const { result } = await startRecording();
    expect(m.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ channelCount: 1 }),
    });
    const rec = FakeMediaRecorder.instances[0]!;
    expect(rec.options.mimeType).toBe('audio/webm;codecs=opus');
    expect(result.current.state.status).toBe('recording');

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    const s = result.current.state;
    expect(s.status === 'recording' && s.elapsedMs).toBeGreaterThanOrEqual(2_800);

    act(() => result.current.stop());
    const review = result.current.state;
    expect(review.status).toBe('review');
    if (review.status !== 'review') return;
    expect(review.recording.mime).toBe('audio/webm;codecs=opus');
    expect(review.recording.blob.size).toBeGreaterThan(0);
    expect(review.recording.seconds).toBeCloseTo(3, 0);
    expect(review.recording.url).toBe('blob:voice-preview');
    expect(m.trackStop).toHaveBeenCalled();
  });

  it('cancel while recording discards it and releases the microphone', async () => {
    const m = installMediaMocks();
    const { result } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => result.current.cancel());
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(m.trackStop).toHaveBeenCalled();
    expect(m.createObjectURL).not.toHaveBeenCalled();
  });

  it('cancel after listening back frees the preview', async () => {
    const m = installMediaMocks();
    const { result } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => result.current.stop());
    act(() => result.current.cancel());
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(m.revokeObjectURL).toHaveBeenCalledWith('blob:voice-preview');
  });

  it('a recording under one second is discarded with a hint', async () => {
    installMediaMocks();
    const { result } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    act(() => result.current.stop());
    expect(result.current.state).toEqual({ status: 'idle', error: 'too-short' });
  });

  it('stops by itself at five minutes', async () => {
    installMediaMocks();
    const { result } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(VOICE_NOTE_MAX_SECONDS * 1000 + 500);
    });
    const s = result.current.state;
    expect(s.status).toBe('review');
    if (s.status === 'review')
      expect(s.recording.seconds).toBeLessThanOrEqual(VOICE_NOTE_MAX_SECONDS);
  });

  it('take() hands over the recording and resets', async () => {
    const m = installMediaMocks();
    const { result } = await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    act(() => result.current.stop());
    let taken: ReturnType<typeof result.current.take> = null;
    act(() => {
      taken = result.current.take();
    });
    expect(taken).toMatchObject({ mime: 'audio/webm;codecs=opus' });
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(m.revokeObjectURL).toHaveBeenCalled();
  });

  it('releases the microphone when unmounted mid-recording', async () => {
    const m = installMediaMocks();
    const hook = await startRecording();
    hook.unmount();
    expect(m.trackStop).toHaveBeenCalled();
  });
});
