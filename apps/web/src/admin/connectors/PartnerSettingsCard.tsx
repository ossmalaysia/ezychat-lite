import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  connectorText,
  type ConnectorAgentSettings,
  type ConnectorEntry,
  type ConnectorSetting,
  type ConnectorTool,
} from '@ezychat/shared';
import { errorMessage } from '../../api/client';
import {
  useConnectorAgentSettings,
  useConnectorChoices,
  useSaveConnectorAgentSettings,
} from '../../api/connector-list';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { withToolDefaults } from './list';
import {
  ErrorState,
  Field,
  ListSkeleton,
  Pending,
  SaveBar,
  type FieldControlProps,
} from '../adminUi';

// Monday first, as Malaysian calendars show it.
const DAYS = [1, 2, 3, 4, 5, 6, 0];

type Values = Record<string, unknown>;

/** A setting's value before anything was saved: the entry's default, else empty. */
function initialValue(setting: ConnectorSetting): unknown {
  if (setting.default !== undefined) return setting.default;
  if (setting.type === 'toggle') return false;
  if (setting.type === 'days') return [];
  if (setting.type === 'timeRange') return ['', ''];
  return '';
}

/** Saved values over the entry's defaults; Look-ups start on, tools that change data off. */
export function withDefaults(
  entry: ConnectorEntry,
  saved: ConnectorAgentSettings,
): ConnectorAgentSettings {
  const settings: Values = {};
  for (const s of entry.settings ?? []) settings[s.id] = saved.settings[s.id] ?? initialValue(s);
  return { settings, tools: withToolDefaults(entry.tools ?? [], saved.tools) };
}

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && !v.trim()) ||
  (Array.isArray(v) && v.length === 0);

const pair = (v: unknown): [string, string] =>
  Array.isArray(v) ? [String(v[0] ?? ''), String(v[1] ?? '')] : ['', ''];

type Problem = 'required' | 'number' | 'timeOrder';

/** Checks one setting; numbers are sent as numbers. */
function check(setting: ConnectorSetting, value: unknown): Problem | null {
  if (setting.type === 'timeRange') {
    const [from, to] = pair(value);
    if (!from && !to) return setting.required ? 'required' : null;
    if (!from || !to) return 'required';
    return from < to ? null : 'timeOrder';
  }
  if (setting.type === 'toggle') return null;
  if (isEmpty(value)) return setting.required ? 'required' : null;
  if (setting.type === 'number' && !Number.isFinite(Number(value))) return 'number';
  return null;
}

/**
 * Settings tab of a partner connector, for one AI agent: the entry's settings form, one switch per
 * tool (tools that change data start off) and the rules the AI always follows (the core rules plus
 * each tool's declared guards in plain words). Save stores both for this agent.
 */
export function PartnerSettingsCard({
  entry,
  agentId,
  agentName,
}: {
  entry: ConnectorEntry;
  agentId: number;
  agentName: string;
}) {
  const { t, i18n } = useTranslation('admin');
  const query = useConnectorAgentSettings(entry.id, agentId);
  const save = useSaveConnectorAgentSettings(entry.id, agentId);
  const [draft, setDraft] = useState<ConnectorAgentSettings>();
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const settings = entry.settings ?? [];
  const tools = entry.tools ?? [];
  const saved = query.data ? withDefaults(entry, query.data) : undefined;
  const value = draft ?? saved;
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);

  const setSetting = (id: string, v: unknown) => {
    if (value) setDraft({ ...value, settings: { ...value.settings, [id]: v } });
  };
  const setTool = (name: string, on: boolean) => {
    if (value) setDraft({ ...value, tools: { ...value.tools, [name]: on } });
  };

  const submit = () => {
    if (!value) return;
    const next: Record<string, Problem> = {};
    for (const s of settings) {
      const problem = check(s, value.settings[s.id]);
      if (problem) next[s.id] = problem;
    }
    setProblems(next);
    if (Object.keys(next).length > 0) return;
    const body: ConnectorAgentSettings = {
      settings: Object.fromEntries(
        settings.map((s) => {
          const v = value.settings[s.id];
          return [s.id, s.type === 'number' && !isEmpty(v) ? Number(v) : v];
        }),
      ),
      tools: value.tools,
    };
    save.mutate(body, {
      onSuccess: () => {
        setDraft(undefined);
        toast.success(t('connectors.partner.saved'));
      },
    });
  };

  return (
    <Card className="gap-4" data-testid="partner-agent-settings">
      <CardHeader>
        <CardTitle className="break-words">
          {t('connectors.partner.agentTitle', { name: entry.name, agent: agentName })}
        </CardTitle>
        <CardDescription>{t('connectors.partner.agentHint', { agent: agentName })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {query.isPending && <ListSkeleton rows={3} />}
        {query.error && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
        {value && (
          <>
            {settings.length > 0 && (
              <div className="flex flex-col gap-4" data-testid="entry-settings">
                {settings.map((s) => (
                  <SettingField
                    key={s.id}
                    connectorId={entry.id}
                    agentId={agentId}
                    setting={s}
                    value={value.settings[s.id]}
                    problem={problems[s.id]}
                    onChange={(v) => setSetting(s.id, v)}
                  />
                ))}
              </div>
            )}

            {tools.length > 0 && (
              <section className="flex flex-col gap-2" aria-labelledby={`tools-${entry.id}`}>
                <h3 id={`tools-${entry.id}`} className="text-sm font-medium">
                  {t('connectors.partner.toolsTitle', { agent: agentName })}
                </h3>
                <div
                  className="flex flex-col divide-y rounded-lg border"
                  data-testid="tool-switches"
                >
                  {tools.map((tool) => (
                    <ToolSwitch
                      key={tool.name}
                      tool={tool}
                      on={Boolean(value.tools[tool.name])}
                      onChange={(on) => setTool(tool.name, on)}
                    />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">{t('connectors.partner.toolsNote')}</p>
              </section>
            )}

            <GuardRules entry={entry} language={i18n.language} />

            {save.error && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
            <SaveBar dirty={dirty} inset="card">
              <Button size="touch" disabled={!dirty || save.isPending} onClick={submit}>
                <Pending show={save.isPending} />
                {t('connectors.partner.save')}
              </Button>
            </SaveBar>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ToolSwitch({
  tool,
  on,
  onChange,
}: {
  tool: ConnectorTool;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-3">
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id} className="break-words">
            {connectorText(tool.title, i18n.language)}
          </Label>
          <Badge variant="secondary">
            {t(tool.access === 'read' ? 'connectors.lookUp' : 'connectors.changes')}
          </Badge>
        </span>
        <p className="mt-1 text-sm break-words text-muted-foreground">
          {connectorText(tool.description, i18n.language)}
        </p>
      </div>
      <Label htmlFor={id} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <Switch
          id={id}
          checked={on}
          onCheckedChange={onChange}
          data-testid={`tool-switch-${tool.name}`}
        />
      </Label>
    </div>
  );
}

/** One field of the entry's settings form. */
function SettingField({
  connectorId,
  agentId,
  setting,
  value,
  problem,
  onChange,
}: {
  connectorId: string;
  agentId: number;
  setting: ConnectorSetting;
  value: unknown;
  problem: Problem | undefined;
  onChange: (value: unknown) => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const ids = { toggle: useId(), from: useId(), to: useId(), error: useId() };
  const label = connectorText(setting.label, i18n.language);
  const hint = setting.hint ? connectorText(setting.hint, i18n.language) : undefined;
  const error = problem ? t(`connectors.partner.settingProblem.${problem}`) : undefined;
  const note = error ? (
    <p id={ids.error} className="text-sm text-danger">
      {error}
    </p>
  ) : hint ? (
    <p className="text-sm text-muted-foreground">{hint}</p>
  ) : null;

  if (setting.type === 'toggle')
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
        <div className="min-w-0">
          <Label htmlFor={ids.toggle} className="break-words">
            {label}
          </Label>
          {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </div>
        <Label
          htmlFor={ids.toggle}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
        >
          <Switch
            id={ids.toggle}
            checked={Boolean(value)}
            onCheckedChange={onChange}
            data-testid={`setting-${setting.id}`}
          />
        </Label>
      </div>
    );

  if (setting.type === 'days') {
    const days = Array.isArray(value) ? (value as unknown[]).map(Number) : [];
    const dayName = (day: number) =>
      new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(
        new Date(2026, 0, 4 + day), // 4 Jan 2026 is a Sunday
      );
    return (
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={error ? ids.error : undefined}
        data-testid={`setting-${setting.id}`}
      >
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day) => {
            const id = `${connectorId}-${setting.id}-day-${day}`;
            return (
              <Label
                key={day}
                htmlFor={id}
                className="flex min-h-11 items-center gap-2 rounded-md border px-3"
              >
                <Checkbox
                  id={id}
                  checked={days.includes(day)}
                  onCheckedChange={(on) =>
                    onChange(
                      on ? [...days, day].sort((a, b) => a - b) : days.filter((d) => d !== day),
                    )
                  }
                />
                {dayName(day)}
              </Label>
            );
          })}
        </div>
        {note}
      </fieldset>
    );
  }

  if (setting.type === 'timeRange') {
    const [from, to] = pair(value);
    return (
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={error ? ids.error : undefined}
        data-testid={`setting-${setting.id}`}
      >
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.from}>{t('connectors.partner.from')}</Label>
            <Input
              id={ids.from}
              type="time"
              value={from}
              className="min-h-11 w-36"
              onChange={(e) => onChange([e.target.value, to])}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.to}>{t('connectors.partner.to')}</Label>
            <Input
              id={ids.to}
              type="time"
              value={to}
              className="min-h-11 w-36"
              onChange={(e) => onChange([from, e.target.value])}
            />
          </div>
        </div>
        {note}
      </fieldset>
    );
  }

  if (setting.type === 'select' || setting.type === 'calendarPicker') {
    const options =
      setting.type === 'select'
        ? (setting.options ?? []).map((o) => ({
            value: o.value,
            label: connectorText(o.label, i18n.language),
          }))
        : null;
    return (
      <Field label={label} hint={hint} error={error}>
        {(p) =>
          options ? (
            <OptionSelect
              control={p}
              testId={`setting-${setting.id}`}
              value={value}
              options={options}
              onChange={onChange}
            />
          ) : (
            <ChoiceSelect
              control={p}
              testId={`setting-${setting.id}`}
              connectorId={connectorId}
              agentId={agentId}
              settingId={setting.id}
              value={value}
              onChange={onChange}
            />
          )
        }
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint} error={error}>
      {(p) => (
        <Input
          {...p}
          type={setting.type === 'number' ? 'number' : 'text'}
          inputMode={setting.type === 'number' ? 'decimal' : undefined}
          value={value === undefined || value === null ? '' : String(value)}
          maxLength={setting.type === 'number' ? undefined : 500}
          className="min-h-11 sm:max-w-md"
          onChange={(e) => onChange(e.target.value)}
          data-testid={`setting-${setting.id}`}
        />
      )}
    </Field>
  );
}

function OptionSelect({
  control,
  testId,
  value,
  options,
  onChange,
  disabled,
}: {
  control: FieldControlProps;
  testId: string;
  value: unknown;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('admin');
  return (
    <Select
      value={value === undefined || value === null ? '' : String(value)}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger
        {...control}
        className="min-h-11 w-full sm:w-80 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
        data-testid={testId}
      >
        <SelectValue placeholder={t('connectors.partner.choose')} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A picker whose choices come from the partner (e.g. its calendars), read through the server. */
function ChoiceSelect({
  control,
  testId,
  connectorId,
  agentId,
  settingId,
  value,
  onChange,
}: {
  control: FieldControlProps;
  testId: string;
  connectorId: string;
  agentId: number;
  settingId: string;
  value: unknown;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('admin');
  const choices = useConnectorChoices(connectorId, settingId, agentId);
  if (choices.error)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-danger" role="alert">
        {t('connectors.partner.choicesError')}
        <Button
          variant="outline"
          size="sm"
          className="min-h-9 pointer-coarse:min-h-11"
          onClick={() => void choices.refetch()}
        >
          {t('connectors.partner.retry')}
        </Button>
      </div>
    );
  return (
    <OptionSelect
      control={control}
      testId={testId}
      value={value}
      options={choices.data?.options ?? []}
      onChange={onChange}
      disabled={choices.isPending}
    />
  );
}

/** "Rules the AI always follows": the core rules and each tool's declared guards in plain words. */
export function GuardRules({ entry, language }: { entry: ConnectorEntry; language: string }) {
  const { t } = useTranslation('admin');
  const tools = entry.tools ?? [];
  const settings = entry.settings ?? [];
  const publisher = entry.publisher ?? entry.name;
  const writes = tools.filter((tool) => tool.access === 'write');
  const list = (items: string[]) =>
    new Intl.ListFormat(language, { type: 'conjunction' }).format([...new Set(items)]);
  const toolTitle = (name: string) => {
    const tool = tools.find((x) => x.name === name);
    return tool ? connectorText(tool.title, language) : name;
  };
  // `customer_name`, `customerEmail`, `phone_number` → the plain word; other names lose `_` and camel case.
  const field = (path: string) => {
    const words = (path.split('.').pop() ?? path)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
      .trim();
    const known = (['name', 'email', 'phone'] as const).find((w) => words.split(' ').includes(w));
    return known ? t(`connectors.partner.field.${known}`) : words;
  };
  const settingLabel = (ref: string) => {
    const id = ref.replace(/^settings\./, '');
    const s = settings.find((x) => x.id === id);
    return s ? connectorText(s.label, language) : id;
  };
  return (
    <div
      className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground"
      data-testid="guard-rules"
    >
      <p className="mb-1 flex items-center gap-2 font-medium text-foreground">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        {t('connectors.partner.rulesTitle')}
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>{t('connectors.partner.rule.asDescribed', { publisher })}</li>
        <li>{t('connectors.partner.rule.noUndo')}</li>
        {writes.length > 0 && <li>{t('connectors.partner.rule.writeOff')}</li>}
      </ul>
      {tools
        .filter((tool) => tool.guards)
        .map((tool) => {
          const g = tool.guards!;
          const lines: string[] = [];
          if (g.confirmFirst) lines.push(t('connectors.partner.rule.confirmFirst'));
          for (const from of new Set(Object.values(g.valueFrom ?? {})))
            lines.push(t('connectors.partner.rule.valueFrom', { lookUp: toolTitle(from) }));
          if (g.fromCustomer?.length)
            lines.push(
              t('connectors.partner.rule.fromCustomer', {
                fields: list(g.fromCustomer.map(field)),
              }),
            );
          if (g.within && Object.keys(g.within).length > 0)
            lines.push(
              t('connectors.partner.rule.within', {
                settings: list(Object.values(g.within).map(settingLabel)),
              }),
            );
          const { perChat, perDay } = g.limits ?? {};
          if (perChat !== undefined && perDay !== undefined)
            lines.push(t('connectors.partner.rule.limitsBoth', { perChat, perDay }));
          else if (perChat !== undefined)
            lines.push(t('connectors.partner.rule.limitsChat', { count: perChat }));
          else if (perDay !== undefined)
            lines.push(t('connectors.partner.rule.limitsDay', { count: perDay }));
          if (lines.length === 0) return null;
          return (
            <div key={tool.name} className="mt-3">
              <p className="font-medium break-words text-foreground">
                {t('connectors.partner.rulesFor', { tool: connectorText(tool.title, language) })}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          );
        })}
    </div>
  );
}
