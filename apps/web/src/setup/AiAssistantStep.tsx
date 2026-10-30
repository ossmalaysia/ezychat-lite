import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AiAgentStatus,
  AiMemberBody,
  DEFAULT_AI_HANDOFF_RULES,
  DEFAULT_AI_INSTRUCTIONS,
  type AiContextTextBody,
  type AiMemberStatus,
} from '@ezychat/shared';
import { aiAgentKey, aiMemberKey, refreshAgents, useAiMember, useAiMemberAction } from '../api/ai';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AiQuickConnect } from '@/admin/AiQuickConnect';
import { connectionReady } from '../admin/ai-status';
import { ButtonSpinner } from '../auth/AuthShell';
import { agentNameFor } from './agent-name';
import { InfoTip } from '@/components/app/InfoTip';

/**
 * The agent `PUT /api/ai` saved: the AI member's agent (inbox 1's), else the only agent; null for an
 * older server without agents (its old item route then means that agent).
 */
function savedAgentId(status: AiMemberStatus): number | null {
  const own = status.agents.find((a) => a.userId === status.member?.id);
  if (own) return own.id;
  return status.agents.length === 1 ? status.agents[0]!.id : null;
}

/**
 * Setup step 3 (skippable): describe the business, connect the AI, optionally turn it on.
 * Finish saves the default Sales Agent through `PUT /api/ai` (it creates the agent only once, so a
 * retry never makes a second one) with the recommended instructions and hand-off rules, saves the
 * text as one Business context item of that agent and turns the agent on when chosen.
 */
export function AiAssistantStep({
  businessName,
  onDone,
}: {
  businessName: string;
  onDone: (aiOn: boolean) => void;
}) {
  const { t } = useTranslation('auth');
  const status = useAiMember();
  const action = useAiMemberAction();
  const qc = useQueryClient();
  const textId = useId();
  const hintId = useId();
  const switchId = useId();
  const name = businessName || t('setup.ai.yourBusiness');
  const template = t('setup.ai.template', { business: name });
  const [text, setText] = useState(template);
  // Default on once connected; the owner can switch it off before Finish.
  const [turnOn, setTurnOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The text item already saved by an earlier Finish whose later step failed: never add it twice.
  const savedText = useRef<string | null>(null);
  const ready = status.data ? connectionReady(status.data) : false;

  /** Adds the text item to the agent just saved (by its id: never another agent's). */
  const addText = async (saved: AiMemberStatus, body: AiContextTextBody) => {
    const agentId = savedAgentId(saved);
    if (agentId === null) {
      await action.mutateAsync({ kind: 'addText', body });
      return;
    }
    const result = await api(`/ai/agents/${agentId}/documents/text`, {
      body,
      schema: AiAgentStatus,
    });
    qc.setQueryData(aiAgentKey(agentId), result);
    void qc.invalidateQueries({ queryKey: aiMemberKey });
  };
  const filled = text.trim().length > 0 && text.trim() !== template.trim();

  const finish = async () => {
    setError(null);
    if (!filled) {
      setError(t('setup.ai.needText'));
      return;
    }
    const enable = ready && turnOn;
    const member = AiMemberBody.safeParse({
      displayName: agentNameFor(name, (business) => t('setup.ai.agentName', { business })),
      enabled: false,
      instructions: DEFAULT_AI_INSTRUCTIONS,
      handoffRules: DEFAULT_AI_HANDOFF_RULES,
    });
    if (!member.success) {
      setError(t('setup.ai.saveFailed'));
      return;
    }
    setSaving(true);
    try {
      // The Business context item belongs to the agent, so the agent is saved first (off).
      const saved = await action.mutateAsync({ kind: 'save', settings: member.data });
      const body = { name: t('setup.ai.contextName'), text: text.trim() };
      if (savedText.current !== body.text) {
        await addText(saved, body);
        savedText.current = body.text;
      }
      if (enable)
        await action.mutateAsync({ kind: 'save', settings: { ...member.data, enabled: true } });
      onDone(enable);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      // The saves changed the agent (name, item, on/off), also when a later step failed.
      refreshAgents(qc);
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('setup.ai.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('setup.ai.intro')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={textId}>{t('setup.ai.businessLabel')}</Label>
          <InfoTip topic="businessContext" />
        </div>
        <Textarea
          id={textId}
          aria-describedby={hintId}
          value={text}
          maxLength={8000}
          className="field-sizing-fixed h-44 resize-y text-base leading-6 md:text-sm"
          disabled={saving}
          onChange={(e) => setText(e.target.value)}
        />
        <p id={hintId} className="text-sm text-muted-foreground">
          {t('setup.ai.businessHint')}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium">{t('setup.ai.connectTitle')}</h3>
          <InfoTip topic="aiConnection" />
        </div>
        {status.data ? (
          <AiQuickConnect status={status.data} />
        ) : status.error ? (
          <Banner tone="danger">{errorMessage(status.error)}</Banner>
        ) : (
          <ButtonSpinner />
        )}
      </div>

      {ready && (
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <Label htmlFor={switchId}>{t('setup.ai.turnOn')}</Label>
            <p className="mt-1 text-sm text-muted-foreground">{t('setup.ai.turnOnHint')}</p>
          </div>
          <Switch
            id={switchId}
            checked={turnOn}
            disabled={saving}
            onCheckedChange={setTurnOn}
            className="mt-0.5"
          />
        </div>
      )}
      {!ready && <p className="text-sm text-muted-foreground">{t('setup.ai.offUntilConnected')}</p>}

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" size="touch" disabled={saving} onClick={() => onDone(false)}>
          {t('setup.ai.skip')}
        </Button>
        <Button
          size="touch"
          disabled={saving}
          aria-busy={saving || undefined}
          onClick={() => void finish()}
        >
          {saving && <ButtonSpinner />}
          {t('setup.ai.finish')}
        </Button>
      </div>
    </div>
  );
}
