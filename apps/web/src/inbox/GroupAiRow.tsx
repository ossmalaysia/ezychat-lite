import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import type { AiGroupChat, AiGroupSetting } from '@ezychat/shared';
import { useGroupChatAi, useSetGroupChatAi } from '../api/ai-groups';
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

const SETTINGS: readonly AiGroupSetting[] = ['default', 'open', 'tag', 'off'];

/** The AI answers in this group now (its choice is not Off and the agent answers in groups). */
export const groupAiActive = (ai: AiGroupChat | null | undefined): boolean =>
  Boolean(ai?.agentAnswersGroups && ai.mode !== 'off');

/**
 * Group info → "AI agent in this group". Admins choose the agent's default, Open chat, Tag and
 * quote or Off; agents see the mode. Disabled with a hint while the agent's "Answer in groups" is
 * off. Hidden when the server does not answer (an older server, or no access).
 */
export function GroupAiRow({ jid, isAdmin }: Readonly<{ jid: string; isAdmin: boolean }>) {
  const { t } = useTranslation('inbox');
  const id = useId();
  const hintId = useId();
  const q = useGroupChatAi(jid);
  const setGroup = useSetGroupChatAi();
  const ai = q.data;
  if (!ai) return null;
  const active = groupAiActive(ai);
  const agentName = ai.agentName ?? '';
  const hint =
    ai.agentId === null
      ? t('aiGroups.info.noAgent')
      : !ai.agentEnabled
        ? t('aiGroups.info.agentDisabled', { name: agentName })
        : !ai.agentAnswersGroups
          ? t('aiGroups.info.agentOff', { name: agentName })
          : active && ai.paused
            ? t('aiGroups.info.paused')
            : ai.mode === 'off'
              ? t('aiGroups.info.hintOff', { name: agentName })
              : t(`aiGroups.info.hint.${ai.mode}`, { name: agentName });
  const label = (s: AiGroupSetting) =>
    s === 'default'
      ? t('aiGroups.info.setting.default', {
          name: agentName,
          mode: t(`aiGroups.mode.${ai.agentMode}`),
        })
      : t(`aiGroups.info.setting.${s}`);
  const selectId = `${id}-choice`;

  return (
    <section
      className="mx-4 mt-2 rounded-lg border bg-muted/40 px-3 py-2"
      aria-labelledby={id}
      data-testid="group-ai-row"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label
          id={id}
          htmlFor={isAdmin ? selectId : undefined}
          className="min-w-0 flex-1 text-sm leading-snug"
        >
          {t('aiGroups.info.title')}
        </Label>
        {/* The choice goes on its own line: the Group info panel is narrow at every width. */}
        {isAdmin ? (
          <Select
            value={ai.agentAnswersGroups ? ai.setting : 'off'}
            disabled={ai.agentId === null || !ai.agentAnswersGroups || setGroup.isPending}
            onValueChange={(setting) =>
              setGroup.mutate(
                { jid, setting: setting as AiGroupSetting },
                { onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          >
            <SelectTrigger
              id={selectId}
              aria-describedby={hintId}
              className="ml-7 min-h-11 w-[calc(100%-1.75rem)] basis-full bg-surface"
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
            variant={active ? 'secondary' : 'outline'}
            className="shrink-0"
            data-testid="group-ai-state"
          >
            {active && ai.mode !== 'off' ? t(`aiGroups.mode.${ai.mode}`) : t('aiGroups.info.off')}
          </Badge>
        )}
      </div>
      <p id={hintId} className="mt-1 pl-7 text-xs text-muted-foreground">
        {hint}
        {ai.agentId !== null && !ai.agentAnswersGroups && isAdmin && (
          <>
            {' '}
            <Link
              to={`/admin/members/ai/${ai.agentId}`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {t('aiGroups.info.openAgent', { name: agentName })}
            </Link>
          </>
        )}
      </p>
      {!isAdmin && (
        <p className="mt-0.5 pl-7 text-xs text-muted-foreground">{t('aiGroups.info.readOnly')}</p>
      )}
    </section>
  );
}

/** Chat header badge on a group where the AI answers (its mode), or is paused there. */
export function GroupAiBadge({ ai }: Readonly<{ ai: AiGroupChat | null | undefined }>) {
  const { t } = useTranslation('inbox');
  if (!ai || !groupAiActive(ai) || ai.mode === 'off') return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        'min-w-0 shrink gap-1 font-normal',
        ai.paused ? 'border-warning/40 text-warning' : 'border-primary/30 text-primary',
      )}
      data-testid="group-ai-badge"
    >
      <Bot className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {ai.paused ? t('aiGroups.badgePaused') : t(`aiGroups.badge.${ai.mode}`)}
      </span>
    </Badge>
  );
}
