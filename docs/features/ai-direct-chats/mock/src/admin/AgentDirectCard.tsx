import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MockAgent } from '../mock/agents';
import { useMockInboxes } from '../mock/inboxes';
import { answersDirect, useMockGroups, useSetAnswerDirect } from '../mock/groups';
import { ConfirmDialog } from './adminUi';

/**
 * Proposed (ai-direct-chats): agent page → Direct chats. The agent's "Answer direct chats" switch
 * (on by default). Off + "Answer in groups" on = a group-only agent: it never answers or takes a
 * direct chat, teammates cannot assign one to it, and the direct chats it holds go back to the team.
 * Hidden for an inbox type without groups (WhatsApp Business API): such an agent always answers
 * direct chats.
 */
export function AgentDirectCard({
  agent,
  name,
}: Readonly<{ agent: Pick<MockAgent, 'id' | 'inboxId'>; name: string }>) {
  const { t } = useTranslation('admin');
  const switchId = useId();
  const inboxes = useMockInboxes();
  const q = useMockGroups();
  const set = useSetAnswerDirect();
  const [confirm, setConfirm] = useState(false);
  const inbox = inboxes.inboxes.find((i) => i.id === agent.inboxId);
  if (!inbox || inbox.type === 'business_api') return null;

  const on = answersDirect(q.data, agent.id);
  const groupsOn = Boolean(q.data?.agents[agent.id]);
  const held = q.data?.heldDirect ?? 0;
  const save = (enabled: boolean) =>
    set.mutate(
      { agentId: agent.id, enabled },
      {
        onSuccess: () => setConfirm(false),
        onError: () => toast.error(t('mockDirect.saveFailed')),
      },
    );

  return (
    <Card className="gap-4" data-testid="agent-direct">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('mockDirect.title')}</CardTitle>
          <Badge variant="outline">{t('mockSuggest.proposed')}</Badge>
        </div>
        <CardDescription>
          {t('mockDirect.description', { name, inbox: inbox.name })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
          <div className="min-w-0">
            <Label htmlFor={switchId}>{t('mockDirect.switch')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('mockDirect.switchHint', { name })}
            </p>
          </div>
          <Label
            htmlFor={switchId}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
          >
            <Switch
              id={switchId}
              data-testid="answer-direct"
              checked={on}
              disabled={!q.data || set.isPending}
              onCheckedChange={(enabled) => {
                if (!enabled && held > 0) setConfirm(true);
                else save(enabled);
              }}
            />
          </Label>
        </div>

        {!on &&
          (groupsOn ? (
            <div data-testid="direct-group-only">
              <Banner tone="info">{t('mockDirect.groupOnly', { name })}</Banner>
            </div>
          ) : (
            <div data-testid="direct-none">
              <Banner tone="warning">{t('mockDirect.answersNothing', { name })}</Banner>
            </div>
          ))}
      </CardContent>

      <ConfirmDialog
        open={confirm}
        title={t('mockDirect.confirmTitle', { name })}
        confirmLabel={t('mockDirect.confirmAction')}
        loading={set.isPending}
        onConfirm={() => save(false)}
        onClose={() => setConfirm(false)}
      >
        {t('mockDirect.confirmBody', { count: held, name })}
      </ConfirmDialog>
    </Card>
  );
}
