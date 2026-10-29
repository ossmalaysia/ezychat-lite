import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { AiAgentGroupsBody, AiGroupMode, AiGroupSetting } from '@ezychat/shared';
import { useAgentGroups, useSetAnswerInGroups, useSetGroupChatAi } from '../api/ai-groups';
import { Banner } from '@/components/app';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { encodeJid } from '../lib/jid';
import { ChatAvatar } from '../inbox/ChatAvatar';
import { GroupIcon } from '../inbox/ChatListItem';
import { ErrorState, ListSkeleton } from './adminUi';

/** Lite's only inbox keeps the name migration 014 gave inbox 1 (a product name, never translated). */
export const LITE_INBOX_NAME = 'WhatsApp';

const SCOPES = ['all', 'selected'] as const;
const MODES: readonly AiGroupMode[] = ['tag', 'open'];
const SETTINGS: readonly AiGroupSetting[] = ['default', 'open', 'tag', 'off'];

/** Two choices as cards with a title and a line of text (the agent page's preset style). */
function ChoiceCards<V extends string>({
  labelId,
  value,
  options,
  disabled,
  onChange,
  testId,
}: Readonly<{
  labelId: string;
  value: V;
  options: ReadonlyArray<{ value: V; title: string; text: string }>;
  disabled: boolean;
  onChange: (v: V) => void;
  testId: string;
}>) {
  const base = useId();
  return (
    <RadioGroup
      aria-labelledby={labelId}
      value={value}
      disabled={disabled}
      onValueChange={(v) => onChange(v as V)}
      className="grid gap-2 sm:grid-cols-2"
      data-testid={testId}
    >
      {options.map((o) => {
        const id = `${base}-${o.value}`;
        return (
          <Label
            key={o.value}
            htmlFor={id}
            className={cn(
              'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-lg border bg-card p-3 font-normal transition-colors',
              'hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
              'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
            )}
          >
            <span className="flex w-full items-center gap-2">
              <span className="font-medium">{o.title}</span>
              <RadioGroupItem id={id} value={o.value} className="ml-auto" />
            </span>
            <span className="text-sm text-muted-foreground">{o.text}</span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}

/**
 * Agent page → Groups (designs docs/features/ai-groups/design.md and
 * docs/features/ai-groups-open-chat/design.md): the agent's "Answer in groups" switch and, when on,
 * which groups (all groups, new ones too, or the selected ones only), the default mode (Tag and
 * quote or Open chat) and the groups of the agent's inbox, each with its own choice and a link to
 * the group chat. The same per-group choice is in the group's info panel.
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
  const ids = { switch: useId(), scope: useId(), mode: useId() };
  const q = useAgentGroups(agentId);
  const setAgent = useSetAnswerInGroups(agentId);
  const setGroup = useSetGroupChatAi();
  const fail = () => toast.error(t('aiGroups.saveFailed'));
  const save = (body: AiAgentGroupsBody) => setAgent.mutate(body, { onError: fail });
  const groups = q.data?.groups ?? [];
  const on = Boolean(q.data?.enabled);
  // The server names the agent's inbox; the page's name stands in for an older server.
  const inbox = q.data?.inboxName ?? inboxName ?? '';
  const modeName = (mode: AiGroupMode) => t(`aiGroups.mode.${mode}.title`);
  const settingLabel = (s: AiGroupSetting) =>
    s === 'default'
      ? t('aiGroups.setting.default', { mode: modeName(q.data?.mode ?? 'tag') })
      : t(`aiGroups.setting.${s}`);

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
                <Label htmlFor={ids.switch}>{t('aiGroups.switch')}</Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('aiGroups.switchHint', { name })}
                </p>
              </div>
              <Label
                htmlFor={ids.switch}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
              >
                <Switch
                  id={ids.switch}
                  data-testid="answer-in-groups"
                  checked={on}
                  disabled={setAgent.isPending}
                  onCheckedChange={(enabled) => save({ enabled })}
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
                <div className="flex flex-col gap-2">
                  <p id={ids.scope} className="text-sm font-medium">
                    {t('aiGroups.scopeLabel')}
                  </p>
                  <ChoiceCards
                    labelId={ids.scope}
                    value={q.data.scope}
                    disabled={setAgent.isPending}
                    onChange={(scope) => save({ scope })}
                    testId="groups-scope"
                    options={SCOPES.map((s) => ({
                      value: s,
                      title: t(`aiGroups.scope.${s}.title`),
                      text: t(`aiGroups.scope.${s}.text`, { inbox }),
                    }))}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <p id={ids.mode} className="text-sm font-medium">
                    {t('aiGroups.modeLabel', { name })}
                  </p>
                  <ChoiceCards
                    labelId={ids.mode}
                    value={q.data.mode}
                    disabled={setAgent.isPending}
                    onChange={(mode) => save({ mode })}
                    testId="groups-mode"
                    options={MODES.map((m) => ({
                      value: m,
                      title: modeName(m),
                      text: t(`aiGroups.mode.${m}.text`, { name }),
                    }))}
                  />
                  {groups.some((g) => g.mode === 'open') && (
                    <p className="text-xs text-muted-foreground" data-testid="open-chat-cost">
                      {t('aiGroups.openCost', { name })}
                    </p>
                  )}
                </div>

                {!groups.some((g) => g.mode !== 'off') && (
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
                    <li
                      key={g.jid}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
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
                              g.mode !== 'off' && g.paused && 'text-warning',
                            )}
                          >
                            {g.memberCount != null &&
                              `${t('aiGroups.members', { count: g.memberCount })} · `}
                            {g.mode === 'off'
                              ? t('aiGroups.off')
                              : g.paused
                                ? t('aiGroups.paused')
                                : modeName(g.mode)}
                          </span>
                        </Link>
                      </div>
                      <Select
                        value={g.setting}
                        disabled={setGroup.isPending}
                        onValueChange={(setting) =>
                          setGroup.mutate(
                            { jid: g.jid, setting: setting as AiGroupSetting },
                            { onError: fail },
                          )
                        }
                      >
                        <SelectTrigger
                          className="min-h-11 w-full sm:w-56"
                          aria-label={t('aiGroups.answerIn', { group: g.name })}
                          data-testid="group-setting"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SETTINGS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {settingLabel(s)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  <li>{t('aiGroups.sensitive', { name })}</li>
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
