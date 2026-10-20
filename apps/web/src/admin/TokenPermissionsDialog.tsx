import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ApiToken } from '@ezychat/shared';
import { errorMessage } from '../api/client';
import { useUpdateApiToken } from '../api/queries';
import { Banner, ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Pending } from './adminUi';
import { SendPermissionFields, type SendPermissions } from './SendPermissionFields';

/**
 * The owner of a token changes whether its AI assistant may send, and message new numbers, without a
 * new token. The same options and warnings as Create token.
 */
export function TokenPermissionsDialog({
  token,
  onClose,
}: Readonly<{
  token: ApiToken | null;
  onClose: () => void;
}>) {
  const { t } = useTranslation(['admin', 'common']);
  const [perms, setPerms] = useState<SendPermissions>({ canSend: false, canNew: false });
  useEffect(() => {
    setPerms({ canSend: token?.canSend ?? false, canNew: token?.canMessageNewNumbers ?? false });
  }, [token]);
  const { canSend, canNew } = perms;
  const save = useUpdateApiToken();
  const close = () => {
    save.reset();
    onClose();
  };
  const unchanged =
    token !== null &&
    canSend === token.canSend &&
    (canSend && canNew) === token.canMessageNewNumbers;

  return (
    <ResponsiveDialog
      open={token !== null}
      onOpenChange={(next) => {
        if (!next && !save.isPending) close();
      }}
      title={t('integrations.permissions.title', { name: token?.name ?? '' })}
      description={t('integrations.permissions.description')}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="sm:min-h-9"
            disabled={save.isPending}
            onClick={close}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="button"
            size="touch"
            className="sm:min-h-9"
            disabled={save.isPending || unchanged}
            onClick={() => {
              if (!token) return;
              save.mutate(
                { id: token.id, body: { canSend, canMessageNewNumbers: canSend && canNew } },
                {
                  onSuccess: () => {
                    toast.success(t('integrations.permissions.saved'));
                    close();
                  },
                },
              );
            }}
          >
            <Pending show={save.isPending} />
            {t('integrations.permissions.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 pb-1">
        <SendPermissionFields value={perms} onChange={setPerms} disabled={save.isPending} />
        <p className="text-sm text-muted-foreground">{t('integrations.permissions.takesEffect')}</p>
        {save.error != null && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
      </div>
    </ResponsiveDialog>
  );
}
