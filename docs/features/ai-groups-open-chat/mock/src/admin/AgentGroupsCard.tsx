import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
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
import type { MockAgent } from '../mock/agents';
import { inboxOfChat, useMockInboxes } from '../mock/inboxes';
import {
  useMockGroups,
  useSetAnswerInGroups,
  useSetGroupAnswers,
  type GroupMode,
  type GroupSetting,
  type MockAgentGroups,
} from '../mock/groups';
import { GroupsMockControls } from '../mock/GroupsMockControls';

const SCOPES = ['all', 'selected'] as const;
const MODES: readonly GroupMode[] = ['tag', 'open'];
const SETTINGS: readonly GroupSetting[] = ['default', 'open', 'tag', 'off'];

/** Two or more choices as cards with a title and a line of text (the agent page's preset style). */
function ChoiceCards<V extends string>({
  labelId,
  value,
  options,
  disabled,
  onChange,
  testId,
}: {
  labelId: string;
  value: V;
  options: ReadonlyArray<{ value: V; title: string; text: string }>;
  disabled: boolean;
  onChange: (v: V) => void;
  testId: string;
}) {
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
 * Proposed (ai-groups, ai-groups-open-chat): agent page → Groups. The agent's "Answer in groups"
 * switch and, when on: which groups (all groups, new ones too, or the selected groups only), how
 * the agent answers there by default (Tag and quote or Open chat), and the groups of the agent's
 * inbox, each with its own choice (the agent's mode, Open chat, Tag and quote or Off) and a link to
 * the group chat. The same per-group choice is in the group's info panel.
 */
export function AgentGroupsCard({
  agent,
  name,
}: Readonly<{ agent: Pick<MockAgent, 'id' | 'inboxId' | 'enabled'>; name: string }>) {
  const { t } = useTranslation('admin');
  const ids = { switch: useId(), scope: useId(), mode: useId() };
  const inboxes = useMockInboxes();
  const q = useMockGroups();
  const setAgent = useSetAnswerInGroups();
  const setGroup = useSetGroupAnswers();
  const inbox = inboxes.inboxes.find((i) => i.id === agent.inboxId);
  const groups = (q.data?.groups ?? []).filter(
    (g) => inbox && inboxOfChat(inboxes, g.jid)?.id === inbox.id,
  );
  const settings: MockAgentGroups = q.data?.agents[agent.id] ?? {
    on: false,
    scope: 'selected',
    mode: 'tag',
  };
  const on = settings.on;
  const fail = () => toast.error(t('mockGroups.saveFailed'));
  const save = (patch: Partial<MockAgentGroups> & { enabled?: boolean }) =>
    setAgent.mutate({ agentId: agent.id, ...patch }, { onError: fail });
  const inboxName = inbox?.name ?? '';
  const modeName = (mode: GroupMode) => t(`mockGroups.mode.${mode}.title`);
  const settingLabel = (s: GroupSetting) =>
    s === 'default'
      ? t('mockGroups.setting.default', { mode: modeName(settings.mode) })
      : t(`mockGroups.setting.${s}`);
  const anyOpen = groups.some((g) => g.mode === 'open');

  return (
    <Card className="gap-4" data-testid="agent-groups">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('mockGroups.title')}</CardTitle>
          <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
        </div>
        {inbox && (
          <CardDescription>
            {t('mockGroups.description', { name, inbox: inboxName })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!inbox ? (
          <p className="text-sm text-muted-foreground">{t('mockGroups.noInbox', { name })}</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
              <div className="min-w-0">
                <Label htmlFor={ids.switch}>{t('mockGroups.switch')}</Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('mockGroups.switchHint', { name })}
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
                  disabled={!q.data || setAgent.isPending}
                  onCheckedChange={(enabled) => save({ enabled })}
                />
              </Label>
            </div>

            {on && !agent.enabled && (
              <Banner tone="warning">{t('mockGroups.agentOff', { name })}</Banner>
            )}

            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="groups-none">
                {t('mockGroups.noGroups', { inbox: inboxName })}
              </p>
            ) : !on ? (
              <p className="text-sm text-muted-foreground" data-testid="groups-off">
                {t('mockGroups.offSummary', { count: groups.length, inbox: inboxName, name })}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <p id={ids.scope} className="text-sm font-medium">
                    {t('mockGroups.scopeLabel')}
                  </p>
                  <ChoiceCards
                    labelId={ids.scope}
                    value={settings.scope}
                    disabled={setAgent.isPending}
                    onChange={(scope) => save({ scope })}
                    testId="groups-scope"
                    options={SCOPES.map((s) => ({
                      value: s,
                      title: t(`mockGroups.scope.${s}.title`),
                      text: t(`mockGroups.scope.${s}.text`, { inbox: inboxName }),
                    }))}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <p id={ids.mode} className="text-sm font-medium">
                    {t('mockGroups.modeLabel', { name })}
                  </p>
                  <ChoiceCards
                    labelId={ids.mode}
                    value={settings.mode}
                    disabled={setAgent.isPending}
                    onChange={(mode) => save({ mode })}
                    testId="groups-mode"
                    options={MODES.map((m) => ({
                      value: m,
                      title: modeName(m),
                      text: t(`mockGroups.mode.${m}.text`, { name }),
                    }))}
                  />
                  {anyOpen && (
                    <p className="text-xs text-muted-foreground" data-testid="open-chat-cost">
                      {t('mockGroups.openCost', { name })}
                    </p>
                  )}
                </div>

                {!groups.some((g) => g.mode !== 'off') && (
                  <p className="text-sm text-muted-foreground" data-testid="groups-none-on">
                    {t('mockGroups.noneOn', { name })}
                  </p>
                )}
                <ul
                  className="flex flex-col divide-y rounded-lg border"
                  aria-label={t('mockGroups.listLabel', { inbox: inboxName })}
                  data-testid="agent-group-list"
                >
                  {groups.map((g) => {
                    const status =
                      g.mode === 'off'
                        ? t('mockGroups.off')
                        : g.paused
                          ? t('mockGroups.paused')
                          : modeName(g.mode);
                    return (
                      <li
                        key={g.jid}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                      >
                        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                          <ChatAvatar name={g.name} seed={g.jid} size="sm" />
                          <Link
                            to={`/chats/${encodeJid(g.jid)}`}
                            aria-label={t('mockGroups.openGroup', { group: g.name })}
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
                              {g.size != null && `${t('mockGroups.members', { count: g.size })} · `}
                              {status}
                            </span>
                          </Link>
                        </div>
                        <Select
                          value={g.setting}
                          disabled={setGroup.isPending}
                          onValueChange={(setting) =>
                            setGroup.mutate(
                              { jid: g.jid, setting: setting as GroupSetting },
                              { onError: fail },
                            )
                          }
                        >
                          <SelectTrigger
                            className="min-h-11 w-full sm:w-56"
                            aria-label={t('mockGroups.answerIn', { group: g.name })}
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
                    );
                  })}
                </ul>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  <li>{t('mockGroups.sensitive', { name })}</li>
                  <li>
                    {t('mockGroups.loopGuard', {
                      count: q.data?.loopGuardAnswers ?? 10,
                      name,
                    })}
                  </li>
                  <li>{t('mockGroups.lookupsOnly', { name })}</li>
                </ul>
              </>
            )}
          </>
        )}
        <GroupsMockControls agentId={agent.id} agentName={name} />
      </CardContent>
    </Card>
  );
}
