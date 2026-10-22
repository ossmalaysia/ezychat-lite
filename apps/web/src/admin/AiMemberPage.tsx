import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronRight,
  Lock,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  AI_AGENT_PRESETS,
  AI_HANDOFF_RULES_CHARACTERS,
  AI_INSTRUCTIONS_CHARACTERS,
  AiAgentBody,
  AiAgentPreset,
  AiEditField,
  type AiAgentStatus,
  type AiMemberStatus,
} from '@ezychat/shared';
import {
  useAiAgent,
  useAiAgentAction,
  useAiAgents,
  useAiMember,
  type AiAgentList,
} from '../api/ai';
import { ApiError, errorMessage } from '../api/client';
import { useInboxes } from '../api/queries';
import { Banner, EmptyState, PageHeader, StatusDot } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { InboxChip } from '../inbox/InboxChip';
import { AiConnectionBanner } from './AiConnectionBanner';
import { PRESET_ICON, PresetBadge } from './PresetBadge';
import { AiContextPanel, agentErrorMessage } from './AiContextPanel';
import { AiQuickConnect } from './AiQuickConnect';
import { AiEditDialog } from './AiEditDialog';
import { AiTryIt } from './AiTryIt';
import { connectionReady, hasKnowledge, presetDefaults, type PresetTexts } from './ai-status';
import { ConfirmDialog, ErrorState, Field, ListSkeleton, Pending, SaveBar } from './adminUi';
import { ExtensionBoundary, useWebExtensions } from '../extensions';

const PILL_TONE = {
  on: 'success',
  off: 'muted',
  needsConnection: 'danger',
  needsKnowledge: 'warning',
} as const;
/** A title with Edit with AI beside it: one centred row (the card grid would put the title higher). */
const EDIT_HEADER = 'flex flex-wrap items-center justify-between gap-2';
const TEXT_PRESETS = ['sales', 'faq'] as const;

const AgentDraft = z
  .object({
    displayName: z.string().max(64),
    instructions: z.string().max(AI_INSTRUCTIONS_CHARACTERS),
    handoffRules: z.string().max(AI_HANDOFF_RULES_CHARACTERS),
    inboxId: z.number().int().positive().nullable(),
  })
  .strict();
type AgentDraft = z.infer<typeof AgentDraft>;
/** Unsaved edits of one agent (or of a create page per preset), kept in session storage. */
const StoredDraft = z.object({ preset: AiAgentPreset, draft: AgentDraft }).strict();
type StoredDraft = z.infer<typeof StoredDraft>;

const draftKey = (agentId: number | null, preset: AiAgentPreset) =>
  `wati.ai-draft.${agentId ?? `new-${preset}`}`;
/**
 * Unsaved edits survive leaving the page (the app's router cannot block navigation). A draft
 * stored in another shape (an older AI member draft) fails to parse and is dropped.
 */
function readStoredDraft(key: string): StoredDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = StoredDraft.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeStoredDraft(key: string, stored: StoredDraft | null) {
  try {
    if (stored) sessionStorage.setItem(key, JSON.stringify(stored));
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: edits just are not restored */
  }
}
const same = (a: AgentDraft, b: AgentDraft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Members ▸ AI agent: `/admin/members/ai/:agentId` edits one agent; `/admin/members/ai/new?preset=`
 * creates one. Name, starting point, Business context (with Internal items), Try it, the role and
 * hand-over rules, the fixed safety rules, and in an edition with several inboxes the inbox and
 * Delete.
 */
export function AiMemberPage() {
  const { t } = useTranslation('admin');
  const { agentId: param } = useParams();
  const [params] = useSearchParams();
  const agentId = param === undefined ? null : Number(param);
  const presetParam = AiAgentPreset.safeParse(params.get('preset'));
  const preset = presetParam.success ? presetParam.data : 'sales';
  const status = useAiMember();
  const agents = useAiAgents();
  const agent = useAiAgent(agentId);

  const back = (
    <Button asChild variant="outline" size="touch">
      <Link to="/admin/members">{t('ai.agents.backToMembers')}</Link>
    </Button>
  );
  if (agentId !== null && agent.error instanceof ApiError && agent.error.status === 404)
    return (
      <EmptyState
        title={t('ai.agents.notFoundTitle')}
        description={t('ai.agents.notFoundBody')}
        action={back}
      />
    );
  for (const query of [status, agents, agent])
    if (query.isError && !query.data)
      return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!status.data || !agents.data || (agentId !== null && !agent.data)) return <ListSkeleton />;
  const list = agents.data;
  if (agentId === null && list.agents.length >= list.maxAgents)
    return (
      <EmptyState
        title={t('ai.agents.limitTitle')}
        description={list.maxAgents <= 1 ? t('ai.agents.limitBodyLite') : t('ai.agents.limitBody')}
        action={back}
      />
    );
  const refreshError = status.isError ? status.error : agent.isError ? agent.error : null;
  return (
    <AgentEditor
      key={agentId ?? `new-${preset}`}
      agent={agent.data ?? null}
      initialPreset={preset}
      status={status.data}
      list={list}
      refreshError={refreshError}
    />
  );
}

function AgentEditor({
  agent,
  initialPreset,
  status,
  list,
  refreshError,
}: {
  agent: AiAgentStatus | null;
  initialPreset: AiAgentPreset;
  status: AiMemberStatus;
  list: AiAgentList;
  refreshError: unknown;
}) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const pickId = useId();
  const inboxFieldId = useId();
  const reasonId = useId();
  const editReasonId = useId();
  const id = agent?.agent.id ?? null;
  const isNew = id === null;
  const lite = list.maxAgents <= 1;
  const action = useAiAgentAction(id);
  const inboxQuery = useInboxes({ enabled: !lite });
  const inboxes = lite ? [] : (inboxQuery.data?.inboxes ?? []).filter((inbox) => !inbox.removed);
  const showInboxUi = !lite && inboxes.length > 0;
  const storeKey = draftKey(id, initialPreset);
  const ready = connectionReady(status);

  /** A never-edited starting text (stored in English by the server) in the admin's language. */
  const localize = (text: string, field: keyof PresetTexts) => {
    for (const p of TEXT_PRESETS)
      if (text === AI_AGENT_PRESETS[p][field]) return presetDefaults(p, t)[field];
    return text;
  };
  const fromAgent = (a: AiAgentStatus): AgentDraft => ({
    displayName: a.settings.displayName,
    instructions: localize(a.settings.instructions, 'instructions'),
    handoffRules:
      a.settings.handoffRules === undefined
        ? presetDefaults(a.agent.preset, t).handoffRules
        : localize(a.settings.handoffRules, 'handoffRules'),
    inboxId: a.agent.inboxId,
  });
  const freeInbox = inboxes.find((inbox) => inbox.aiAgentId === null)?.id ?? null;
  const blank = (p: AiAgentPreset): AgentDraft => ({
    displayName: '',
    ...presetDefaults(p, t),
    inboxId: lite ? null : freeInbox,
  });

  const [initial] = useState<StoredDraft | null>(() => readStoredDraft(storeKey));
  const [preset, setPreset] = useState<AiAgentPreset>(
    initial?.preset ?? agent?.agent.preset ?? initialPreset,
  );
  const [draft, setDraft] = useState<AgentDraft>(
    () => initial?.draft ?? (agent ? fromAgent(agent) : blank(initialPreset)),
  );
  const [saved, setSaved] = useState<AgentDraft>(() =>
    agent ? fromAgent(agent) : blank(initialPreset),
  );
  const [submitted, setSubmitted] = useState(false);
  const [templateFor, setTemplateFor] = useState<AiAgentPreset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // The field stays set while the dialog closes so its content doesn't vanish mid-animation.
  const [editField, setEditField] = useState<AiEditField>('instructions');
  const [editOpen, setEditOpen] = useState(false);
  // New agents (and a restored draft) open Advanced: the role is where a Custom agent starts.
  const [advancedOpen] = useState(() => isNew || Boolean(initial));

  // The inbox shown follows the server when it changes elsewhere (Admin → Inboxes) or, on a create
  // page, once the inbox list arrives; typed edits are kept.
  const serverInbox = agent ? agent.agent.inboxId : freeInbox;
  useEffect(() => {
    if (serverInbox === saved.inboxId) return;
    setSaved((old) => ({ ...old, inboxId: serverInbox }));
    setDraft((old) => (old.inboxId === saved.inboxId ? { ...old, inboxId: serverInbox } : old));
  }, [serverInbox]); // eslint-disable-line react-hooks/exhaustive-deps -- only a server change

  const changed = !same(draft, saved) || preset !== (agent?.agent.preset ?? initialPreset);
  useEffect(() => {
    writeStoredDraft(storeKey, changed ? { preset, draft } : null);
  }, [changed, draft, preset, storeKey]);
  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);

  const otherOnInbox =
    !lite && draft.inboxId !== null && draft.inboxId !== saved.inboxId
      ? list.agents.find((a) => a.inboxId === draft.inboxId && a.id !== id)
      : undefined;
  // Moving onto an inbox that has another agent frees that inbox first (one agent per inbox).
  const freeOther = useAiAgentAction(otherOnInbox?.id ?? null);
  const busy = action.isPending || freeOther.isPending;
  const dirty = isNew || changed;

  const template = presetDefaults(preset, t);
  const matches = (text: string, field: keyof PresetTexts) =>
    text === template[field] || (preset !== 'custom' && text === AI_AGENT_PRESETS[preset][field]);
  const onTemplate =
    matches(draft.instructions, 'instructions') && matches(draft.handoffRules, 'handoffRules');
  const usingStartText = preset !== 'custom' && matches(draft.instructions, 'instructions');
  const presetName = (p: AiAgentPreset) => t(`ai.presets.${p}`);
  const savedName = agent?.settings.displayName ?? '';
  const title = draft.displayName.trim() || (isNew ? t('ai.agents.newTitle') : savedName);
  const nameError =
    submitted && !draft.displayName.trim() ? t('ai.agents.nameRequired') : undefined;
  const inboxName = (inboxId: number | null) =>
    inboxes.find((inbox) => inbox.id === inboxId)?.name ?? '';

  const documents = agent?.documents ?? [];
  const enabled = Boolean(agent?.agent.enabled);
  const knowledge = hasKnowledge(documents);
  const canTurnOn = ready && knowledge;
  const pill = !ready ? 'needsConnection' : !knowledge ? 'needsKnowledge' : enabled ? 'on' : 'off';
  const pillLabels = {
    on: t('ai.page.pill.on'),
    off: t('ai.page.pill.off'),
    needsConnection: t('ai.page.pill.needsConnection'),
    needsKnowledge: t('ai.page.pill.needsKnowledge'),
  };
  const reason = !ready ? t('ai.page.reasonConnection') : t('ai.page.reasonKnowledge');
  const stateLabels: Record<AiMemberStatus['connection']['state'], string> = {
    unavailable: t('ai.state.unavailable'),
    signed_out: t('ai.state.signed_out'),
    signing_in: t('ai.state.signing_in'),
    connected: t('ai.state.connected'),
    error: t('ai.state.error'),
    expired: t('ai.state.expired'),
  };
  const connectionText =
    status.settings.mode === 'api'
      ? status.hasApiKey
        ? t('ai.keySaved')
        : t('ai.keyMissing')
      : t('ai.chatgptState', { state: stateLabels[status.connection.state] });

  const applyTemplate = (p: AiAgentPreset) => {
    setPreset(p);
    setDraft((old) => ({ ...old, ...presetDefaults(p, t) }));
  };
  /** Picking a starting point replaces the texts directly while they are unedited; else it asks. */
  const choosePreset = (p: AiAgentPreset) => {
    if (p === preset) return;
    if (onTemplate) applyTemplate(p);
    else setTemplateFor(p);
  };

  /** Saves (or creates) the whole page with the given on/off state. */
  const save = async (nextEnabled: boolean, done: string) => {
    setSubmitted(true);
    setLocalError(null);
    const sent = draft;
    const name = sent.displayName.trim();
    if (!name) return;
    const parsed = AiAgentBody.safeParse({
      displayName: name,
      enabled: nextEnabled,
      preset,
      instructions: sent.instructions,
      handoffRules: sent.handoffRules,
      // Lite: the server keeps its one agent on the only inbox.
      ...(lite ? {} : { inboxId: sent.inboxId }),
    });
    if (!parsed.success) {
      setLocalError(t('ai.checkSettings'));
      return;
    }
    let freed = false;
    try {
      if (otherOnInbox) {
        await freeOther.mutateAsync({ kind: 'setInbox', inboxId: null });
        freed = true;
      }
      const result = await action.mutateAsync(
        isNew ? { kind: 'create', body: parsed.data } : { kind: 'save', body: parsed.data },
      );
      if (!('agent' in result)) return;
      if (isNew) {
        writeStoredDraft(storeKey, null);
        toast.success(t('ai.agents.created', { name }));
        navigate(`/admin/members/ai/${result.agent.id}`, { replace: true });
        return;
      }
      const stored = fromAgent(result);
      setSaved(stored);
      // Adopt the stored values only if nothing was typed while saving.
      setDraft((current) => (same(current, sent) ? stored : current));
      toast.success(done);
    } catch (error) {
      // The save failed after the other agent was taken off the inbox: give the inbox back so
      // it is not left without an agent (best effort; the lists refresh either way).
      if (freed && otherOnInbox && sent.inboxId !== null)
        await freeOther
          .mutateAsync({ kind: 'setInbox', inboxId: sent.inboxId })
          .catch(() => undefined);
      setLocalError(agentErrorMessage(error, t));
    }
  };

  const remove = async () => {
    try {
      await action.mutateAsync({ kind: 'delete' });
      writeStoredDraft(storeKey, null);
      toast.success(t('ai.agents.deleted', { name: savedName }));
      navigate('/admin/members', { replace: true });
    } catch (error) {
      setDeleting(false);
      setLocalError(agentErrorMessage(error, t));
    }
  };

  const editWithAi = (field: AiEditField) => (
    // Centred on the title row; compact on desktop, a 44 px target on touch screens.
    <CardAction className="self-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:min-h-11"
        disabled={!ready || busy}
        title={ready ? undefined : t('ai.edit.unavailable')}
        aria-describedby={ready ? undefined : editReasonId}
        onClick={() => {
          setEditField(field);
          setEditOpen(true);
        }}
      >
        <Sparkles aria-hidden />
        {t('ai.edit.open')}
      </Button>
    </CardAction>
  );
  const boundInbox = agent ? inboxes.find((inbox) => inbox.id === agent.agent.inboxId) : undefined;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <nav aria-label={t('ai.page.breadcrumb')} className="flex items-center gap-1 text-sm">
        <Link
          to="/admin/members"
          className="inline-flex items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:min-h-11"
        >
          {t('nav.members')}
        </Link>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
      </nav>
      <PageHeader
        className="pb-0"
        title={<span className="[overflow-wrap:anywhere]">{title}</span>}
        description={isNew ? t('ai.agents.newDescription') : t('ai.agents.description')}
        actions={
          agent && (
            <div className="flex flex-wrap items-center gap-3">
              <StatusDot tone={PILL_TONE[pill]} label={pillLabels[pill]} />
              {enabled ? (
                <Button
                  variant="outline"
                  size="touch"
                  disabled={busy}
                  onClick={() => void save(false, t('ai.page.turnedOff'))}
                >
                  {t('ai.page.turnOff')}
                </Button>
              ) : (
                <Button
                  size="touch"
                  disabled={busy || !canTurnOn}
                  aria-describedby={canTurnOn ? undefined : reasonId}
                  onClick={() => void save(true, t('ai.page.turnedOn'))}
                >
                  <Pending show={busy} />
                  {t('ai.page.turnOn')}
                </Button>
              )}
            </div>
          )
        }
      />
      {agent && !enabled && !canTurnOn && (
        <p id={reasonId} className="text-sm text-muted-foreground">
          {reason}
        </p>
      )}
      {agent && (
        <div className="flex flex-wrap items-center gap-2">
          <PresetBadge preset={preset} />
          {showInboxUi &&
            (boundInbox ? (
              <InboxChip inbox={boundInbox} />
            ) : (
              <span className="text-sm text-warning">{t('ai.agents.noInbox')}</span>
            ))}
        </div>
      )}
      <AiConnectionBanner
        status={status}
        action={
          <Button asChild size="touch" variant="outline">
            <Link to="/admin/settings/ai">{t('ai.page.openSettings')}</Link>
          </Button>
        }
      />

      {!ready && (
        <Card className="gap-4 border-primary/40">
          <CardHeader>
            <CardTitle>{t('ai.connect.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AiQuickConnect status={status} />
          </CardContent>
        </Card>
      )}

      {isNew && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle id={pickId}>{t('ai.agents.pickTitle')}</CardTitle>
            <CardDescription>{t('ai.agents.pickHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              aria-labelledby={pickId}
              value={preset}
              onValueChange={(value) => choosePreset(value as AiAgentPreset)}
              className="grid gap-3 sm:grid-cols-3"
            >
              {AiAgentPreset.options.map((p) => {
                const Icon = PRESET_ICON[p];
                const optionId = `${pickId}-${p}`;
                return (
                  <Label
                    key={p}
                    htmlFor={optionId}
                    className={cn(
                      'flex min-h-11 cursor-pointer flex-col items-start gap-2 rounded-lg border bg-card p-4 font-normal transition-colors',
                      'hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
                      'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <Icon aria-hidden className="size-4 text-primary" />
                      <span className="font-medium">{presetName(p)}</span>
                      <RadioGroupItem id={optionId} value={p} className="ml-auto" />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t(`ai.presets.${p}Description`)}
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>{t('ai.agents.nameTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label={t('ai.agents.nameLabel')} hint={t('ai.agents.nameHint')} error={nameError}>
            {(p) => (
              <Input
                {...p}
                value={draft.displayName}
                maxLength={64}
                disabled={busy}
                onChange={(e) => setDraft((old) => ({ ...old, displayName: e.target.value }))}
              />
            )}
          </Field>
          {showInboxUi && (
            <div className="flex flex-col gap-2" data-testid="agent-inbox">
              <Label htmlFor={inboxFieldId}>{t('ai.agents.inboxLabel')}</Label>
              <Select
                value={draft.inboxId === null ? 'none' : String(draft.inboxId)}
                disabled={busy}
                onValueChange={(value) =>
                  setDraft((old) => ({ ...old, inboxId: value === 'none' ? null : Number(value) }))
                }
              >
                <SelectTrigger id={inboxFieldId} className="min-h-11 w-full sm:max-w-sm md:min-h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="min-h-11 md:min-h-8">
                    {t('ai.agents.inboxNone')}
                  </SelectItem>
                  {inboxes.map((inbox) => {
                    const other = list.agents.find((a) => a.inboxId === inbox.id && a.id !== id);
                    return (
                      <SelectItem
                        key={inbox.id}
                        value={String(inbox.id)}
                        className="min-h-11 md:min-h-8"
                      >
                        {other
                          ? t('ai.agents.inboxHas', { inbox: inbox.name, agent: other.displayName })
                          : inbox.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{t('ai.agents.inboxHint')}</p>
              {otherOnInbox && (
                <Banner tone="warning">
                  {t('ai.agents.inboxMove', {
                    agent: otherOnInbox.displayName,
                    inbox: inboxName(draft.inboxId),
                  })}
                </Banner>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {agent ? (
        <AiContextPanel agentId={agent.agent.id} documents={documents} disabled={busy} />
      ) : (
        <Card className="gap-2">
          <CardHeader>
            <CardTitle>{t('ai.page.stepContext')}</CardTitle>
            <CardDescription>{t('ai.agents.contextNew')}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Every agent is a customer-facing agent for extensions ('sales'). */}
      <AgentExtensionSections agent="sales" />

      <Card className={agent ? 'gap-4' : 'gap-2'}>
        <CardHeader>
          <CardTitle>{t('ai.agents.tryTitle')}</CardTitle>
          {!agent && <CardDescription>{t('ai.agents.tryNew')}</CardDescription>}
        </CardHeader>
        {agent && (
          <CardContent>
            <AiTryIt draft={draft} agentId={agent.agent.id} ready={ready} />
          </CardContent>
        )}
      </Card>

      <details className="group rounded-lg border bg-card" open={advancedOpen}>
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-medium">{t('ai.agents.advanced')}</span>
          <span className="text-sm text-muted-foreground">
            {preset === 'custom' && !draft.instructions.trim()
              ? t('ai.agents.advancedBlank')
              : onTemplate
                ? t('ai.page.advancedRecommended')
                : t('ai.page.advancedCustomised')}
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t p-4">
          <Card className="gap-4">
            <CardHeader className={EDIT_HEADER}>
              <CardTitle>{t('ai.agents.roleTitle')}</CardTitle>
              {editWithAi(AiEditField.enum.instructions)}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {usingStartText && (
                <p className="inline-flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {t('ai.agents.usingTemplate', { preset: presetName(preset) })}
                </p>
              )}
              <Field label={t('ai.agents.roleLabel')} hint={t('ai.agents.roleHint')}>
                {(p) => (
                  <Textarea
                    {...p}
                    value={draft.instructions}
                    maxLength={AI_INSTRUCTIONS_CHARACTERS}
                    // Fixed, modest height: the long starting text scrolls inside the box.
                    className="field-sizing-fixed h-48 max-h-[70dvh] resize-y overflow-y-auto text-base leading-6 md:h-56 md:text-sm"
                    placeholder={t('ai.agents.rolePlaceholder')}
                    disabled={busy}
                    onChange={(e) => setDraft((old) => ({ ...old, instructions: e.target.value }))}
                  />
                )}
              </Field>
              {!onTemplate && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    className="self-start md:min-h-9"
                    disabled={busy}
                    onClick={() => setTemplateFor(preset)}
                  >
                    {t('ai.agents.useTemplate', { preset: presetName(preset) })}
                  </Button>
                  {preset === 'custom' && (
                    <span className="text-sm text-muted-foreground">
                      {t('ai.agents.customTemplateNote')}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader className={EDIT_HEADER}>
              <CardTitle>{t('ai.agents.handoffTitle')}</CardTitle>
              {editWithAi(AiEditField.enum.handoffRules)}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Banner tone="info">{t('ai.page.handoffSystem')}</Banner>
              <Field
                label={t('ai.agents.handoffTitle')}
                labelClassName="sr-only"
                hint={t('ai.agents.handoffHint')}
              >
                {(p) => (
                  <Textarea
                    {...p}
                    value={draft.handoffRules}
                    maxLength={AI_HANDOFF_RULES_CHARACTERS}
                    className="field-sizing-fixed h-40 resize-y overflow-y-auto text-base leading-6 md:text-sm"
                    placeholder={t('ai.agents.handoffPlaceholder')}
                    disabled={busy}
                    onChange={(e) => setDraft((old) => ({ ...old, handoffRules: e.target.value }))}
                  />
                )}
              </Field>
            </CardContent>
          </Card>
        </div>
      </details>

      <SafetyRules />

      <details className="rounded-lg border bg-card px-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          {t('ai.page.howItWorks')}
        </summary>
        <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{t('ai.behavior')}</p>
      </details>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{t('ai.page.connectionLine', { state: connectionText })}</span>
        <Link
          to="/admin/settings/ai"
          className="inline-flex items-center font-medium text-primary underline-offset-4 hover:underline pointer-coarse:min-h-11"
        >
          {t('ai.page.openSettings')}
        </Link>
      </p>

      {agent && !lite && (
        <Card className="gap-3 border-danger/40">
          <CardHeader>
            <CardTitle>{t('ai.agents.deleteTitle')}</CardTitle>
            <CardDescription>{t('ai.agents.deleteHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="touch"
              className="text-danger hover:bg-danger/10 hover:text-danger md:min-h-9"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden />
              {t('ai.agents.delete')}
            </Button>
          </CardContent>
        </Card>
      )}

      {Boolean(refreshError) && (
        <Banner tone="danger">{t('ai.refreshError', { error: errorMessage(refreshError) })}</Banner>
      )}
      {localError && <Banner tone="danger">{localError}</Banner>}

      {!ready && (
        <span id={editReasonId} className="sr-only">
          {t('ai.edit.unavailable')}
        </span>
      )}

      <SaveBar dirty={dirty}>
        <Button
          size="touch"
          disabled={!dirty || busy}
          onClick={() => void save(enabled, t('ai.agents.saved'))}
        >
          <Pending show={busy} />
          {isNew ? t('ai.agents.create') : t('ai.agents.save')}
        </Button>
      </SaveBar>

      <ConfirmDialog
        open={templateFor !== null}
        title={t('ai.agents.templateTitle', { preset: presetName(templateFor ?? preset) })}
        confirmLabel={t('ai.agents.templateConfirm')}
        onConfirm={() => {
          if (templateFor) applyTemplate(templateFor);
          setTemplateFor(null);
          toast.success(t('ai.agents.templateApplied'));
        }}
        onClose={() => setTemplateFor(null)}
      >
        {t('ai.agents.templateBody', { preset: presetName(templateFor ?? preset) })}
      </ConfirmDialog>
      {agent && (
        <ConfirmDialog
          open={deleting}
          danger
          title={t('ai.agents.deleteConfirmTitle', { name: savedName })}
          confirmLabel={t('ai.agents.delete')}
          loading={action.isPending}
          onConfirm={() => void remove()}
          onClose={() => setDeleting(false)}
        >
          {t('ai.agents.deleteConfirmBody', { name: savedName, count: documents.length })}
        </ConfirmDialog>
      )}
      <AiEditDialog
        field={editField}
        current={draft[editField]}
        open={editOpen}
        onOpenChange={setEditOpen}
        agentId={id ?? undefined}
        preset={preset}
        onApply={(text) => {
          setDraft((old) => ({ ...old, [editField]: text }));
          toast.success(t('ai.edit.applied'));
        }}
      />
    </div>
  );
}

/** The fixed guardrails every agent gets first in its prompt: shown, never editable. */
function SafetyRules() {
  const { t } = useTranslation('admin');
  const rules = [
    t('ai.guardrails.rule1'),
    t('ai.guardrails.rule2'),
    t('ai.guardrails.rule3'),
    t('ai.guardrails.rule4'),
  ];
  return (
    <Card className="gap-3 bg-muted/40">
      <CardHeader className={EDIT_HEADER}>
        <CardTitle className="inline-flex items-center gap-2">
          <ShieldCheck aria-hidden className="size-4 text-success" />
          {t('ai.guardrails.title')}
        </CardTitle>
        <Badge variant="outline" className="gap-1">
          <Lock aria-hidden className="size-3" />
          {t('ai.guardrails.badge')}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('ai.guardrails.intro')}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Extension rows for one agent (e.g. Connectors), right under Business context. */
function AgentExtensionSections({ agent }: { agent: 'sales' }) {
  const sections = useWebExtensions().flatMap((ext) =>
    (ext.agentSections ?? [])
      .filter((section) => section.agent === agent)
      .map((section) => ({ key: `${ext.name}:${section.id}`, element: section.element })),
  );
  if (!sections.length) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="agent-extension-sections">
      {sections.map((section) => (
        <div key={section.key} data-extension-section={section.key}>
          <ExtensionBoundary>{section.element}</ExtensionBoundary>
        </div>
      ))}
    </div>
  );
}
