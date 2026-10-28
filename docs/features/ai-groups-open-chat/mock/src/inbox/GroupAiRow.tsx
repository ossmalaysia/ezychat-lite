import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api/client';
import { useGroupAi, useSetGroupAnswers, type GroupSetting } from '../mock/groups';

const SETTINGS: readonly GroupSetting[] = ['default', 'open', 'tag', 'off'];

/**
 * Proposed (ai-groups, ai-groups-open-chat): Group info → "AI agent in this group". Admins choose
 * the agent's mode, Open chat, Tag and quote or Off; agents see the state. Disabled with a hint
 * while the agent's "Answer in groups" is off.
 */
export function GroupAiRow({ jid }: { jid: string }) {
  const { t } = useTranslation('inbox');
  const id = useId();
  const hintId = useId();
  const ai = useGroupAi(jid);
  const setGroup = useSetGroupAnswers();
  if (!ai.view || !ai.row) return null;
  const { agent, row } = ai;
  const agentMode = ai.agentGroups?.mode ?? 'tag';
  const label = (s: GroupSetting) =>
    s === 'default'
      ? t('mockGroups.info.setting.default', {
          name: agent?.name ?? '',
          mode: t(`mockGroups.mode.${agentMode}`),
        })
      : t(`mockGroups.info.setting.${s}`);
  const hint = !agent
    ? t('mockGroups.info.noAgent')
    : !ai.agentOn
      ? t('mockGroups.info.agentOff', { name: agent.name })
      : ai.active && row.paused
        ? t('mockGroups.info.paused')
        : row.mode === 'off'
          ? t('mockGroups.info.hintOff', { name: agent.name })
          : t(`mockGroups.info.hint.${row.mode}`, { name: agent.name });

  return (
    <section
      className="mx-4 mt-2 rounded-lg border bg-muted/40 px-3 py-2"
      aria-labelledby={id}
      data-testid="group-ai-row"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label
          htmlFor={ai.canEdit ? `${id}-select` : undefined}
          id={id}
          className="min-w-0 flex-1 text-sm leading-snug"
        >
          {t('mockGroups.info.title')}
        </Label>
        {ai.canEdit ? (
          <Select
            value={ai.agentOn ? row.setting : 'off'}
            disabled={!agent || !ai.agentOn || setGroup.isPending}
            onValueChange={(setting) =>
              setGroup.mutate(
                { jid, setting: setting as GroupSetting },
                { onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          >
            <SelectTrigger
              id={`${id}-select`}
              aria-describedby={hintId}
              className="min-h-11 w-full bg-surface sm:w-52"
              data-testid="group-ai-setting"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SETTINGS.map((s) => (
                <SelectItem key={s} value={s}>
                  {label(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge
            variant={ai.active ? 'secondary' : 'outline'}
            className="shrink-0"
            data-testid="group-ai-state"
          >
            {ai.active && row.mode !== 'off'
              ? t(`mockGroups.mode.${row.mode}`)
              : t('mockGroups.info.off')}
          </Badge>
        )}
      </div>
      <p id={hintId} className="mt-1 pl-7 text-xs text-muted-foreground">
        {hint}
        {agent && !ai.agentOn && ai.canEdit && (
          <>
            {' '}
            <Link
              to={`/admin/members/ai/${encodeURIComponent(agent.id)}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('mockGroups.info.openAgent', { name: agent.name })}
            </Link>
          </>
        )}
      </p>
      {!ai.canEdit && (
        <p className="mt-0.5 pl-7 text-xs text-muted-foreground">{t('mockGroups.info.readOnly')}</p>
      )}
    </section>
  );
}

/** Proposed (ai-groups, ai-groups-open-chat): chat header badge on a group where the AI answers. */
export function GroupAiBadge({ jid }: { jid: string }) {
  const { t } = useTranslation('inbox');
  const ai = useGroupAi(jid);
  if (!ai.active || !ai.row || ai.row.mode === 'off') return null;
  const paused = ai.row.paused;
  return (
    <Badge
      variant="outline"
      className={cn(
        'min-w-0 shrink gap-1 font-normal',
        paused ? 'border-warning/40 text-warning' : 'border-primary/30 text-primary',
      )}
      data-testid="group-ai-badge"
    >
      <Bot className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {paused ? t('mockGroups.badgePaused') : t(`mockGroups.badge.${ai.row.mode}`)}
      </span>
    </Badge>
  );
}
