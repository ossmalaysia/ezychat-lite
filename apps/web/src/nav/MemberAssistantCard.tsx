// AI assistants for team members (docs/features/mcp-for-members/design.md, confirmed mock
// docs/features/mcp-for-members/mock): "Your account → My AI assistants". A member never creates an
// access token (those stay admins' master tokens): Claude or ChatGPT connects through its own sign-in,
// and this card lists the member's connected apps with Permissions and Disconnect.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiToken } from '@ezychat/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatRelative } from '@/lib/format';
import { useApiTokens, useMcpSettings, useRevokeApiToken } from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmDialog, CopyButton, ErrorState, ListSkeleton } from '../admin/adminUi';
import { assistantBaseUrl } from '../admin/IntegrationsSection';
import { TokenPermissionsDialog } from '../admin/TokenPermissionsDialog';

const SECTION = 'flex flex-col gap-3 rounded-xl border bg-surface p-4';

export function MemberAssistantCard() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const mcp = useMcpSettings();
  const [editing, setEditing] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const revoke = useRevokeApiToken();
  if (!user) return null;

  const closeConfirm = () => {
    setRevoking(null);
    revoke.reset();
  };
  const settings = mcp.data;
  // Members can connect only while AI assistant access and the members switch are both on.
  const canConnect = settings?.canConnect === true;
  const limited = user.chatScope === 'chosen';

  return (
    <>
      <section
        className={SECTION}
        aria-labelledby="member-assistant-title"
        data-testid="member-assistant"
      >
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <h2 id="member-assistant-title" className="text-base font-semibold">
              {t('memberAssistants.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('memberAssistants.description')}</p>
          </div>
        </div>

        {!settings ? (
          mcp.isError ? (
            <ErrorState error={mcp.error} onRetry={() => void mcp.refetch()} />
          ) : (
            <ListSkeleton rows={2} />
          )
        ) : !canConnect ? (
          <p
            className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground"
            data-testid="member-assistant-off"
          >
            {t('memberAssistants.off')}
          </p>
        ) : (
          <ConnectedApps
            endpoint={`${assistantBaseUrl(settings.publicUrl, settings.localUrl)}${settings.endpointPath}`}
            reach={limited ? t('memberAssistants.reachLimited') : t('memberAssistants.reach')}
            onEdit={setEditing}
            onRevoke={(token) => {
              revoke.reset();
              setRevoking(token);
            }}
          />
        )}
      </section>

      <TokenPermissionsDialog
        token={editing}
        onClose={() => setEditing(null)}
        member={{ canStartNewChats: settings?.canMessageNewNumbers === true }}
      />
      <ConfirmDialog
        open={revoking !== null}
        title={t('memberAssistants.disconnectTitle', { name: revoking?.name ?? '' })}
        confirmLabel={t('memberAssistants.disconnect')}
        danger
        loading={revoke.isPending}
        error={revoke.error ?? undefined}
        onConfirm={() => {
          if (!revoking) return;
          revoke.mutate(revoking.id, {
            onSuccess: () => {
              toast.success(t('memberAssistants.disconnected'));
              closeConfirm();
            },
          });
        }}
        onClose={closeConfirm}
      >
        {t('memberAssistants.disconnectBody')}
      </ConfirmDialog>
    </>
  );
}

/** How to connect, the address to add, and the member's own connected apps (the server lists only theirs). */
function ConnectedApps({
  endpoint,
  reach,
  onEdit,
  onRevoke,
}: {
  endpoint: string;
  reach: string;
  onEdit: (token: ApiToken) => void;
  onRevoke: (token: ApiToken) => void;
}) {
  const { t } = useTranslation('admin');
  const tokens = useApiTokens();
  return (
    <>
      <p className="text-sm" data-testid="member-assistant-reach">
        {reach}
      </p>
      <p className="text-sm text-muted-foreground">{t('memberAssistants.howTo')}</p>
      <div className="flex min-w-0 flex-col gap-2">
        <code
          className="rounded-md border bg-muted px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
          data-testid="member-assistant-url"
        >
          {endpoint}
        </code>
        <CopyButton
          text={endpoint}
          label={t('integrations.connectApp.copy')}
          className="self-start"
        />
      </div>
      <div className="border-t pt-3">
        <h3 className="text-sm font-medium">{t('memberAssistants.apps')}</h3>
      </div>
      {!tokens.data ? (
        tokens.isError ? (
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
        ) : (
          <ListSkeleton rows={1} />
        )
      ) : tokens.data.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="member-assistants-empty">
          {t('memberAssistants.empty')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y" aria-label={t('memberAssistants.apps')}>
          {tokens.data.map((token) => (
            <AppRow
              key={token.id}
              token={token}
              onEdit={() => onEdit(token)}
              onRevoke={() => onRevoke(token)}
            />
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{t('memberAssistants.sendNote')}</p>
    </>
  );
}

function AppRow({
  token,
  onEdit,
  onRevoke,
}: {
  token: ApiToken;
  onEdit: () => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <li
      data-testid="member-token-row"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
    >
      <p className="col-span-2 pt-2.5 leading-snug font-medium [overflow-wrap:anywhere] sm:col-span-1 md:pt-1.5">
        {token.name}
      </p>
      <div className="order-last col-span-2 -mx-2 flex items-center justify-end gap-1 sm:order-none sm:col-span-1 sm:mx-0">
        <Button
          type="button"
          variant="ghost"
          size="touch"
          className="px-2 md:min-h-8"
          aria-label={t('integrations.permissions.editLabel', { name: token.name })}
          onClick={onEdit}
        >
          {t('integrations.permissions.edit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="touch"
          className="px-2 text-danger hover:bg-danger/10 hover:text-danger md:min-h-8"
          aria-label={t('memberAssistants.disconnectLabel', { name: token.name })}
          onClick={onRevoke}
        >
          {t('memberAssistants.disconnect')}
        </Button>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground tabular-nums">
        <Badge variant="outline">{t('integrations.tokens.signedInBadge')}</Badge>
        {token.canSend && <Badge variant="outline">{t('integrations.tokens.canSendBadge')}</Badge>}
        {token.canMessageNewNumbers && (
          <Badge variant="outline" className="border-danger/50 text-danger">
            {t('integrations.tokens.canNewBadge')}
          </Badge>
        )}
        <span>{t('memberAssistants.connectedOn', { date: formatDate(token.createdAt) })}</span>
        <span>
          {token.lastUsedAt === null
            ? t('integrations.tokens.neverUsed')
            : t('integrations.tokens.lastUsed', { when: formatRelative(token.lastUsedAt) })}
        </span>
      </div>
    </li>
  );
}
