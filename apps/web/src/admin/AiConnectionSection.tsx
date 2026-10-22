import { useId, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronRight, ExternalLink, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  AiConnectionBody,
  CHATGPT_FALLBACK_MODELS,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODELS,
  type AiMemberStatus,
  type AiSettings,
  type ClaudeModel,
} from '@ezychat/shared';
import { useAiMember, useAiMemberAction, useAiModels, useAiTest } from '../api/ai';
import { errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { AiConnectionBanner } from './AiConnectionBanner';
import { connectionReady, officialLoginUrl } from './ai-status';
import { aiAgentsPath } from './agent-path';
import {
  ANTHROPIC_CONSOLE_URL,
  keyTestBlocks,
  keyTestMessage,
  useTestApiKey,
  type KeyMode,
} from './AiQuickConnect';
import { useChatgptSignIn } from './use-chatgpt-sign-in';
import { ErrorState, Field, ListSkeleton, Pending, SaveBar } from './adminUi';
import { cn } from '@/lib/utils';

/** Radix Select needs a non-empty value; '' (Auto) is what is stored. */
const AUTO_MODEL = 'auto';
type Mode = AiSettings['mode'];
type ConnectionDraft = Pick<AiSettings, 'mode' | 'model'>;
/** One model per mode, so flipping between modes keeps what was chosen for each. */
type ModeDrafts = { mode: Mode } & Record<Mode, string>;
const draftsFrom = (settings: ConnectionDraft): ModeDrafts => ({
  mode: settings.mode,
  api: settings.mode === 'api' ? settings.model : '',
  chatgpt: settings.mode === 'chatgpt' ? settings.model : '',
  claude: settings.mode === 'claude' ? settings.model : '',
});
const CLAUDE_MODEL_LABELS = {
  'claude-sonnet-5-5': 'ai.claude.models.sonnet',
  'claude-opus-5-5': 'ai.claude.models.opus',
  'claude-haiku-5-5': 'ai.claude.models.haiku',
} as const satisfies Record<ClaudeModel, string>;
const NO_KEYS: Record<KeyMode, string> = { api: '', claude: '' };

/** Settings → AI: the inbox-wide AI connection, edited in place (no popup). */
export function AiConnectionSection() {
  const query = useAiMember();
  if (!query.data)
    return query.isError ? (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <ListSkeleton rows={3} />
    );
  return <ConnectionForm status={query.data} refreshError={query.isError ? query.error : null} />;
}

function ConnectionForm({
  status,
  refreshError,
}: {
  status: AiMemberStatus;
  refreshError: unknown;
}) {
  const { t } = useTranslation('admin');
  const modeLabelId = useId();
  const stateLabels: Record<AiMemberStatus['connection']['state'], string> = {
    unavailable: t('ai.state.unavailable'),
    signed_out: t('ai.state.signed_out'),
    signing_in: t('ai.state.signing_in'),
    connected: t('ai.state.connected'),
    error: t('ai.state.error'),
    expired: t('ai.state.expired'),
  };
  const modeOptions: Array<{ value: Mode; label: string; hint: string }> = [
    { value: 'chatgpt', label: t('ai.modeChatgpt'), hint: t('ai.modeChatgptHint') },
    { value: 'api', label: t('ai.modeApi'), hint: t('ai.modeApiHint') },
    { value: 'claude', label: t('ai.modeClaude'), hint: t('ai.modeClaudeHint') },
  ];
  // Status polling replaces `status`; the draft keeps what the admin has not saved yet.
  const [drafts, setDrafts] = useState<ModeDrafts>(() => draftsFrom(status.settings));
  const draft: ConnectionDraft = { mode: drafts.mode, model: drafts[drafts.mode] };
  const setModel = (model: string) => setDrafts((old) => ({ ...old, [old.mode]: model }));
  // Each key mode has its own field, "replace" state and test, so flipping modes never mixes keys.
  const [keys, setKeys] = useState(NO_KEYS);
  const [replacing, setReplacing] = useState<Record<KeyMode, boolean>>({
    api: false,
    claude: false,
  });
  const [testedKeys, setTestedKeys] = useState<Record<KeyMode, string | null>>({
    api: null,
    claude: null,
  });
  const apiModelId = useId();
  const [apiModelOpen, setApiModelOpen] = useState(false);
  // A custom model stays visible; the default ("leave blank") stays tucked away.
  const showApiModel = apiModelOpen || drafts.api !== '';
  const [pasted, setPasted] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const action = useAiMemberAction();
  const test = useAiTest();
  const chatgpt = useChatgptSignIn(action);
  // A new API key is tested before it is saved. A key the service rejects is never stored; after any
  // other failure (restricted key, region, limit, outage) the admin may save it anyway.
  const keyTests = { api: useTestApiKey(), claude: useTestApiKey() };
  const keyMode: KeyMode | null = draft.mode === 'chatgpt' ? null : draft.mode;
  const savedKey: Record<KeyMode, boolean> = {
    api: status.hasApiKey,
    claude: status.hasClaudeApiKey,
  };
  const newKey = keyMode ? keys[keyMode].trim() : '';
  const keyTestPending = keyTests.api.isPending || keyTests.claude.isPending;
  const runKeyTest = async (mode: KeyMode, key: string) => {
    const result = await keyTests[mode].mutateAsync({ apiKey: key, mode });
    if (result.ok) setTestedKeys((old) => ({ ...old, [mode]: key }));
    return result.ok;
  };
  const saved = status.settings;
  const conn = status.connection;
  const savedChatgpt = saved.mode === 'chatgpt';
  const dirty = draft.mode !== saved.mode || draft.model !== saved.model || newKey !== '';
  const loginUrl = officialLoginUrl(conn.loginUrl);
  // Stored tokens exist: connected and expired always; a failed first sign-in has none.
  const hasTokens =
    savedChatgpt &&
    (conn.state === 'connected' ||
      conn.state === 'expired' ||
      (conn.state === 'error' && Boolean(conn.email)));
  const models = useAiModels(draft.mode === 'chatgpt', conn.state === 'connected');
  const modelOptions = (() => {
    const list = models.data?.models ?? CHATGPT_FALLBACK_MODELS.map((id) => ({ id, label: id }));
    return draft.model && !list.some((model) => model.id === draft.model)
      ? [...list, { id: draft.model, label: draft.model }]
      : list;
  })();

  /** EXPERIMENTAL one-click sign-in: save ChatGPT mode if needed, start sign-in, open the page. */
  const signIn = async () => {
    setLocalError(null);
    test.reset();
    await chatgpt.signIn(status, draft.model);
  };

  const finishPasted = () => {
    const url = pasted.trim();
    if (!url) return;
    action.mutate({ kind: 'callback', url }, { onSuccess: () => setPasted('') });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    await commit(false);
  };

  const commit = async (skipKeyTest: boolean) => {
    setLocalError(null);
    // Claude has no key to fall back on: the first save needs one.
    if (keyMode === 'claude' && !newKey && !status.hasClaudeApiKey) {
      setLocalError(t('ai.claude.keyRequired'));
      return;
    }
    if (keyMode && newKey && testedKeys[keyMode] !== newKey && !skipKeyTest) {
      try {
        if (!(await runKeyTest(keyMode, newKey))) return;
      } catch {
        return; // shown from the key test's error
      }
    }
    const parsed = AiConnectionBody.safeParse({
      ...draft,
      ...(newKey ? { apiKey: newKey } : {}),
    });
    if (!parsed.success) {
      setLocalError(
        draft.mode === 'chatgpt' && parsed.error.issues[0]?.path[0] === 'model'
          ? t('ai.modelInvalid', {
              models: modelOptions.map((model) => model.id).join(t('ai.modelSeparator')),
            })
          : t('ai.checkSettings'),
      );
      return;
    }
    action.mutate(
      { kind: 'connection', settings: parsed.data },
      {
        onSuccess: (next) => {
          setDrafts(draftsFrom(next.settings));
          setKeys(NO_KEYS);
          setReplacing({ api: false, claude: false });
          setTestedKeys({ api: null, claude: null });
          keyTests.api.reset();
          keyTests.claude.reset();
          toast.success(t('ai.connectionSaved'));
        },
      },
    );
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t('ai.settingsTitle')}</CardTitle>
        <CardDescription>{t('ai.settingsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-5">
          <AiConnectionBanner status={status} />
          <div className="flex flex-col gap-2">
            <Label id={modeLabelId}>{t('ai.connectionMode')}</Label>
            {/* Three options do not fit one segmented row at 360 px: option cards, as in Voice
                messages. */}
            <RadioGroup
              aria-labelledby={modeLabelId}
              value={draft.mode}
              onValueChange={(mode) => setDrafts((old) => ({ ...old, mode: mode as Mode }))}
              disabled={action.isPending}
              className="grid gap-2 sm:grid-cols-3"
            >
              {modeOptions.map((option) => {
                const id = `ai-mode-${option.value}`;
                return (
                  <Label
                    key={option.value}
                    htmlFor={id}
                    className={cn(
                      'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 leading-normal transition-colors hover:bg-accent',
                      draft.mode === option.value && 'border-primary bg-primary/5',
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <RadioGroupItem id={id} value={option.value} />
                      {option.label}
                      {/* pointer-events-none: a click on the badge must select the option. */}
                      {option.value === 'chatgpt' && (
                        <Badge variant="secondary" className="pointer-events-none">
                          {t('ai.connect.recommended')}
                        </Badge>
                      )}
                    </span>
                    <span className="font-normal text-muted-foreground">{option.hint}</span>
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          {keyMode ? (
            <div className="flex flex-col gap-3">
              <KeyEditor
                key={keyMode}
                mode={keyMode}
                saved={savedKey[keyMode]}
                replacing={replacing[keyMode]}
                value={keys[keyMode]}
                tested={testedKeys[keyMode]}
                check={keyTests[keyMode]}
                busy={action.isPending}
                onReplace={(on) => {
                  setReplacing((old) => ({ ...old, [keyMode]: on }));
                  if (!on) {
                    setKeys((old) => ({ ...old, [keyMode]: '' }));
                    keyTests[keyMode].reset();
                  }
                }}
                onChange={(value) => {
                  setKeys((old) => ({ ...old, [keyMode]: value }));
                  keyTests[keyMode].reset();
                }}
                onTest={() => void runKeyTest(keyMode, newKey).catch(() => undefined)}
                onSaveAnyway={() => void commit(true)}
              />
              {keyMode === 'claude' && (
                <Button
                  asChild
                  variant="link"
                  size="touch"
                  className="h-auto self-start px-0 text-left whitespace-normal"
                >
                  <a href={ANTHROPIC_CONSOLE_URL} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden />
                    {t('ai.claude.getKey')}
                  </a>
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('ai.connect.note')}</p>
              <p className="text-sm text-muted-foreground">{t('ai.remoteSignInHint')}</p>
              <p role="status" className="text-sm">
                {savedChatgpt && conn.state === 'connected'
                  ? conn.email
                    ? t('ai.signedInAs', { email: conn.email })
                    : t('ai.signedIn')
                  : savedChatgpt
                    ? t('ai.chatgptState', { state: stateLabels[conn.state] })
                    : t('ai.signInSavesMode')}
              </p>
              {savedChatgpt && conn.state === 'connected' && conn.error && (
                <Banner tone="danger">{conn.error}</Banner>
              )}
              <div className="flex flex-wrap gap-2">
                {savedChatgpt && conn.state === 'signing_in' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ kind: 'logout' })}
                  >
                    {t('ai.cancelLogin')}
                  </Button>
                ) : savedChatgpt && conn.state === 'connected' ? null : (
                  <Button
                    type="button"
                    size="touch"
                    disabled={action.isPending}
                    onClick={() => void signIn()}
                  >
                    {t('ai.signInWithChatgpt')}
                  </Button>
                )}
                {hasTokens && conn.state !== 'signing_in' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ kind: 'logout' })}
                  >
                    {t('ai.signOut')}
                  </Button>
                )}
                {savedChatgpt && loginUrl && (
                  <Button asChild variant="outline" size="touch">
                    <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden />
                      {t('ai.openLogin')}
                    </a>
                  </Button>
                )}
                {savedChatgpt && loginUrl && chatgpt.popupBlocked && (
                  <p className="self-center text-sm text-muted-foreground">
                    {t('ai.popupBlocked')}
                  </p>
                )}
              </div>
              {conn.loginUrl && !loginUrl && <Banner tone="danger">{t('ai.invalidLink')}</Banner>}
              {savedChatgpt && conn.state === 'signing_in' && (
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <Field label={t('ai.pasteLabel')} hint={t('ai.pasteHint')}>
                    {(p) => (
                      <Input
                        {...p}
                        value={pasted}
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t('ai.pastePlaceholder')}
                        disabled={action.isPending}
                        onChange={(e) => setPasted(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            finishPasted();
                          }
                        }}
                      />
                    )}
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    size="touch"
                    className="self-start"
                    disabled={action.isPending || !pasted.trim()}
                    onClick={finishPasted}
                  >
                    {t('ai.pasteSubmit')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {draft.mode === 'chatgpt' ? (
            <Field
              label={t('ai.chatgptModel')}
              hint={models.data?.source === 'live' ? t('ai.modelsLive') : t('ai.modelsFallback')}
            >
              {(p) => (
                <Select
                  value={draft.model || AUTO_MODEL}
                  disabled={action.isPending}
                  onValueChange={(value) => setModel(value === AUTO_MODEL ? '' : value)}
                >
                  <SelectTrigger {...p} className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO_MODEL}>{t('ai.modelAuto')}</SelectItem>
                    {modelOptions.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : draft.mode === 'claude' ? (
            <div className="flex flex-col gap-3">
              {/* '' (the server's default) shows as Sonnet, the default model. */}
              <Field label={t('ai.claude.model')} hint={t('ai.claude.modelHint')}>
                {(p) => (
                  <Select
                    value={draft.model || CLAUDE_DEFAULT_MODEL}
                    disabled={action.isPending}
                    onValueChange={setModel}
                  >
                    <SelectTrigger {...p} className="min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CLAUDE_MODELS.map((id) => (
                        <SelectItem key={id} value={id}>
                          {t(CLAUDE_MODEL_LABELS[id])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <p className="text-sm text-muted-foreground">{t('ai.claude.voiceNote')}</p>
            </div>
          ) : (
            // Most inboxes keep the default model, so the free-text model id sits behind Advanced.
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="ghost"
                size="touch"
                aria-expanded={showApiModel}
                aria-controls={apiModelId}
                className="justify-start self-start px-2 whitespace-normal text-left"
                onClick={() => setApiModelOpen((open) => !open)}
              >
                <ChevronRight
                  aria-hidden
                  className={cn('transition-transform', showApiModel && 'rotate-90')}
                />
                {t('ai.modelAdvanced')}
              </Button>
              <div id={apiModelId} hidden={!showApiModel}>
                <Field label={t('ai.model')} hint={t('ai.apiModelHint')}>
                  {(p) => (
                    <Input
                      {...p}
                      value={draft.model}
                      maxLength={128}
                      disabled={action.isPending}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </div>
          )}

          {draft.mode === 'chatgpt' &&
            hasTokens &&
            (conn.state === 'connected' || conn.state === 'error') && (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="touch"
                  className="self-start"
                  disabled={action.isPending || test.isPending || dirty}
                  onClick={() => test.mutate()}
                >
                  <Pending show={test.isPending} />
                  {t('ai.testConnection')}
                </Button>
                {dirty && <p className="text-sm text-muted-foreground">{t('ai.saveBeforeTest')}</p>}
                {test.data &&
                  (test.data.ok ? (
                    <p role="status" className="text-sm break-words">
                      {t('ai.testOk', {
                        model: test.data.model ?? '',
                        reply: test.data.reply ?? '',
                      })}
                    </p>
                  ) : (
                    <Banner tone="danger">
                      {t('ai.testFailed', { error: test.data.error ?? '' })}
                    </Banner>
                  ))}
                {test.error && <Banner tone="danger">{errorMessage(test.error)}</Banner>}
              </div>
            )}

          {connectionReady(status) && !dirty && (
            <div className="flex flex-col gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" className="inline-flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {t('ai.connectionReady')}
              </p>
              <Button asChild size="touch" variant="outline" className="sm:shrink-0">
                <Link to={aiAgentsPath(status)}>
                  {status.agents.length > 1 ? t('ai.openAgents') : t('ai.setupAgent')}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          )}
          {Boolean(refreshError) && (
            <Banner tone="danger">
              {t('ai.refreshError', { error: errorMessage(refreshError) })}
            </Banner>
          )}
          {(localError || action.error) && (
            <Banner tone="danger">{localError ?? errorMessage(action.error)}</Banner>
          )}
          <SaveBar dirty={dirty} inset="card">
            <Button
              type="submit"
              size="touch"
              disabled={action.isPending || keyTestPending || !dirty}
            >
              <Pending show={action.isPending || keyTestPending} />
              {t('ai.saveConnection')}
            </Button>
          </SaveBar>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The API key of one key mode (OpenAI or Claude): a saved key is never shown, only "saved" with
 * Replace; a new key is typed, tested before it is saved, and may be saved anyway after a check
 * that did not reject it.
 */
function KeyEditor({
  mode,
  saved,
  replacing,
  value,
  tested,
  check,
  busy,
  onReplace,
  onChange,
  onTest,
  onSaveAnyway,
}: {
  mode: KeyMode;
  saved: boolean;
  replacing: boolean;
  value: string;
  tested: string | null;
  check: ReturnType<typeof useTestApiKey>;
  busy: boolean;
  onReplace: (on: boolean) => void;
  onChange: (value: string) => void;
  onTest: () => void;
  onSaveAnyway: () => void;
}) {
  const { t } = useTranslation('admin');
  const claude = mode === 'claude';
  const label = claude ? t('ai.claude.keyLabel') : t('ai.apiKey');
  const key = value.trim();
  if (saved && !replacing)
    // A saved key is never shown; say so plainly instead of an empty "hidden" field.
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm leading-none font-medium">{label}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="inline-flex items-center gap-2 text-sm">
            <KeyRound className="size-4 text-success" aria-hidden />
            {claude ? t('ai.claude.keySaved') : t('ai.keySaved')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="md:pointer-fine:min-h-8"
            disabled={busy}
            onClick={() => onReplace(true)}
          >
            {t('ai.replaceKey')}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <Field
        label={label}
        hint={saved ? t('ai.keepKeyHint') : claude ? t('ai.claude.keyHint') : t('ai.apiKeyHint')}
        error={check.data && !check.data.ok ? keyTestMessage(t, check.data.error, mode) : undefined}
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            value={value}
            autoComplete="new-password"
            spellCheck={false}
            disabled={busy || check.isPending}
            onChange={(e) => onChange(e.target.value)}
            placeholder={claude ? t('ai.claude.keyPlaceholder') : t('ai.enterKey')}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="touch"
          disabled={!key || check.isPending || busy}
          onClick={onTest}
        >
          <Pending show={check.isPending} />
          {t('ai.connect.testKey')}
        </Button>
        {check.data && !check.data.ok && !keyTestBlocks(check.data.error) && (
          <Button
            type="button"
            variant="outline"
            size="touch"
            disabled={!key || busy}
            onClick={onSaveAnyway}
          >
            {t('ai.connect.saveAnyway')}
          </Button>
        )}
        {check.data?.ok && tested === key && (
          <p role="status" className="inline-flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="size-4 text-success" aria-hidden />
            {t('ai.keyOk')}
          </p>
        )}
      </div>
      {check.error && <Banner tone="danger">{errorMessage(check.error)}</Banner>}
      {saved && (
        <Button
          type="button"
          variant="ghost"
          size="touch"
          className="self-start"
          disabled={busy}
          onClick={() => onReplace(false)}
        >
          {t('ai.keepKey')}
        </Button>
      )}
    </div>
  );
}
