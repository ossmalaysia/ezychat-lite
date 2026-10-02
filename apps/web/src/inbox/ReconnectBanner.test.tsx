import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReconnectBannerView } from './ReconnectBanner';

afterEach(cleanup);

describe('ReconnectBanner', () => {
  it('stays hidden before the first connect, shows after a drop, hides on reconnect', () => {
    const { rerender } = render(<ReconnectBannerView connected={false} />);
    expect(screen.queryByText(/Reconnecting to server/)).toBeNull();
    rerender(<ReconnectBannerView connected />);
    expect(screen.queryByText(/Reconnecting to server/)).toBeNull();
    rerender(<ReconnectBannerView connected={false} />);
    expect(screen.getByText(/Reconnecting to server/)).toBeTruthy();
    rerender(<ReconnectBannerView connected />);
    expect(screen.queryByText(/Reconnecting to server/)).toBeNull();
  });
});
