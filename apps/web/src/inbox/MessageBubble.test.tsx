import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Message } from '@wa-team-inbox/shared';
import { MessageBubble } from './MessageBubble';

const groupMessage: Message = {
  id: 'G-1',
  chatJid: '120363000000000000@g.us',
  senderJid: '123456789012345@lid',
  senderName: null,
  fromMe: false,
  sentByUserId: null,
  type: 'text',
  body: 'hello team',
  mediaUrl: null,
  mediaMime: null,
  mediaName: null,
  mediaStatus: 'none',
  quotedId: null,
  status: 'delivered',
  error: null,
  timestamp: 1_700_000_000_000,
  clientId: null,
};

afterEach(cleanup);

describe('MessageBubble group sender', () => {
  it('labels a WhatsApp ID sender without a name as "Unknown contact", never its digits', () => {
    const view = render(
      <MessageBubble message={groupMessage} showSender outboundLabel={null} quoted={null} />,
    );
    expect(screen.getByText('Unknown contact')).toBeTruthy();
    expect(view.container.textContent).not.toContain('123456789012345');
  });

  it('labels a phone-number sender without a name as +digits', () => {
    render(
      <MessageBubble
        message={{ ...groupMessage, senderJid: '60123456789@s.whatsapp.net' }}
        showSender
        outboundLabel={null}
        quoted={null}
      />,
    );
    expect(screen.getByText('+60123456789')).toBeTruthy();
  });
});

describe('MessageBubble voice note transcript', () => {
  const voice: Message = {
    ...groupMessage,
    id: 'V-1',
    chatJid: '60123456789@s.whatsapp.net',
    type: 'audio',
    body: null,
    mediaUrl: '/api/media/V-1',
    mediaMime: 'audio/ogg; codecs=opus',
    mediaStatus: 'ok',
  };
  const bubble = (message: Message) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageBubble message={message} showSender={false} outboundLabel={null} quoted={null} />
      </QueryClientProvider>,
    );

  it('shows the transcript under the audio player', () => {
    const view = bubble({
      ...voice,
      transcript: 'Do you deliver to Penang?',
      transcriptLang: 'en',
      transcriptStatus: 'ok',
    });
    const transcript = screen.getByTestId('voice-transcript');
    expect(transcript.textContent).toBe('Transcript: Do you deliver to Penang?');
    expect(transcript.className).toContain('italic');
    expect(transcript.className).toContain('text-muted-foreground');
    expect(view.container.querySelector('audio')).toBeTruthy();
  });

  it('shows a subtle status while transcribing or when it failed, and nothing otherwise', () => {
    bubble({ ...voice, transcriptStatus: 'pending' });
    expect(screen.getByText('Transcribing…')).toBeTruthy();
    cleanup();
    bubble({ ...voice, transcriptStatus: 'failed' });
    expect(screen.getByText('Couldn’t transcribe this voice note')).toBeTruthy();
    cleanup();
    const view = bubble({ ...voice, transcriptStatus: 'skipped' });
    expect(view.container.textContent).not.toMatch(/transcri/i);
    cleanup();
    const plain = bubble(voice);
    expect(plain.container.textContent).not.toMatch(/transcri/i);
  });
});
