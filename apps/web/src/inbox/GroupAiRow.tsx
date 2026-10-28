import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import type { AiGroupChat } from '@ezychat/shared';
import { useGroupChatAi, useSetGroupChatAi } from '../api/ai-groups';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { errorMessage } from '../api/client';

/** The AI answers tags and quotes in this group now (its switch and the agent's are both on). */
export const groupAiActive = (ai: AiGroupChat | null | undefined): boolean =>
  Boolean(ai?.enabled && ai.agentAnswersGroups);

/**
 * Group info → "AI agent answers when tagged or quoted". Admins switch it; agents see the state.
 * Disabled with a hint while the agent's "Answer in groups" is off. Hidden when the server does not
 * answer (an older server, or no access).
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
            : t('aiGroups.info.hint', { name: agentName });

  return (
    <section
      className="mx-4 mt-2 rounded-lg border bg-muted/40 px-3 py-2"
      aria-labelledby={id}
      data-testid="group-ai-row"
    >
      <div className="flex items-center gap-3">
        <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label
          htmlFor={isAdmin ? id : undefined}
          id={isAdmin ? undefined : id}
          className="min-w-0 flex-1 text-sm leading-snug"
        >
          {t('aiGroups.info.title')}
        </Label>
        {isAdmin ? (
          <Label
            htmlFor={id}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id={id}
              aria-describedby={hintId}
              checked={active}
              disabled={ai.agentId === null || !ai.agentAnswersGroups || setGroup.isPending}
              onCheckedChange={(enabled) =>
                setGroup.mutate({ jid, enabled }, { onError: (e) => toast.error(errorMessage(e)) })
              }
            />
          </Label>
        ) : (
          <Badge
            variant={active ? 'secondary' : 'outline'}
            className="shrink-0"
            data-testid="group-ai-state"
          >
            {active ? t('aiGroups.info.on') : t('aiGroups.info.off')}
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

/** Chat header badge on a group where the AI answers when tagged or quoted (or is paused there). */
export function GroupAiBadge({ ai }: Readonly<{ ai: AiGroupChat | null | undefined }>) {
  const { t } = useTranslation('inbox');
  if (!ai || !groupAiActive(ai)) return null;
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
        {ai.paused ? t('aiGroups.badgePaused') : t('aiGroups.badge')}
      </span>
    </Badge>
  );
}
