import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UpdateApiTokenResponse, type ApiToken } from '@ezychat/shared';
import { api, errorMessage } from '../api/client';
import { qk } from '../api/queries';
import { Banner, ResponsiveDialog } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Pending } from './adminUi';

/**
 * Proposed (token permissions): the owner of a token changes whether its AI assistant may send, and
 * message new numbers, without a new token. The same options and warnings as Create token.
 */
export function TokenPermissionsDialog({
  token,
  onClose,
}: {
  token: ApiToken | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const qc = useQueryClient();
  const canSendId = useId();
  const canNewId = useId();
  const [canSend, setCanSend] = useState(false);
  const [canNew, setCanNew] = useState(false);
  const canResolveId = useId();
  const [canResolve, setCanResolve] = useState(false);
  useEffect(() => {
    setCanSend(token?.canSend ?? false);
    setCanNew(token?.canMessageNewNumbers ?? false);
    setCanResolve(token?.canResolveChats ?? false);
  }, [token]);
  const save = useMutation({
    mutationFn: (vars: {
      id: number;
      canSend: boolean;
      canMessageNewNumbers: boolean;
      canResolveChats: boolean;
    }) =>
      api(`/integrations/tokens/${vars.id}`, {
        method: 'PATCH',
        body: {
          canSend: vars.canSend,
          canMessageNewNumbers: vars.canMessageNewNumbers,
          canResolveChats: vars.canResolveChats,
        },
        schema: UpdateApiTokenResponse,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.apiTokens }),
  });
  const close = () => {
    save.reset();
    onClose();
  };
  const unchanged =
    token !== null &&
    canSend === token.canSend &&
    (canSend && canNew) === token.canMessageNewNumbers &&
    canResolve === token.canResolveChats;

  return (
    <ResponsiveDialog
      open={token !== null}
      onOpenChange={(next) => {
        if (!next && !save.isPending) close();
      }}
      title={t('mockEdit.title', { name: token?.name ?? '' })}
      description={t('mockEdit.description')}
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
                {
                  id: token.id,
                  canSend,
                  canMessageNewNumbers: canSend && canNew,
                  canResolveChats: canResolve,
                },
                {
                  onSuccess: () => {
                    toast.success(t('mockEdit.saved'));
                    close();
                  },
                },
              );
            }}
          >
            <Pending show={save.isPending} />
            {t('mockEdit.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 pb-1">
        <div className="flex items-start gap-3">
          <Checkbox
            id={canSendId}
            checked={canSend}
            disabled={save.isPending}
            onCheckedChange={(v) => {
              setCanSend(v === true);
              if (v !== true) setCanNew(false);
            }}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor={canSendId}>{t('mockSend.canSend')}</Label>
            <p className="text-sm text-muted-foreground">{t('mockSend.canSendHint')}</p>
          </div>
        </div>
        {canSend && <Banner tone="warning">{t('mockSend.canSendWarning')}</Banner>}
        {canSend && (
          <div className="ml-7 flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <Checkbox
                id={canNewId}
                checked={canNew}
                disabled={save.isPending}
                onCheckedChange={(v) => setCanNew(v === true)}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor={canNewId}>{t('mockSend.canNew')}</Label>
                <p className="text-sm text-muted-foreground">{t('mockSend.canNewHint')}</p>
              </div>
            </div>
            {canNew && (
              <Banner tone="danger" title={t('mockSend.canNewWarningTitle')}>
                {t('mockSend.canNewWarning')}
              </Banner>
            )}
          </div>
        )}
        {/* Proposed (mcp-resolve-chat): resolve and reopen chats, on its own, off by default. */}
        <div className="flex items-start gap-3">
          <Checkbox
            id={canResolveId}
            checked={canResolve}
            disabled={save.isPending}
            onCheckedChange={(v) => setCanResolve(v === true)}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor={canResolveId} className="flex flex-wrap items-center gap-2">
              {t('mockResolve.canResolve')}
              <Badge variant="outline">{t('mockSetup.proposed')}</Badge>
            </Label>
            <p className="text-sm text-muted-foreground">{t('mockResolve.canResolveHint')}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t('mockEdit.takesEffect')}</p>
        {save.error != null && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
      </div>
    </ResponsiveDialog>
  );
}
