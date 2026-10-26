import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { DEFAULT_BOOKING_SETTINGS } from '@ezychat/shared';
import { AgentConnectorsCard } from './AgentConnectorsCard';
import {
  DEFAULT_LIST,
  connection,
  entry,
  gallery,
  listed,
  renderAt,
  status,
  stubServer,
  world,
} from './connectors.test.helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = () =>
  renderAt('/admin/members/ai/3', <AgentConnectorsCard agentId={3} name="Aina" />, {
    route: '/admin/members/ai/:agentId',
  });

describe('Agent page → Connectors', () => {
  it.each([
    [{ ...DEFAULT_BOOKING_SETTINGS, checkFree: true, book: true }, 'Checks free times and books'],
    [DEFAULT_BOOKING_SETTINGS, 'Checks free times; your team books'],
    [{ ...DEFAULT_BOOKING_SETTINGS, checkFree: false }, 'Off for this agent'],
  ])('sums up what the agent may do in Google Calendar', async (booking, summary) => {
    stubServer(world({ bookings: { 3: booking } }));
    card();
    expect(await screen.findByText(summary)).toBeTruthy();
    expect(screen.getByTestId('agent-connector-google-calendar').getAttribute('href')).toBe(
      '/admin/connectors/google-calendar?tab=settings&agent=3',
    );
    expect(screen.queryByText('Needs attention')).toBeNull();
  });

  it('marks a connector that needs attention', async () => {
    stubServer(world({ google: status('expired') }));
    card();
    expect(await screen.findByText('Needs attention')).toBeTruthy();
  });

  it('says there is no connector yet and offers the gallery', async () => {
    stubServer(world({ google: status('disconnected') }));
    card();
    expect(await screen.findByText('No connector yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse connectors' }).getAttribute('href')).toBe(
      '/admin/connectors',
    );
    expect(screen.getByText(/Systems Aina can use/)).toBeTruthy();
  });

  it('lists connected partner connectors with how many tools this agent may use', async () => {
    const tools = [
      { name: 'find', title: { en: 'Find' }, description: { en: 'Finds.' }, access: 'read' },
      { name: 'add', title: { en: 'Add' }, description: { en: 'Adds.' }, access: 'write' },
      { name: 'note', title: { en: 'Note' }, description: { en: 'Notes.' }, access: 'write' },
    ] as const;
    stubServer(
      world({
        google: status('disconnected'),
        gallery: gallery([
          ...DEFAULT_LIST,
          listed(entry('lejar', { name: 'Lejar Accounting', tools: [...tools] }), {
            connection: connection('connected'),
          }),
          listed(entry('kedai', { name: 'Kedai CRM' }), {
            connection: connection('needs_sign_in'),
            delisted: true,
          }),
          listed(entry('stok', { name: 'Stok Awan' })),
        ]),
        mcpSettings: { 'lejar:3': { settings: {}, tools: { add: true } } },
      }),
    );
    card();
    // Look-ups start on, so "find" counts until it is switched off.
    expect(await screen.findByText('2 of 3 tools on')).toBeTruthy();
    expect(screen.getByTestId('agent-connector-lejar').getAttribute('href')).toBe(
      '/admin/connectors/lejar?tab=settings&agent=3',
    );
    const kedai = screen.getByTestId('agent-connector-kedai');
    expect(kedai.textContent).toContain('Needs attention');
    expect(kedai.textContent).toContain('No longer available');
    expect(await screen.findByText('1 of 1 tools on')).toBeTruthy();
    expect(screen.queryByTestId('agent-connector-stok')).toBeNull();
    expect(screen.queryByText('No connector yet.')).toBeNull();
  });
});
