import { Share } from 'lucide-react';
import { Banner } from '@/components/app';
import { needsInstallForPush } from './push';

/**
 * iOS Safari only delivers notifications to Home Screen web apps.
 * Renders nothing elsewhere (or when `force` is false and already installed).
 */
export function InstallHint({ className, force = false }: { className?: string; force?: boolean }) {
  if (!force && !needsInstallForPush()) return null;
  return (
    <Banner tone="info" title="Add to Home Screen to receive notifications" className={className}>
      Tap the Share button{' '}
      <Share
        className="inline size-4 align-text-bottom text-foreground"
        aria-label="Share"
        role="img"
      />{' '}
      in Safari, choose <strong className="text-foreground">Add to Home Screen</strong>, then open
      EzyChat Lite from your home screen and turn on notifications.
    </Banner>
  );
}

export default InstallHint;
