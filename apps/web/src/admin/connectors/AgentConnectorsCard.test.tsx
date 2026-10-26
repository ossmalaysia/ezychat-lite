import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { DEFAULT_BOOKING_SETTINGS } from '@ezychat/shared';
import { AgentConnectorsCard } from './AgentConnectorsCard';
import { renderAt, status, stubServer, world } from './connectors.test.helpers';

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
});
