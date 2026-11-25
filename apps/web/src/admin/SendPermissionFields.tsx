import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner } from '@/components/app';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export interface SendPermissions {
  canSend: boolean;
  /** Only meaningful while canSend is on; turning canSend off clears it. */
  canNew: boolean;
  /** Resolve and reopen chats (scope `inbox:manage`); independent of sending. */
  canResolve: boolean;
}

/**
 * "Can send WhatsApp messages" and, under it, "Can also message new numbers", each with its warning,
 * then "Can resolve chats". Shared by Create token and the Permissions dialog, so both show the same
 * rules and texts.
 */
export function SendPermissionFields({
  value,
  onChange,
  disabled,
}: Readonly<{
  value: SendPermissions;
  onChange: (next: SendPermissions) => void;
  disabled: boolean;
}>) {
  const { t } = useTranslation('admin');
  const canSendId = useId();
  const canNewId = useId();
  const canResolveId = useId();
  const { canSend, canNew, canResolve } = value;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <Checkbox
          id={canSendId}
          checked={canSend}
          disabled={disabled}
          onCheckedChange={(v) =>
            onChange({ ...value, canSend: v === true, canNew: v === true && canNew })
          }
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={canSendId}>{t('integrations.create.canSend')}</Label>
          <p className="text-sm text-muted-foreground">{t('integrations.create.canSendHint')}</p>
        </div>
      </div>
      {canSend && <Banner tone="warning">{t('integrations.create.canSendWarning')}</Banner>}
      {/* Messaging new numbers: only under "Can send", off by default. */}
      {canSend && (
        <div className="ml-7 flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <Checkbox
              id={canNewId}
              checked={canNew}
              disabled={disabled}
              onCheckedChange={(v) => onChange({ ...value, canNew: v === true })}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor={canNewId}>{t('integrations.create.canNew')}</Label>
              <p className="text-sm text-muted-foreground">{t('integrations.create.canNewHint')}</p>
            </div>
          </div>
          {canNew && (
            <Banner tone="danger" title={t('integrations.create.canNewWarningTitle')}>
              {t('integrations.create.canNewWarning')}
            </Banner>
          )}
        </div>
      )}
      {/* Resolving chats messages nobody: no warning, only what it does. */}
      <div className="flex items-start gap-3">
        <Checkbox
          id={canResolveId}
          checked={canResolve}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ ...value, canResolve: v === true })}
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={canResolveId}>{t('integrations.create.canResolve')}</Label>
          <p className="text-sm text-muted-foreground">{t('integrations.create.canResolveHint')}</p>
        </div>
      </div>
    </div>
  );
}
