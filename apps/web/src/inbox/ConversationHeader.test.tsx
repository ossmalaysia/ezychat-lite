import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Chat } from '@ezychat/shared';
import { ConversationHeader } from './ConversationHeader';
import { buildDirectory } from './useDirectory';

const base: Chat = {
  jid: '123456789012345@lid',
  inboxId: 1,
  waJid: '123456789012345@lid',
  type: 'dm',
  name: '',
  avatarUrl: null,
  unreadCount: 0,
  lastMessageAt: null,
  lastMessagePreview: null,
  status: 'open',
  assignedTo: null,
  updatedAt: 0,
  phone: null,
};

function renderHeader(
  chat: Chat,
  customer: {
    customerOpen?: boolean;
    onToggleCustomer?: () => void;
    onOpenInfo?: () => void;
    memberCount?: number | null;
  } = {},
) {
  return render(
    <ConversationHeader
      chat={chat}
      directory={buildDirectory(null, false, [])}
      onBack={vi.fn()}
      onAssign={vi.fn()}
      onToggleStatus={vi.fn()}
      notesOpen={false}
      notesCount={0}
      onToggleNotes={vi.fn()}
      showCustomer={chat.type === 'dm'}
      customerOpen={customer.customerOpen ?? false}
      onToggleCustomer={customer.onToggleCustomer ?? vi.fn()}
      onOpenInfo={customer.onOpenInfo ?? vi.fn()}
      memberCount={customer.memberCount ?? null}
    />,
  );
}

afterEach(cleanup);

describe('ConversationHeader identity', () => {
  it('shows "Unknown contact" and "Phone number hidden" for a WhatsApp ID chat, never its digits', () => {
    const view = renderHeader(base);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Unknown contact');
    expect(screen.getByText('Phone number hidden')).toBeTruthy();
    expect(view.container.textContent).not.toContain('123456789012345');
  });

  it('shows the real phone number once WhatsApp has revealed it', () => {
    renderHeader({ ...base, name: 'Aisyah', phone: '60123456789' });
    expect(screen.getByText('+60123456789')).toBeTruthy();
    expect(screen.queryByText('Phone number hidden')).toBeNull();
  });

  it('uses +phone as the title when the chat has no name', () => {
    renderHeader({
      ...base,
      jid: '60123456789@s.whatsapp.net',
      name: '60123456789',
      phone: '60123456789',
    });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('+60123456789');
  });
});

describe('ConversationHeader customer button', () => {
  it('toggles the customer details of a direct chat', async () => {
    const onToggleCustomer = vi.fn();
    renderHeader({ ...base, name: 'Farah' }, { customerOpen: true, onToggleCustomer });
    const button = screen.getByRole('button', { name: 'Customer details' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('Customer');
    fireEvent.click(button);
    expect(onToggleCustomer).toHaveBeenCalledOnce();
  });

  it('has no customer button in a group', () => {
    renderHeader({ ...base, jid: '1203@g.us', type: 'group', name: 'Team' });
    expect(screen.queryByRole('button', { name: 'Customer details' })).toBeNull();
  });
});

describe('ConversationHeader details', () => {
  it('opens group info from the group name and shows the member count', () => {
    const onOpenInfo = vi.fn();
    renderHeader(
      { ...base, jid: '1203@g.us', type: 'group', name: 'SME Founders' },
      { onOpenInfo, memberCount: 965 },
    );
    expect(screen.getByText('Group · 965 members')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open group info for SME Founders' }));
    expect(onOpenInfo).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('SME Founders');
  });

  it('opens customer details from a direct chat’s name', () => {
    const onOpenInfo = vi.fn();
    renderHeader({ ...base, name: 'Farah', phone: '60123456789' }, { onOpenInfo });
    fireEvent.click(screen.getByRole('button', { name: 'Open customer details for Farah' }));
    expect(onOpenInfo).toHaveBeenCalledOnce();
  });
});
