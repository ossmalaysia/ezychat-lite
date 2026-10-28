import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAgentGroups, useSetAnswerInGroups, useSetGroupChatAi } from '../api/ai-groups';
import { Banner } from '@/components/app';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { encodeJid } from '../lib/jid';
import { ChatAvatar } from '../inbox/ChatAvatar';
import { GroupIcon } from '../inbox/ChatListItem';
import { ErrorState, ListSkeleton } from './adminUi';

/** Lite's only inbox keeps the name migration 014 gave inbox 1 (a product name, never translated). */
export const LITE_INBOX_NAME = 'WhatsApp';

/**
 * Agent page → Groups (design docs/features/ai-groups/design.md): the agent's "Answer in groups
 * (when tagged or quoted)" switch and, when on, the groups of the agent's inbox, each with its own
 * switch (new groups start off) and a link to the group chat. The same per-group switch is in the
 * group's info panel.
 */
export function AgentGroupsCard({
  agentId,
  name,
  agentEnabled,
  inboxName,
}: Readonly<{
  agentId: number;
  name: string;
  /** The agent's saved on/off. */
  agentEnabled: boolean;
  /** The name of the agent's inbox; null = the agent answers no inbox. */
  inboxName: string | null;
}>) {
  const { t } = useTranslation('admin');
  const switchId = useId();
  const q = useAgentGroups(agentId);
  const setAgent = useSetAnswerInGroups(agentId);
  const setGroup = useSetGroupChatAi();
  const fail = () => toast.error(t('aiGroups.saveFailed'));
  const groups = q.data?.groups ?? [];
  const on = Boolean(q.data?.enabled);
  // The server names the agent's inbox; the page's name stands in for an older server.
  const inbox = q.data?.inboxName ?? inboxName ?? '';

  return (
    <Card className="gap-4" data-testid="agent-groups">
      <CardHeader>
        <CardTitle>{t('aiGroups.title')}</CardTitle>
        {inboxName !== null && (
          <CardDescription>{t('aiGroups.description', { name, inbox })}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {inboxName === null ? (
          <p className="text-sm text-muted-foreground">{t('aiGroups.noInbox', { name })}</p>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <ListSkeleton rows={2} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
              <div className="min-w-0">
                <Label htmlFor={switchId}>{t('aiGroups.switch')}</Label>
                <p className="mt-1 text-sm text-muted-foreground">{t('aiGroups.switchHint')}</p>
              </div>
              <Label
                htmlFor={switchId}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
              >
                <Switch
                  id={switchId}
                  data-testid="answer-in-groups"
                  checked={on}
                  disabled={setAgent.isPending}
                  onCheckedChange={(enabled) => setAgent.mutate(enabled, { onError: fail })}
                />
              </Label>
            </div>

            {on && !agentEnabled && (
              <Banner tone="warning">{t('aiGroups.agentOff', { name })}</Banner>
            )}

            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="groups-none">
                {t('aiGroups.noGroups', { inbox })}
              </p>
            ) : !on ? (
              <p className="text-sm text-muted-foreground" data-testid="groups-off">
                {t('aiGroups.offSummary', { count: groups.length, inbox, name })}
              </p>
            ) : (
              <>
                {!groups.some((g) => g.enabled) && (
                  <p className="text-sm text-muted-foreground" data-testid="groups-none-on">
                    {t('aiGroups.noneOn', { name })}
                  </p>
                )}
                <ul
                  className="flex flex-col divide-y rounded-lg border"
                  aria-label={t('aiGroups.listLabel', { inbox })}
                  data-testid="agent-group-list"
                >
                  {groups.map((g) => (
                    <li key={g.jid} className="flex items-center gap-3 px-3 py-2">
                      <ChatAvatar name={g.name} seed={g.jid} size="sm" />
                      <Link
                        to={`/chats/${encodeJid(g.jid)}`}
                        aria-label={t('aiGroups.openGroup', { group: g.name })}
                        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        <span className="flex min-w-0 items-start gap-1 text-sm font-medium">
                          <GroupIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          <span className="[overflow-wrap:anywhere]">{g.name}</span>
                        </span>
                        <span
                          className={cn(
                            'text-xs text-muted-foreground',
                            g.enabled && g.paused && 'text-warning',
                          )}
                        >
                          {g.memberCount != null &&
                            `${t('aiGroups.members', { count: g.memberCount })} · `}
                          {!g.enabled
                            ? t('aiGroups.off')
                            : g.paused
                              ? t('aiGroups.paused')
                              : t('aiGroups.answers')}
                        </span>
                      </Link>
                      <Label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                        <Switch
                          checked={g.enabled}
                          aria-label={t('aiGroups.answerIn', { group: g.name })}
                          disabled={setGroup.isPending}
                          onCheckedChange={(enabled) =>
                            setGroup.mutate({ jid: g.jid, enabled }, { onError: fail })
                          }
                        />
                      </Label>
                    </li>
                  ))}
                </ul>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  <li>{t('aiGroups.loopGuard', { count: q.data.loopGuard, name })}</li>
                  <li>{t('aiGroups.lookupsOnly', { name })}</li>
                </ul>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
