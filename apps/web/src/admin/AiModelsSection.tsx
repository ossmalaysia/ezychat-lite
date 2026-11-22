import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI_TASK_GROUPS,
  aiModelHasThinking,
  defaultTaskThinking,
  type AiTaskGroup,
  type AiTaskModelsStatus,
  type AiThinking,
} from '@ezychat/shared';
import { errorMessage } from '../api/client';
import { useSaveTaskModels, useTaskModels } from '../api/ai-models';
import { Banner } from '@/components/app';
import { SegmentedControl } from '@/components/app/SegmentedControl';
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
import { Field, SaveBar } from './adminUi';

/** A row's unsaved edit; null = back to the default. */
type Draft = { choice: string; thinking: AiThinking | null } | null;

/**
 * Settings → AI → AI models (docs/ai-models.md, confirmed mock docs/features/ai-models-per-task/mock). One row per
 * job an owner recognises; each picks Fast, Main model or a model the current connection lists, plus "Speed and
 * quality" (Faster · Balanced · Smarter) when the model has a level. Each connection keeps its own choices.
 */
export function AiModelsSection() {
  const { t } = useTranslation('admin');
  const query = useTaskModels();
  const save = useSaveTaskModels();
  const [drafts, setDrafts] = useState<Partial<Record<AiTaskGroup, Draft>>>({});
  const data = query.data;
  const mode = data?.mode;
  // Unsaved edits belong to one connection: a switch in the AI connection card above drops them.
  useEffect(() => setDrafts({}), [mode]);
  const dirty = Object.keys(drafts).length > 0;
  const onSave = () =>
    save.mutate(
      {
        tasks: Object.fromEntries(
          Object.entries(drafts).map(([task, d]) => [
            task,
            d ? { choice: d.choice, ...(d.thinking ? { thinking: d.thinking } : {}) } : null,
          ]),
        ),
      },
      { onSuccess: () => setDrafts({}) },
    );

  return (
    <Card data-testid="ai-models-settings">
      <CardHeader>
        <CardTitle>{t('settings.aiModels.title')}</CardTitle>
        <CardDescription>{t('settings.aiModels.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {data && (
          <p className="text-sm text-muted-foreground" data-testid="ai-models-connection">
            {t('settings.aiModels.connection', {
              connection: t(`settings.aiModels.mode.${data.mode}`),
              main: data.mainModel,
              fast: data.fastModel,
            })}{' '}
            {t('settings.aiModels.perConnection')}
          </p>
        )}
        {data &&
          AI_TASK_GROUPS.map((task) => (
            <TaskRow
              key={`${data.mode}-${task}`}
              task={task}
              data={data}
              draft={drafts[task]}
              onChange={(picked) =>
                setDrafts((current) => {
                  const next = { ...current };
                  const saved = data.tasks[task];
                  // The row's default choice at its default level is the default: saved as null (no extra row).
                  const d =
                    picked &&
                    picked.choice === data.defaults[task].choice &&
                    (!picked.thinking ||
                      picked.thinking === defaultTaskThinking(task, picked.choice, data.mode))
                      ? null
                      : picked;
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
            {t('settings.aiModels.alwaysMain', { main: data.mainModel })}
          </p>
        )}
        {(save.error || query.error) && (
          <Banner tone="danger">{errorMessage(save.error || query.error)}</Banner>
        )}
        <SaveBar dirty={dirty} inset="card">
          <Button
            size="touch"
            disabled={!dirty || save.isPending}
            onClick={onSave}
            data-testid="ai-models-save"
          >
            {t('settings.save')}
          </Button>
        </SaveBar>
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
  task: AiTaskGroup;
  data: AiTaskModelsStatus;
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
  const effectiveChoice = showUnavailable ? defaultChoice : choice;
  const model =
    effectiveChoice === 'fast'
      ? data.fastModel
      : effectiveChoice === 'main'
        ? data.mainModel
        : effectiveChoice;
  const info = data.models.find((m) => m.id === model);
  // A saved model the built-in list misses (ChatGPT before the account's list was read) still runs: show it.
  const extra = !showUnavailable && choice !== 'fast' && choice !== 'main' && !info ? choice : null;
  const hasThinking = info?.thinking ?? aiModelHasThinking(data.mode, model);
  const fallbackThinking = defaultTaskThinking(task, effectiveChoice, data.mode);
  const thinking =
    draft === undefined
      ? (saved.effectiveThinking ?? fallbackThinking)
      : (draft?.thinking ?? fallbackThinking);
  const isDefault = draft === undefined ? saved.isDefault : draft === null;
  const tier = effectiveChoice === 'fast' ? 'fast' : (info?.tier ?? null);
  const recommended = (value: 'fast' | 'main') =>
    defaultChoice === value ? ` ${t('settings.aiModels.recommended')}` : '';
  const fastLabel = `${t('settings.aiModels.fast')}${recommended('fast')} · ${data.fastModel}`;
  const mainLabel = `${t('settings.aiModels.main')}${recommended('main')} · ${data.mainModel}`;
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-3 sm:p-4"
      data-testid={`ai-models-${task}`}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t(`settings.aiModels.tasks.${task}.title`)}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t(`settings.aiModels.tasks.${task}.what`)}
          </p>
        </div>
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 shrink-0 self-start"
            onClick={() => onChange(null)}
            data-testid={`ai-models-${task}-default`}
          >
            {t('settings.aiModels.useDefault')}
          </Button>
        )}
      </div>
      {showUnavailable && (
        <Banner tone="warning">
          {t('settings.aiModels.unavailable', {
            model: saved.unavailable,
            fallback:
              effectiveChoice === 'main'
                ? t('settings.aiModels.mainShort', { model: data.mainModel })
                : t('settings.aiModels.fastShort', { model: data.fastModel }),
          })}
        </Banner>
      )}
      <Field
        label={t('settings.aiModels.model')}
        hint={
          <>
            {tier ? t(`settings.aiModels.tier.${tier}`) : null}
            {hasThinking ? ` ${t(`settings.aiModels.thinkingHint.${thinking}`)}` : null}
            {task === 'writing' && effectiveChoice !== 'fast'
              ? ` ${t('settings.aiModels.writingSlow')}`
              : null}
          </>
        }
      >
        {(p) => (
          <Select
            value={showUnavailable ? (saved.unavailable ?? choice) : choice}
            onValueChange={(value) => {
              const next =
                value === 'fast' ? data.fastModel : value === 'main' ? data.mainModel : value;
              // A level only for a model that has one (the server refuses it otherwise).
              const keeps =
                data.models.find((m) => m.id === next)?.thinking ??
                aiModelHasThinking(data.mode, next);
              onChange({
                choice: value,
                // After Use default (draft null) the row starts again from the default level.
                thinking: keeps
                  ? draft === null
                    ? null
                    : (draft?.thinking ?? saved.thinking)
                  : null,
              });
            }}
          >
            <SelectTrigger
              {...p}
              className="h-auto min-h-11 w-full py-2 text-left whitespace-normal data-[size=default]:h-auto *:data-[slot=select-value]:block *:data-[slot=select-value]:line-clamp-2"
              data-testid={`ai-models-${task}-select`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">{fastLabel}</SelectItem>
              <SelectItem value="main">{mainLabel}</SelectItem>
              <SelectSeparator />
              {showUnavailable && saved.unavailable && (
                <SelectItem value={saved.unavailable} disabled>
                  {t('settings.aiModels.notOffered', { model: saved.unavailable })}
                </SelectItem>
              )}
              {extra && <SelectItem value={extra}>{extra}</SelectItem>}
              {data.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.tier ? `${m.id} · ${t(`settings.aiModels.tierShort.${m.tier}`)}` : m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      {hasThinking && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span id={thinkingId} className="text-sm font-medium">
            {t('settings.aiModels.thinking')}
          </span>
          <SegmentedControl<AiThinking>
            size="sm"
            aria-labelledby={thinkingId}
            value={thinking}
            // A row on its fallback saves the model it runs on, never the one that is gone.
            onValueChange={(value) => onChange({ choice: effectiveChoice, thinking: value })}
            options={[
              { value: 'low', label: t('settings.aiModels.thinkingLevel.low') },
              { value: 'medium', label: t('settings.aiModels.thinkingLevel.medium') },
              { value: 'high', label: t('settings.aiModels.thinkingLevel.high') },
            ]}
          />
        </div>
      )}
    </section>
  );
}
