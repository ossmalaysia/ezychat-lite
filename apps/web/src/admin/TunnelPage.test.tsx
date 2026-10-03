import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Settings, TunnelStatus } from '@wa-team-inbox/shared';
import { TunnelPage } from './TunnelPage';

const hooks = vi.hoisted(() => ({
  tunnel: {} as TunnelStatus,
  settings: {} as Settings,
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../api/queries', () => ({
  useTunnel: () => ({ data: hooks.tunnel, isPending: false, isError: false }),
  useSettings: () => ({ data: hooks.settings }),
  useStartTunnel: () => ({ mutate: hooks.start, isPending: false, error: null }),
  useStopTunnel: () => ({ mutate: hooks.stop, isPending: false, error: null }),
}));
vi.mock('./CloudflareSetup', () => ({ CloudflareSetup: () => <div>Guided Cloudflare setup</div> }));

beforeEach(() => {
  hooks.tunnel = {
    mode: 'named',
    state: 'stopped',
    url: null,
    hostname: null,
    lastError: null,
    logTail: [],
  };
  hooks.settings = {
    port: 7420,
    lanEnabled: false,
    historyDays: 3,
    namedTunnelHostname: null,
    hasTunnelToken: false,
  };
  hooks.start.mockReset();
  hooks.stop.mockReset();
});
afterEach(cleanup);

it('defaults to guided domain setup and keeps manual token fields optional', async () => {
  const user = userEvent.setup();
  render(<TunnelPage />);
  expect(screen.getByText('Guided Cloudflare setup')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Public hostname' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Connect saved address' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Advanced: use a tunnel token' }));
  await user.type(screen.getByLabelText('Tunnel token'), 'a-synthetic-tunnel-token');
  await user.type(screen.getByRole('textbox', { name: 'Public hostname' }), 'inbox.example.com');
  await user.click(screen.getByRole('button', { name: 'Connect with token' }));
  expect(hooks.start).toHaveBeenCalledWith(
    { mode: 'named', token: 'a-synthetic-tunnel-token', hostname: 'inbox.example.com' },
    expect.any(Object),
  );
});

it('reconnects the saved address without using an unfinished advanced draft', async () => {
  hooks.settings = {
    ...hooks.settings,
    namedTunnelHostname: 'saved.example.com',
    hasTunnelToken: true,
  };
  const user = userEvent.setup();
  render(<TunnelPage />);
  const advanced = screen.getByRole('button', { name: 'Advanced: use a tunnel token' });
  await user.click(advanced);
  await user.type(screen.getByLabelText('Tunnel token'), 'unfinished-token-draft');
  await user.clear(screen.getByRole('textbox', { name: 'Public hostname' }));
  await user.type(screen.getByRole('textbox', { name: 'Public hostname' }), 'draft.example.com');
  await user.click(advanced);
  await user.click(screen.getByRole('button', { name: 'Connect saved address' }));
  expect(hooks.start).toHaveBeenCalledWith(
    { mode: 'named', hostname: 'saved.example.com' },
    expect.any(Object),
  );
});

it('retains account-free temporary links and the option to turn off access', async () => {
  hooks.tunnel = { ...hooks.tunnel, mode: 'off' };
  const user = userEvent.setup();
  const view = render(<TunnelPage />);
  expect(screen.queryByText('Guided Cloudflare setup')).toBeNull();
  await user.click(screen.getByRole('radio', { name: /Temporary link/ }));
  await user.click(screen.getByRole('button', { name: 'Create temporary link' }));
  expect(hooks.start).toHaveBeenCalledWith({ mode: 'quick' }, expect.any(Object));
  expect(screen.queryByText('Guided Cloudflare setup')).toBeNull();
  hooks.tunnel = { ...hooks.tunnel, state: 'running', mode: 'quick' };
  view.rerender(<TunnelPage />);
  await user.click(screen.getByRole('button', { name: 'Turn off remote access' }));
  expect(hooks.stop).toHaveBeenCalledOnce();
});
