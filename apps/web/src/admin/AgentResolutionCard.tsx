import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSetResolutionCheck } from '../api/ai';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Agent page → "Ask if the question is answered": on, the agent ends an answer with a resolution
 * question and may close the chat on a clear "yes"; off (sales default), it adds no check-in line
 * and closes a chat only on a plain "thanks" (with a 👍). Saves at once, like the Groups switch.
 */
export function AgentResolutionCard({
  agentId,
  name,
  enabled,
}: Readonly<{ agentId: number; name: string; enabled: boolean }>) {
  const { t } = useTranslation('admin');
  const switchId = useId();
  const save = useSetResolutionCheck(agentId);
  return (
    <Card className="gap-4" data-testid="agent-resolution">
      <CardHeader>
        <CardTitle>{t('ai.resolution.title')}</CardTitle>
        <CardDescription>{t('ai.resolution.description', { name })}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
          <div className="min-w-0">
            <Label htmlFor={switchId}>{t('ai.resolution.switch')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {enabled ? t('ai.resolution.onHint', { name }) : t('ai.resolution.offHint', { name })}
            </p>
          </div>
          <Label
            htmlFor={switchId}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id={switchId}
              data-testid="resolution-check"
              checked={enabled}
              disabled={save.isPending}
              onCheckedChange={(next) =>
                save.mutate(next, { onError: () => toast.error(t('ai.resolution.saveFailed')) })
              }
            />
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
