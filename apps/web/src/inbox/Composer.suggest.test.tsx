import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { fetchCompletion, fetchSuggestions, sendPhraseFeedback } from '@/api/reply-suggestions';
import { Composer, type ComposerProps } from './Composer';

vi.mock('@/api/reply-suggestions', () => ({
  fetchSuggestions: vi.fn(),
  fetchCompletion: vi.fn(),
  sendPhraseFeedback: vi.fn(),
}));

const JID = '60126677889@s.whatsapp.net';
const DRAFTS = {
  suggestions: [
    { label: 'Confirm price, ask the name', text: 'Two Nasi Lemak Ayam at RM12 each. Your name?' },
    { label: 'Offer a drink with it', text: 'Noted! Would you like a Kopi O (RM3.50) with it?' },
  ],
  noAnswer: false,
  handoffRule: null,
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(fetchSuggestions).mockResolvedValue(DRAFTS);
  vi.mocked(fetchCompletion).mockResolvedValue({ completion: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const ai = (over: Partial<NonNullable<ComposerProps['aiSuggest']>> = {}) => ({
  chatJid: JID,
  lastCustomerMessageId: 'm1',
  isAdmin: false,
  state: 'on' as const,
  ...over,
});
const setup = (props: Partial<ComposerProps> = {}) => {
  const onSend = vi.fn();
  const view = render(
    <Composer quickReplies={[]} onSend={onSend} onAttach={vi.fn()} aiSuggest={ai()} {...props} />,
    { wrapper: MemoryRouter },
  );
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
  return { ...view, onSend, user, box };
};

describe('Composer reply suggestions', () => {
  it('shows no button without AI help', () => {
    setup({ aiSuggest: null });
    expect(screen.queryByRole('button', { name: 'Suggest reply' })).toBeNull();
  });

  it('disables the button with a reason while the AI is unavailable', () => {
    setup({ aiSuggest: ai({ state: 'unavailable' }) });
    expect(
      (screen.getByRole('button', { name: 'Suggest reply' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('AI suggestions are not available now')).toBeTruthy();
  });

  it('shows two chips and fills an empty box with the full draft', async () => {
    const { user, box } = setup();
    await user.click(screen.getByRole('button', { name: 'Suggest reply' }));
    expect(fetchSuggestions).toHaveBeenCalledWith(JID, expect.any(AbortSignal));
    const chips = await screen.findAllByTestId('suggestion-chip');
    expect(chips.map((c) => c.textContent)).toEqual([
      'Confirm price, ask the name',
      'Offer a drink with it',
    ]);
    await user.click(chips[0]!);
    expect(box.value).toBe(DRAFTS.suggestions[0]!.text);
  });

  it('asks before a chip replaces typed text', async () => {
    const { user, box } = setup();
    await user.type(box, 'Hi Nurul, sure');
    await user.click(screen.getByRole('button', { name: 'Suggest reply' }));
    await user.click((await screen.findAllByTestId('suggestion-chip'))[1]!);
    expect(screen.getByText('Replace your text with this suggestion?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep my text' }));
    expect(box.value).toBe('Hi Nurul, sure');
    await user.click((await screen.findAllByTestId('suggestion-chip'))[1]!);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(box.value).toBe(DRAFTS.suggestions[1]!.text);
  });

  it('shows a note when the business context has no answer', async () => {
    vi.mocked(fetchSuggestions).mockResolvedValueOnce({
      suggestions: [],
      noAnswer: true,
      handoffRule: null,
    });
    const { user } = setup({ aiSuggest: ai({ isAdmin: true }) });
    await user.click(screen.getByRole('button', { name: 'Suggest reply' }));
    expect(await screen.findByText(/No answer in the business context/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add it to Business context' })).toBeTruthy();
  });

  it('shows the error with Try again', async () => {
    vi.mocked(fetchSuggestions).mockRejectedValueOnce(
      new Error('The AI could not suggest a reply.'),
    );
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Suggest reply' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not suggest');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByTestId('suggestion-chip')).toHaveLength(2);
  });

  it('clears the chips when a new customer message arrives', async () => {
    const { user, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Suggest reply' }));
    await screen.findAllByTestId('suggestion-chip');
    rerender(
      <Composer
        quickReplies={[]}
        onSend={vi.fn()}
        onAttach={vi.fn()}
        aiSuggest={ai({ lastCustomerMessageId: 'm2' })}
      />,
    );
    expect(screen.queryAllByTestId('suggestion-chip')).toHaveLength(0);
  });

  it('requests a completion only after a full word and a 500 ms pause', async () => {
    const { user, box } = setup();
    await user.type(box, 'Hi');
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fetchCompletion).not.toHaveBeenCalled();
    await user.type(box, ' Nurul ');
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(fetchCompletion).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
    expect(fetchCompletion).toHaveBeenCalledWith(JID, 'Hi Nurul ', expect.any(AbortSignal));
  });

  it('completes a half-typed word after a pause', async () => {
    vi.mocked(fetchCompletion).mockResolvedValue({ completion: 'e any other questions?' });
    const { user, box } = setup();
    await user.type(box, 'do you hav');
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(fetchCompletion).toHaveBeenCalledWith(JID, 'do you hav', expect.any(AbortSignal));
    expect(screen.getByTestId('completion-ghost').textContent).toBe(
      'do you have any other questions?',
    );
  });

  it('keeps one request running while typing on, and shows the part still ahead', async () => {
    let resolve!: (value: { completion: string | null }) => void;
    vi.mocked(fetchCompletion).mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { user, box } = setup();
    await user.type(box, 'do you ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    // Typing on, longer than the pause, sends no second request while the first one runs.
    await user.type(box, 'ha');
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
    const [, , signal] = vi.mocked(fetchCompletion).mock.calls[0]!;
    expect(signal.aborted).toBe(false);
    await act(async () => resolve({ completion: 'have any other questions?' }));
    const ghost = () => screen.getByTestId('completion-ghost').textContent;
    expect(ghost()).toBe('do you have any other questions?');
    // Typing the same letters keeps the grey text, shorter.
    await user.type(box, 've an');
    expect(ghost()).toBe('do you have any other questions?');
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
    await user.keyboard('{Tab}');
    expect(box.value).toBe('do you have any other questions?');
  });

  it('cancels the request when the text no longer extends it, then asks again', async () => {
    vi.mocked(fetchCompletion).mockImplementationOnce(() => new Promise(() => undefined));
    const { user, box } = setup();
    await user.type(box, 'do you ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    const [, , first] = vi.mocked(fetchCompletion).mock.calls[0]!;
    await user.type(box, '{Backspace}{Backspace}{Backspace}{Backspace}we ');
    expect(first.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(fetchCompletion).toHaveBeenLastCalledWith(JID, 'do we ', expect.any(AbortSignal));
  });

  it('drops the grey text when the chat changes', async () => {
    vi.mocked(fetchCompletion).mockResolvedValue({ completion: 'any other questions?' });
    const { user, box, rerender } = setup();
    await user.type(box, 'do you have ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(screen.getByTestId('completion-ghost').textContent).toContain('questions');
    vi.mocked(fetchCompletion).mockResolvedValue({ completion: null });
    rerender(
      <Composer
        quickReplies={[]}
        onSend={vi.fn()}
        onAttach={vi.fn()}
        aiSuggest={ai({ chatJid: '60120000000@s.whatsapp.net' })}
      />,
    );
    expect(screen.getByTestId('completion-ghost').textContent).not.toContain('questions');
  });

  const PHRASES = [
    { id: 7, text: 'Thank you for your message! We will reply soon.', language: 'en' as const },
    { id: 8, text: 'Our opening hours are 8am to 10pm daily.', language: 'en' as const },
  ];
  const ghostText = () => screen.getByTestId('completion-ghost').textContent;

  it('shows a phrase from the list at once, without the model and without a pause', async () => {
    const { user, box } = setup({ aiSuggest: ai({ phrases: PHRASES }) });
    await user.type(box, 'Thank you for ');
    expect(ghostText()).toBe('Thank you for your message! We will reply soon.');
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(fetchCompletion).not.toHaveBeenCalled();
    await user.keyboard('{Tab}');
    expect(box.value).toBe('Thank you for your message! We will reply soon.');
    expect(sendPhraseFeedback).toHaveBeenCalledWith(JID, 7, true);
  });

  it('finishes a half-typed word from a phrase, and Esc counts the phrase down', async () => {
    const { user, box } = setup({ aiSuggest: ai({ phrases: PHRASES }) });
    await user.type(box, 'Our open');
    expect(ghostText()).toBe('Our opening hours are 8am to 10pm daily.');
    await user.keyboard('{Escape}');
    expect(sendPhraseFeedback).toHaveBeenCalledWith(JID, 8, false);
    expect(ghostText()).not.toContain('hours');
  });

  it('asks the model when no phrase matches, and keeps a phrase that shows when it answers', async () => {
    let resolve!: (value: { completion: string | null }) => void;
    vi.mocked(fetchCompletion).mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { user, box } = setup({ aiSuggest: ai({ phrases: PHRASES }) });
    await user.type(box, 'Hi Nurul, ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(fetchCompletion).toHaveBeenCalledWith(JID, 'Hi Nurul, ', expect.any(AbortSignal));
    await user.type(box, 'thank you for ');
    expect(ghostText()).toContain('your message!');
    await act(async () => resolve({ completion: 'two Nasi Lemak are ready.' }));
    expect(ghostText()).toContain('your message!');
    expect(ghostText()).not.toContain('Nasi');
  });

  it('does not ask again for the same text after Esc', async () => {
    vi.mocked(fetchCompletion).mockResolvedValue({ completion: 'any other questions?' });
    const { user, box } = setup();
    await user.type(box, 'do you have ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    await user.keyboard('{Escape}');
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('completion-ghost').textContent).not.toContain('questions');
  });

  it('accepts the grey text with Tab, never sends it, and dismisses it with Esc', async () => {
    vi.mocked(fetchCompletion).mockResolvedValue({ completion: 'two Nasi Lemak are RM24.' });
    const { user, box, onSend } = setup();
    await user.type(box, 'Hi Nurul, ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(screen.getByTestId('completion-ghost').textContent).toContain(
      'two Nasi Lemak are RM24.',
    );
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('completion-ghost').textContent).not.toContain('RM24');
    await user.type(box, 'ok ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    await user.keyboard('{Tab}');
    expect(box.value).toBe('Hi Nurul, ok two Nasi Lemak are RM24.');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('Hi Nurul, ok two Nasi Lemak are RM24.');
  });

  it('discards a completion for older text', async () => {
    let resolve!: (value: { completion: string | null }) => void;
    vi.mocked(fetchCompletion).mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { user, box } = setup();
    await user.type(box, 'Hi Nurul ');
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(fetchCompletion).toHaveBeenCalledTimes(1);
    await user.type(box, 'sure');
    await act(async () => resolve({ completion: 'two Nasi Lemak are RM24.' }));
    expect(screen.getByTestId('completion-ghost').textContent).not.toContain('RM24');
    expect(box.value).toBe('Hi Nurul sure');
  });
});
