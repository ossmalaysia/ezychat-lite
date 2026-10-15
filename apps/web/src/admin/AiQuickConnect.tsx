import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { AiKeyTestResponse, type AiKeyTestError, type AiMemberStatus } from '@wa-team-inbox/shared';
import { useAiMemberAction } from '../api/ai';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectionReady, officialLoginUrl } from './ai-status';
import { Field, Pending } from './adminUi';
import { useChatgptSignIn } from './use-chatgpt-sign-in';

/** Checks an OpenAI API key with one small request; the server never stores or logs it. */
export function useTestApiKey() {
  return useMutation({
    mutationFn: (apiKey: string) =>
      api('/ai/connection/test', {
        method: 'POST',
        body: { apiKey },
        schema: AiKeyTestResponse,
      }),
  });
}

/** The message for a failed key test (`ok: false`). */
export function keyTestMessage(
  t: TFunction<'admin'>,
  error: AiKeyTestError | null | undefined,
): string {
  switch (error) {
    case 'invalid_key':
      return t('ai.connect.keyInvalid');
    case 'unreachable':
      return t('ai.connect.keyUnreachable');
    case 'rate_limited':
      return t('ai.connect.keyRateLimited');
    default:
      return t('ai.connect.keyFailedFallback');
  }
}

/**
 * One compact "connect the AI" block, used by the setup wizard and the Sales Agent page.
 * Sign in with ChatGPT first (recommended); an OpenAI API key is the secondary option and is
 * tested before it is saved.
 */
export function AiQuickConnect({ status }: { status: AiMemberStatus }) {
  const { t } = useTranslation('admin');
  const action = useAiMemberAction();
  const testKey = useTestApiKey();
  const chatgpt = useChatgptSignIn(action);
  const noteId = useId();
  // ChatGPT is the recommended path; a not-ready API mode has no key yet, so start there too.
  const [useKey, setUseKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [pasted, setPasted] = useState('');
  const conn = status.connection;
  const savedChatgpt = status.settings.mode === 'chatgpt';

  if (connectionReady(status))
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">
            {savedChatgpt ? t('ai.connect.connectedChatgpt') : t('ai.connect.connectedKey')}
          </p>
          {savedChatgpt && conn.email && (
            <p className="break-words text-muted-foreground">
              {t('ai.connect.connectedAs', { email: conn.email })}
            </p>
          )}
        </div>
      </div>
    );

  const signingIn = savedChatgpt && conn.state === 'signing_in';
  const loginUrl = officialLoginUrl(conn.loginUrl);

  const signIn = () => {
    testKey.reset();
    void chatgpt.signIn(status);
  };

  const finishPasted = () => {
    const url = pasted.trim();
    if (!url) return;
    action.mutate({ kind: 'callback', url }, { onSuccess: () => setPasted('') });
  };

  /** Test the key, and save it straight away when it works (no separate Save click). */
  const checkAndSave = async () => {
    const key = apiKey.trim();
    if (!key) return;
    action.reset();
    try {
      const result = await testKey.mutateAsync(key);
      if (!result.ok) return;
      await action.mutateAsync({
        kind: 'connection',
        settings: {
          mode: 'api',
          model: status.settings.mode === 'api' ? status.settings.model : '',
          apiKey: key,
        },
      });
      setApiKey('');
    } catch {
      /* shown below */
    }
  };

  const keyFailed = testKey.data && !testKey.data.ok;

  return (
    <div className="flex flex-col gap-4">
      {!useKey ? (
        <div className="flex flex-col gap-3">
          {signingIn ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="inline-flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                  {t('ai.connect.signingIn')}
                </p>
                {loginUrl && (
                  <Button asChild variant="outline" size="touch">
                    <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden />
                      {t('ai.openLogin')}
                    </a>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="touch"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ kind: 'logout' })}
                >
                  {t('ai.connect.cancel')}
                </Button>
              </div>
              {loginUrl && chatgpt.popupBlocked && (
                <p className="text-sm text-muted-foreground">{t('ai.popupBlocked')}</p>
              )}
              {conn.loginUrl && !loginUrl && <Banner tone="danger">{t('ai.invalidLink')}</Banner>}
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
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="touch"
                className="w-full sm:w-auto"
                aria-describedby={noteId}
                disabled={action.isPending}
                onClick={signIn}
              >
                {action.isPending ? <Pending show /> : <Sparkles aria-hidden />}
                {t('ai.connect.chatgpt')}
              </Button>
              <Badge variant="secondary" className="pointer-events-none">
                {t('ai.connect.recommended')}
              </Badge>
            </div>
          )}
          {savedChatgpt && !signingIn && conn.error && <Banner tone="danger">{conn.error}</Banner>}
          <p id={noteId} className="text-sm text-muted-foreground">
            {t('ai.connect.note')}
          </p>
          {!signingIn && (
            <Button
              type="button"
              variant="link"
              size="touch"
              className="h-auto self-start px-0 text-left whitespace-normal"
              onClick={() => {
                action.reset();
                chatgpt.resetPopup();
                setUseKey(true);
              }}
            >
              {t('ai.connect.useKey')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field
            label={t('ai.connect.keyLabel')}
            hint={t('ai.connect.keyHint')}
            error={keyFailed ? keyTestMessage(t, testKey.data?.error) : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                value={apiKey}
                autoComplete="off"
                spellCheck={false}
                className="h-11 text-base md:text-sm"
                disabled={testKey.isPending || action.isPending}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  testKey.reset();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void checkAndSave();
                  }
                }}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="touch"
              className="w-full sm:w-auto"
              disabled={!apiKey.trim() || testKey.isPending || action.isPending}
              onClick={() => void checkAndSave()}
            >
              {testKey.isPending || action.isPending ? <Pending show /> : <KeyRound aria-hidden />}
              {t('ai.connect.testKey')}
            </Button>
          </div>
          <Button
            type="button"
            variant="link"
            size="touch"
            className="h-auto self-start px-0 text-left whitespace-normal"
            onClick={() => {
              testKey.reset();
              action.reset();
              setUseKey(false);
            }}
          >
            {t('ai.connect.useChatgpt')}
          </Button>
        </div>
      )}
      {(action.error || testKey.error) && (
        <Banner tone="danger">{errorMessage(action.error ?? testKey.error)}</Banner>
      )}
    </div>
  );
}
