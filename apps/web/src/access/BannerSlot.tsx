import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/app/ErrorBoundary';
import { useWebExtensions } from '@/extensions';

/**
 * The one slim bar at the top of the signed-in shell (inbox and admin). Every extension banner is
 * rendered in order; the first one that renders anything is shown and the rest stay hidden, so at
 * most one bar takes space. A crashing banner hides itself only.
 */
export function ExtensionBannerSlot() {
  const extensions = useWebExtensions();
  const banners = extensions.flatMap((ext) =>
    (ext.banners ?? []).map((Banner, index) => ({ key: `${ext.name}:${index}`, Banner })),
  );
  const slot = useRef<HTMLDivElement>(null);

  // Show only the first wrapper with content; re-run whenever a banner's output changes.
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element) return;
    const update = () => {
      let shown = false;
      for (const child of Array.from(element.children) as HTMLElement[]) {
        const filled = child.childNodes.length > 0;
        child.hidden = shown || !filled;
        if (filled && !shown) shown = true;
      }
      element.hidden = !shown;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  });

  if (banners.length === 0) return null;
  return (
    <div ref={slot} data-testid="extension-banner-slot" className="shrink-0">
      {banners.map(({ key, Banner }) => (
        <div key={key} data-banner={key}>
          <ErrorBoundary fallback={null}>
            <Banner />
          </ErrorBoundary>
        </div>
      ))}
    </div>
  );
}

const SLIM_TONE = {
  info: { cls: 'border-info/30 bg-info/10', Icon: Info, icon: 'text-info' },
  warning: { cls: 'border-warning/40 bg-warning/10', Icon: AlertTriangle, icon: 'text-warning' },
  danger: { cls: 'border-danger/30 bg-danger/10', Icon: OctagonAlert, icon: 'text-danger' },
} as const;

/**
 * A slim one-line bar for `WebExtension.banners`: icon, one line of text (truncated on small
 * screens) and an optional action such as a link button.
 */
export function SlimBanner({
  tone = 'info',
  children,
  action,
  className,
}: {
  tone?: keyof typeof SLIM_TONE;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const style = SLIM_TONE[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex min-h-11 items-center gap-2 border-b px-3 py-1 text-sm text-foreground',
        style.cls,
        className,
      )}
    >
      <style.Icon className={cn('size-4 shrink-0', style.icon)} aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate">{children}</p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
