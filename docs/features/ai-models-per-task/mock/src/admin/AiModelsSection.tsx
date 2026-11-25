import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { SegmentedControl } from '@/components/app/SegmentedControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AI_TASKS,
  aiModelsKey,
  useAiModels,
  type AiMode,
  type AiModelsStatus,
  type AiTask,
  type AiThinking,
} from '@/mock/aiModels';
import { Field, SaveBar } from './adminUi';

type Draft = { choice: string; thinking: AiThinking | null } | null;

/**
 * Proposed (ai-models-per-task): Settings → AI → AI models. One row per job an owner recognises;
 * each picks Fast, Main model or any model the current connection lists, plus a thinking level
 * when the model has one. Each connection keeps its own choices. The dashed "Mock only" box
 * switches the connection and drops a saved model from the list to show the fallback.
 */
export function AiModelsSection() {
  const { t } = useTranslation('admin');
  const client = useQueryClient();
  const query = useAiModels();
  const [drafts, setDrafts] = useState<Partial<Record<AiTask, Draft>>>({});
  const connId = useId();
  const listId = useId();
  const data = query.data;
  const dirty = Object.keys(drafts).length > 0;
  const save = useMutation({
    mutationFn: (tasks: Partial<Record<AiTask, Draft>>) =>
      api<AiModelsStatus>('/mock/ai-models', {
        method: 'PUT',
        body: {
          tasks: Object.fromEntries(
            Object.entries(tasks).map(([task, d]) => [
              task,
              d ? { choice: d.choice, ...(d.thinking ? { thinking: d.thinking } : {}) } : null,
            ]),
          ),
        },
      }),
    onSuccess: (next) => {
      client.setQueryData(aiModelsKey, next);
      setDrafts({});
    },
  });
  const scenario = useMutation({
    mutationFn: (body: { mode?: AiMode; removed?: boolean }) =>
      api<AiModelsStatus>('/mock/ai-models/scenario', { method: 'PUT', body }),
    onSuccess: (next) => {
      client.setQueryData(aiModelsKey, next);
      setDrafts({});
    },
  });

  return (
    <Card data-testid="ai-models-settings">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>{t('mockAiModels.title')}</CardTitle>
          <Badge variant="outline">{t('mockAiModels.proposed')}</Badge>
        </div>
        <CardDescription>{t('mockAiModels.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {data && (
          <p className="text-sm text-muted-foreground" data-testid="ai-models-connection">
            {t('mockAiModels.connection', {
              connection: t(`mockAiModels.mode.${data.mode}`),
              main: data.mainModel,
              fast: data.fastModel,
            })}{' '}
            {t('mockAiModels.perConnection')}
          </p>
        )}
        {data &&
          AI_TASKS.map((task) => (
            <TaskRow
              key={`${data.mode}-${task}`}
              task={task}
              data={data}
              draft={drafts[task]}
              onChange={(d) =>
                setDrafts((current) => {
                  const next = { ...current };
                  const saved = data.tasks[task];
                  const same =
                    d === null
                      ? saved.isDefault
                      : d.choice === saved.choice && d.thinking === saved.thinking;
                  if (same) delete next[task];
                  else next[task] = d;
                  return next;
                })
              }
            />
          ))}
        {data && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t('mockAiModels.alwaysMain', { main: data.mainModel })}
          </p>
        )}
        {(save.error || query.error || scenario.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error || scenario.error)}</Banner>
        )}
        <SaveBar dirty={dirty}>
          <Button
            size="touch"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(drafts)}
            data-testid="ai-models-save"
          >
            {t('settings.save')}
          </Button>
        </SaveBar>
        <div
          className="flex flex-col gap-3 rounded-lg border border-dashed px-3 py-3"
          data-testid="mock-ai-models-controls"
        >
          <Badge variant="outline" className="self-start">
            {t('mockAiModels.mockControls')}
          </Badge>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span id={connId} className="text-sm font-medium">
              {t('mockAiModels.mockConnection')}
            </span>
            <SegmentedControl<AiMode>
              size="sm"
              aria-labelledby={connId}
              value={data?.mode ?? 'chatgpt'}
              onValueChange={(mode) => scenario.mutate({ mode })}
              options={[
                { value: 'chatgpt', label: t('mockAiModels.mode.chatgpt') },
                { value: 'api', label: t('mockAiModels.mode.api') },
                { value: 'claude', label: t('mockAiModels.mode.claude') },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span id={listId} className="text-sm font-medium">
              {t('mockAiModels.mockList')}
            </span>
            <SegmentedControl<'normal' | 'removed'>
              size="sm"
              aria-labelledby={listId}
              value={data?.removedScenario ? 'removed' : 'normal'}
              onValueChange={(v) => scenario.mutate({ mode: 'chatgpt', removed: v === 'removed' })}
              options={[
                { value: 'normal', label: t('mockAiModels.mockListNormal') },
                { value: 'removed', label: t('mockAiModels.mockListRemoved') },
              ]}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  data,
  draft,
  onChange,
}: {
  task: AiTask;
  data: AiModelsStatus;
  draft: Draft | undefined;
  onChange: (draft: Draft) => void;
}) {
  const { t } = useTranslation('admin');
  const thinkingId = useId();
  const saved = data.tasks[task];
  const defaultChoice = data.defaults[task].choice;
  // A draft of null = back to the default.
  const choice = draft === undefined ? saved.choice : (draft?.choice ?? defaultChoice);
  const showUnavailable = draft === undefined && saved.unavailable;
  const effectiveChoice = showUnavailable ? (task === 'agentReplies' ? 'main' : 'fast') : choice;
  const model =
    effectiveChoice === 'fast'
      ? data.fastModel
      : effectiveChoice === 'main'
        ? data.mainModel
        : effectiveChoice;
  const info = data.models.find((m) => m.id === model);
  // Today every ChatGPT call except agent replies runs at Low thinking; agent replies use the model's own (Medium).
  const defaultThinking: AiThinking =
    task === 'agentReplies' && effectiveChoice !== 'fast' ? 'medium' : 'low';
  const thinking =
    draft === undefined
      ? (saved.effectiveThinking ?? defaultThinking)
      : (draft?.thinking ?? defaultThinking);
  const isDefault = draft === undefined ? saved.isDefault : draft === null;
  const tier = effectiveChoice === 'fast' ? 'fast' : (info?.tier ?? null);
  const recommended = (value: 'fast' | 'main') =>
    defaultChoice === value ? ` ${t('mockAiModels.recommended')}` : '';
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
      data-testid={`ai-models-${task}`}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t(`mockAiModels.tasks.${task}.title`)}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t(`mockAiModels.tasks.${task}.what`)}
          </p>
        </div>
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 shrink-0 self-start"
            onClick={() => onChange(null)}
          >
            {t('mockAiModels.useDefault')}
          </Button>
        )}
      </div>
      {showUnavailable && (
        <Banner tone="warning">
          {t('mockAiModels.unavailable', {
            model: saved.unavailable,
            fallback:
              effectiveChoice === 'main'
                ? t('mockAiModels.mainShort', { model: data.mainModel })
                : t('mockAiModels.fastShort', { model: data.fastModel }),
          })}
        </Banner>
      )}
      <Field
        label={t('mockAiModels.model')}
        hint={
          <>
            {tier ? t(`mockAiModels.tier.${tier}`) : null}
            {info?.thinking ? ` ${t(`mockAiModels.thinkingHint.${thinking}`)}` : null}
            {task === 'writing' && effectiveChoice !== 'fast'
              ? ` ${t('mockAiModels.writingSlow')}`
              : null}
          </>
        }
      >
        {(p) => (
          <Select
            value={showUnavailable ? (saved.unavailable ?? choice) : choice}
            onValueChange={(value) =>
              onChange({
                choice: value,
                thinking: draft?.thinking ?? saved.thinking,
              })
            }
          >
            <SelectTrigger
              {...p}
              className="h-auto min-h-11 w-full py-2 text-left whitespace-normal data-[size=default]:h-auto *:data-[slot=select-value]:block *:data-[slot=select-value]:line-clamp-2"
              data-testid={`ai-models-${task}-select`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">
                {`${t('mockAiModels.fast')}${recommended('fast')} · ${data.fastModel}`}
              </SelectItem>
              <SelectItem value="main">
                {`${t('mockAiModels.main')}${recommended('main')} · ${data.mainModel}`}
              </SelectItem>
              <SelectSeparator />
              {showUnavailable && saved.unavailable && (
                <SelectItem value={saved.unavailable} disabled>
                  {t('mockAiModels.notOffered', { model: saved.unavailable })}
                </SelectItem>
              )}
              {data.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.tier ? `${m.id} · ${t(`mockAiModels.tierShort.${m.tier}`)}` : m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      {info?.thinking && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span id={thinkingId} className="text-sm font-medium">
            {t('mockAiModels.thinking')}
          </span>
          <SegmentedControl<AiThinking>
            size="sm"
            aria-labelledby={thinkingId}
            value={thinking}
            onValueChange={(value) => onChange({ choice, thinking: value })}
            options={[
              { value: 'low', label: t('mockAiModels.thinkingLevel.low') },
              { value: 'medium', label: t('mockAiModels.thinkingLevel.medium') },
              { value: 'high', label: t('mockAiModels.thinkingLevel.high') },
            ]}
          />
        </div>
      )}
    </section>
  );
}
