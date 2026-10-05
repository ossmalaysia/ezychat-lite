import { useId, useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  AiConnectionBody,
  CHATGPT_FALLBACK_MODELS,
  type AiMemberStatus,
  type AiSettings,
} from '@wa-team-inbox/shared';
import { useAiMember, useAiMemberAction, useAiModels, useAiTest } from '../api/ai';
import { errorMessage } from '../api/client';
import { Banner, SegmentedControl } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AiConnectionBanner } from './AiConnectionBanner';
import { officialLoginUrl } from './ai-status';
import { ErrorState, Field, ListSkeleton, Pending } from './adminUi';

/** Radix Select needs a non-empty value; '' (Auto) is what is stored. */
const AUTO_MODEL = 'auto';
type ConnectionDraft = Pick<AiSettings, 'mode' | 'model'>;

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
  // Status polling replaces `status`; the draft keeps what the admin has not saved yet.
  const [draft, setDraft] = useState<ConnectionDraft>({
    mode: status.settings.mode,
    model: status.settings.model,
  });
  const [apiKey, setApiKey] = useState('');
  const [pasted, setPasted] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const action = useAiMemberAction();
  const test = useAiTest();
  const saved = status.settings;
  const conn = status.connection;
  const savedChatgpt = saved.mode === 'chatgpt';
  const dirty = draft.mode !== saved.mode || draft.model !== saved.model || apiKey.trim() !== '';
  const loginUrl = officialLoginUrl(conn.loginUrl);
  // Stored tokens exist (even if expired or rejected): sign-out and testing apply.
  const hasTokens =
    savedChatgpt && (Boolean(conn.email) || ['connected', 'expired', 'error'].includes(conn.state));
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
    // Open the tab synchronously so the browser treats it as user-initiated.
    const tab = window.open('about:blank', '_blank');
    try {
      if (!savedChatgpt) {
        const parsed = AiConnectionBody.safeParse({ mode: 'chatgpt', model: draft.model });
        await action.mutateAsync({
          kind: 'connection',
          settings: parsed.success ? parsed.data : { mode: 'chatgpt', model: '' },
        });
      }
      const next = await action.mutateAsync({ kind: 'login' });
      const url = officialLoginUrl(next.connection.loginUrl);
      if (tab && url) {
        tab.opener = null;
        tab.location.href = url;
      } else tab?.close();
    } catch {
      // The mutation error is shown below the form.
      tab?.close();
    }
  };

  const finishPasted = () => {
    const url = pasted.trim();
    if (!url) return;
    action.mutate({ kind: 'callback', url }, { onSuccess: () => setPasted('') });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const parsed = AiConnectionBody.safeParse({
      ...draft,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
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
          setDraft({ mode: next.settings.mode, model: next.settings.model });
          setApiKey('');
          toast.success(t('ai.connectionSaved'));
        },
      },
    );
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('ai.settingsTitle')}
          {dirty && <Badge variant="outline">{t('ai.unsaved')}</Badge>}
        </CardTitle>
        <CardDescription>{t('ai.settingsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-5">
          <AiConnectionBanner status={status} />
          <div className="flex flex-col gap-2">
            <Label id={modeLabelId}>{t('ai.connectionMode')}</Label>
            <SegmentedControl
              aria-labelledby={modeLabelId}
              value={draft.mode}
              onValueChange={(mode) =>
                setDraft((old) => ({ mode, model: old.mode === mode ? old.model : '' }))
              }
              options={[
                { value: 'api', label: t('ai.modeApi') },
                {
                  value: 'chatgpt',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      {t('ai.modeChatgpt')}
                      <Badge variant="outline" className="px-1.5 text-xs">
                        {t('ai.experimental')}
                      </Badge>
                    </span>
                  ),
                },
              ]}
            />
          </div>

          {draft.mode === 'api' ? (
            <Field
              label={t('ai.apiKey')}
              hint={status.hasApiKey ? t('ai.keepKeyHint') : t('ai.apiKeyHint')}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  value={apiKey}
                  autoComplete="new-password"
                  disabled={action.isPending}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={status.hasApiKey ? t('ai.hiddenKey') : t('ai.enterKey')}
                />
              )}
            </Field>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('ai.directLoginHint')}</p>
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
                  onValueChange={(value) =>
                    setDraft((old) => ({ ...old, model: value === AUTO_MODEL ? '' : value }))
                  }
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
          ) : (
            <Field label={t('ai.model')} hint={t('ai.apiModelHint')}>
              {(p) => (
                <Input
                  {...p}
                  value={draft.model}
                  maxLength={128}
                  disabled={action.isPending}
                  onChange={(e) => setDraft((old) => ({ ...old, model: e.target.value }))}
                />
              )}
            </Field>
          )}

          {hasTokens && (conn.state === 'connected' || conn.state === 'error') && (
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
                    {t('ai.testOk', { model: test.data.model ?? '', reply: test.data.reply ?? '' })}
                  </p>
                ) : (
                  <Banner tone="danger">
                    {t('ai.testFailed', { error: test.data.error ?? '' })}
                  </Banner>
                ))}
              {test.error && <Banner tone="danger">{errorMessage(test.error)}</Banner>}
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
          <div className="flex justify-end">
            <Button type="submit" size="touch" disabled={action.isPending || !dirty}>
              <Pending show={action.isPending} />
              {t('ai.saveConnection')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
