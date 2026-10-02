import { useRef } from 'react';
import { useRealtime } from '../api/socket';
import { Banner } from '@/components/app';

/**
 * Shown while the realtime (Socket.IO) link to the server is down after having been up once,
 * so agents know the inbox may be stale. Pure on `connected` (exported for tests).
 */
export function ReconnectBannerView({ connected }: { connected: boolean }) {
  const everConnected = useRef(false);
  if (connected) everConnected.current = true;
  if (connected || !everConnected.current) return null;
  return (
    <div className="border-b bg-surface px-3 py-2">
      <Banner tone="warning" title="Reconnecting to server…">
        New messages and updates may be delayed until the connection is back.
      </Banner>
    </div>
  );
}

export function ReconnectBanner() {
  const { connected } = useRealtime();
  return <ReconnectBannerView connected={connected} />;
}
