import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
