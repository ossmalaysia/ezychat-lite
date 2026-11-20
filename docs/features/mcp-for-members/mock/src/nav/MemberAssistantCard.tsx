// Proposed (mcp-for-members; owner decision 2026-11-20: members never create access tokens, assistants connect through
// the app sign-in): "Your account → My AI assistants" for a team member. Off: a short note. On: how to connect, the
// address to add in Claude or ChatGPT, and the member's connected apps with Permissions and Disconnect. Mock only: the
// connected apps and the admin switch live in `@/mock/members`; the dashed panel shows what the assistant gets for a
// chat outside the member's access.
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiToken } from '@ezychat/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDate, formatRelative } from '@/lib/format';
import { useMyChats } from '@/mock/memberChats';
import {
  resetMockMembers,
  revokeMemberToken,
  setMembersEnabled,
  useMemberTokens,
  useMembersEnabled,
  type MockMemberToken,
} from '@/mock/members';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmDialog, CopyButton } from '../admin/adminUi';
import { TokenPermissionsDialog } from '../admin/TokenPermissionsDialog';

const SECTION = 'flex flex-col gap-3 rounded-xl border bg-surface p-4';

function asApiToken(m: MockMemberToken): ApiToken {
  return {
    id: m.id,
    userId: 0,
    userName: m.ownerName,
    name: m.name,
    prefix: m.prefix,
    createdAt: m.createdAt,
    lastUsedAt: m.lastUsedAt,
    expiresAt: m.expiresAt,
    canSend: m.canSend,
    canMessageNewNumbers: m.canMessageNewNumbers,
    connectedApp: m.connectedApp,
    memberToken: true,
  };
}

export function MemberAssistantCard() {
  const { t } = useTranslation('admin');
  const { user } = useAuth();
  const enabled = useMembersEnabled();
  const mine = useMemberTokens().filter((x) => x.owner === user?.username);
  const chats = useMyChats();
  const [editing, setEditing] = useState<MockMemberToken | null>(null);
  const [revoking, setRevoking] = useState<MockMemberToken | null>(null);
  // The member's own scope loads from the server; show nothing until it is known (never "all chats" by mistake).
  if (!user || !chats.loaded) return null;
  // Production: the member may start a new chat in the app (New chat service: `new_chat_staff` on, not limited).
  const canStartNewChats = !chats.limited;
  const endpoint = `${window.location.origin}/mcp`;

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
              {t('mockMembers.account.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('mockMembers.account.description')}</p>
          </div>
        </div>

        {!enabled ? (
          <p
            className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground"
            data-testid="member-assistant-off"
          >
            {t('mockMembers.account.off')}
          </p>
        ) : (
          <>
            <p className="text-sm" data-testid="member-assistant-reach">
              {chats.limited
                ? t('mockMembers.account.reachLimited', { count: chats.jids.size })
                : t('mockMembers.account.reach')}
            </p>
            <p className="text-sm text-muted-foreground">{t('mockMembers.account.howTo')}</p>
            <div className="flex min-w-0 flex-col gap-2">
              <code className="rounded-md border bg-muted px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
                {endpoint}
              </code>
              <CopyButton
                text={endpoint}
                label={t('integrations.created.copyUrl')}
                className="self-start"
              />
            </div>
            <div className="border-t pt-3">
              <h3 className="text-sm font-medium">{t('mockMembers.account.apps')}</h3>
            </div>
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="member-assistants-empty">
                {t('mockMembers.account.empty')}
              </p>
            ) : (
              <ul className="flex flex-col divide-y" aria-label={t('mockMembers.account.apps')}>
                {mine.map((token) => (
                  <MemberTokenRow
                    key={token.id}
                    token={token}
                    onEdit={() => setEditing(token)}
                    onRevoke={() => setRevoking(token)}
                  />
                ))}
              </ul>
            )}
            <p className="text-sm text-muted-foreground">{t('mockMembers.account.sendNote')}</p>
          </>
        )}
      </section>

      <MockMembersPanel />

      <TokenPermissionsDialog
        token={editing ? asApiToken(editing) : null}
        onClose={() => setEditing(null)}
        member={{ canStartNewChats }}
      />
      <ConfirmDialog
        open={revoking !== null}
        title={t('mockMembers.account.disconnectTitle', { name: revoking?.name ?? '' })}
        confirmLabel={t('mockMembers.account.disconnect')}
        danger
        onConfirm={() => {
          if (revoking) revokeMemberToken(revoking.id);
          setRevoking(null);
          toast.success(t('mockMembers.account.disconnected'));
        }}
        onClose={() => setRevoking(null)}
      >
        {t('mockMembers.account.disconnectBody')}
      </ConfirmDialog>
    </>
  );
}

function MemberTokenRow({
  token,
  onEdit,
  onRevoke,
}: {
  token: MockMemberToken;
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
          aria-label={t('mockEdit.editLabel', { name: token.name })}
          onClick={onEdit}
        >
          {t('mockEdit.edit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="touch"
          className="px-2 text-danger hover:bg-danger/10 hover:text-danger md:min-h-8"
          aria-label={t('mockMembers.account.disconnectLabel', { name: token.name })}
          onClick={onRevoke}
        >
          {t('mockMembers.account.disconnect')}
        </Button>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground tabular-nums">
        {token.connectedApp && <Badge variant="outline">{t('mockMembers.appBadge')}</Badge>}
        {token.canSend && <Badge variant="outline">{t('mockSend.canSendBadge')}</Badge>}
        {token.canMessageNewNumbers && (
          <Badge variant="outline" className="border-danger/50 text-danger">
            {t('mockSend.canNewBadge')}
          </Badge>
        )}
        <span>{t('mockMembers.account.connectedOn', { date: formatDate(token.createdAt) })}</span>
        <span>
          {token.lastUsedAt === null
            ? t('integrations.tokens.neverUsed')
            : t('integrations.tokens.lastUsed', { when: formatRelative(token.lastUsedAt) })}
        </span>
      </div>
    </li>
  );
}

/** Mock only: flip the admin switch for this view, reset the demo tokens and show the "not found" answer. */
function MockMembersPanel() {
  const { t } = useTranslation('admin');
  const id = useId();
  const enabled = useMembersEnabled();
  const [shown, setShown] = useState(false);
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-dashed px-3 py-3 text-sm"
      aria-label={t('mockMembers.demo.title')}
      data-testid="members-mock-panel"
    >
      <Badge variant="outline" className="self-start">
        {t('mockMembers.demo.title')}
      </Badge>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="leading-snug">
          {t('mockMembers.demo.membersSwitch')}
        </Label>
        <Switch id={id} checked={enabled} onCheckedChange={(v) => setMembersEnabled(v)} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-medium">{t('mockMembers.demo.heading')}</p>
        <p className="text-muted-foreground">{t('mockMembers.demo.body')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="md:min-h-9"
            onClick={() => setShown(true)}
          >
            {t('mockMembers.demo.ask')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="touch"
            className="md:min-h-9"
            onClick={() => {
              resetMockMembers();
              setShown(false);
            }}
          >
            {t('mockMembers.demo.reset')}
          </Button>
        </div>
        <Link
          to="/oauth/authorize?mock=1"
          className="self-start font-medium text-primary underline-offset-4 hover:underline"
          data-testid="member-connect-app"
        >
          {t('mockMembers.demo.signInLink')}
        </Link>
        {shown && (
          <code
            className="rounded-md border bg-muted px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]"
            data-testid="members-not-found"
          >
            {t('mockMembers.demo.result')}
          </code>
        )}
      </div>
    </section>
  );
}
