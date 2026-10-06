import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Chat } from '@wa-team-inbox/shared';
import { ChatListItem } from './ChatListItem';

const lidChat: Chat = {
  jid: '123456789012345@lid',
  type: 'dm',
  name: '',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: null,
  lastMessagePreview: 'hello',
  status: 'open',
  assignedTo: null,
  updatedAt: 0,
  phone: null,
};

afterEach(cleanup);

describe('ChatListItem identity', () => {
  it('never shows WhatsApp ID digits as the chat name', () => {
    const view = render(
      <MemoryRouter>
        <ChatListItem chat={lidChat} active={false} assigneeName={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Unknown contact')).toBeTruthy();
    expect(view.container.textContent).not.toContain('123456789012345');
  });

  it('uses +phone when the chat has no name', () => {
    render(
      <MemoryRouter>
        <ChatListItem
          chat={{ ...lidChat, phone: '60123456789' }}
          active={false}
          assigneeName={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('+60123456789')).toBeTruthy();
  });
});

describe('ChatListItem tags', () => {
  it('shows up to two tags and a +N count', () => {
    render(
      <MemoryRouter>
        <ChatListItem
          chat={{ ...lidChat, name: 'Farah', tags: ['VIP', 'Wholesale', 'Halal', 'Repeat'] }}
          active={false}
          assigneeName={null}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText('Wholesale')).toBeTruthy();
    expect(screen.queryByText('Halal')).toBeNull();
    const more = screen.getByText('+2');
    expect(more.getAttribute('title')).toBe('Halal, Repeat');
  });

  it('shows no tag chips without tags', () => {
    const view = render(
      <MemoryRouter>
        <ChatListItem chat={{ ...lidChat, name: 'Farah' }} active={false} assigneeName={null} />
      </MemoryRouter>,
    );
    expect(view.container.textContent).not.toContain('+');
  });
});
