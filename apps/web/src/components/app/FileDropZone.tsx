import type React from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { filesFromTransfer, hasFiles } from '@/lib/file-transfer';

export interface FileDropZoneProps extends React.ComponentPropsWithoutRef<'section'> {
  /** False: the drop is refused with a note (sending is blocked, or the reply window is closed). */
  enabled: boolean;
  onFiles(files: File[]): void;
  /** The element to render (a conversation is a `section`). */
  as?: 'section' | 'div';
  /** Overlay texts; default to the conversation's ("Drop files to send them in this chat"). */
  title?: string;
  hint?: string;
  blockedText?: string;
}

/**
 * A drop target for files dragged from the desktop (the conversation, Business context): they show
 * an overlay and, when dropped, go to `onFiles`. Text or links dragged inside the page are left alone.
 */
export function FileDropZone({
  enabled,
  onFiles,
  as: Tag = 'section',
  title,
  hint,
  blockedText,
  className,
  children,
  ...rest
}: Readonly<FileDropZoneProps>) {
  const { t } = useTranslation('inbox');
  const [active, setActive] = useState(false);
  // dragenter/dragleave fire for every child crossed: count them so the overlay does not flicker.
  const depth = useRef(0);

  function reset() {
    depth.current = 0;
    setActive(false);
  }

  return (
    <Tag
      {...rest}
      className={cn('relative', className)}
      onDragEnter={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        depth.current += 1;
        setActive(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        reset();
        if (enabled) onFiles(filesFromTransfer(e.dataTransfer));
      }}
    >
      {children}
      {active && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex p-3"
          data-testid="file-drop-overlay"
          role="status"
        >
          <div
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-background/95 p-6 text-center',
              enabled ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
            )}
          >
            {enabled ? (
              <>
                <Upload className="size-8 text-primary" aria-hidden="true" />
                <p className="text-base font-semibold">{title ?? t('composer.files.drop')}</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  {hint ?? t('composer.files.dropHint')}
                </p>
              </>
            ) : (
              <>
                <Ban className="size-8" aria-hidden="true" />
                <p className="text-sm font-medium">
                  {blockedText ?? t('composer.files.dropBlocked')}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </Tag>
  );
}
