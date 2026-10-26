import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import type { AiAgentSummary } from '@ezychat/shared';
import { useAiAgents } from '../../api/ai';
import { EmptyState } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState, ListSkeleton } from '../adminUi';

/**
 * A connector's Settings tab: one AI agent at a time (`&agent=<id>` picks it; a picker shows with
 * 2+ agents). `render` draws the chosen agent's settings.
 */
export function AgentPicker({ render }: { render: (agent: AiAgentSummary) => ReactNode }) {
  const { t } = useTranslation('admin');
  const [params, setParams] = useSearchParams();
  const agents = useAiAgents();
  if (agents.isPending) return <ListSkeleton rows={3} />;
  if (agents.error)
    return <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />;
  const list = agents.data.agents;
  const picked = Number(params.get('agent'));
  const agent = list.find((a) => a.id === picked) ?? list[0];
  if (!agent)
    return (
      <EmptyState
        title={t('connectors.noAgent')}
        action={
          <Button asChild size="touch">
            <Link to="/admin/members/ai/new">{t('connectors.addAgent')}</Link>
          </Button>
        }
      />
    );
  const pick = (id: string) =>
    setParams(
      (p) => {
        p.set('agent', id);
        return p;
      },
      { replace: true },
    );
  return (
    <>
      {list.length > 1 && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="connector-agent">{t('connectors.forAgent')}</Label>
          <Select value={String(agent.id)} onValueChange={pick}>
            <SelectTrigger
              id="connector-agent"
              className="min-h-11 w-full sm:w-80 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {render(agent)}
    </>
  );
}
