import { useEffect, useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Sparkles } from 'lucide-react';
import {
  AiKeyTestResponse,
  type AiKeyTestError,
  type AiMemberStatus,
  type AiSettings,
} from '@ezychat/shared';
import { useAiMemberAction } from '../api/ai';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectionReady, officialLoginUrl } from './ai-status';
import { Field, Pending } from './adminUi';
import { useChatgptSignIn } from './use-chatgpt-sign-in';

/** The connection modes that use an API key: `api` = OpenAI, `claude` = Anthropic. */
export type KeyMode = Exclude<AiSettings['mode'], 'chatgpt'>;
/** Where an admin creates a Claude key (the desktop shell opens it in the OS browser). */
export const ANTHROPIC_CONSOLE_URL = 'https://console.anthropic.com/settings/keys';
/** A failed check: the server's verdict, or `other_vendor` (found from the prefix, never sent). */
export type KeyTestError = AiKeyTestError | 'other_vendor';
export type KeyTestResult = { ok: boolean; error: KeyTestError | null };

/** Every Anthropic key starts with `sk-ant-`; OpenAI keys start with `sk-` but never `sk-ant-`. */
function otherVendorKey(mode: KeyMode, key: string): boolean {
  const anthropic = key.startsWith('sk-ant-');
  return mode === 'claude' ? key.startsWith('sk-') && !anthropic : anthropic;
}

/**
 * Checks an OpenAI or Claude API key with one small request; the server never stores or logs it.
 * A key of the other vendor is caught from its prefix and never sent.
 */
export function useTestApiKey() {
  return useMutation({
    mutationFn: async ({
      apiKey,
      mode = 'api',
    }: {
      apiKey: string;
      mode?: KeyMode;
    }): Promise<KeyTestResult> => {
      if (otherVendorKey(mode, apiKey)) return { ok: false, error: 'other_vendor' };
      return api('/ai/connection/test', {
        method: 'POST',
        // `mode` is left out for OpenAI, the default of every server version.
        body: mode === 'claude' ? { apiKey, mode } : { apiKey },
        schema: AiKeyTestResponse,
      });
    },
  });
}

/**
 * Only a key the service rejected outright (401), or a key of the other vendor, is refused. Any
 * other failed test may be a key that still answers customers (no Models permission, a region block,
 * a passing limit), so it can be saved anyway.
 */
export function keyTestBlocks(error: KeyTestError | null | undefined): boolean {
  return error === 'invalid_key' || error === 'other_vendor';
}

/** The message for a failed key test (`ok: false`), naming the vendor of `mode`. */
export function keyTestMessage(
  t: TFunction<'admin'>,
  error: KeyTestError | null | undefined,
  mode: KeyMode = 'api',
): string {
  const claude = mode === 'claude';
  switch (error) {
    case 'other_vendor':
      return claude ? t('ai.claude.openAiKey') : t('ai.connect.claudeKey');
    case 'invalid_key':
      return claude ? t('ai.claude.keyInvalid') : t('ai.connect.keyInvalid');
    case 'forbidden':
      return claude ? t('ai.claude.keyForbidden') : t('ai.connect.keyForbidden');
    case 'unreachable':
      return claude ? t('ai.claude.keyUnreachable') : t('ai.connect.keyUnreachable');
    case 'rate_limited':
      return claude ? t('ai.claude.keyRateLimited') : t('ai.connect.keyRateLimited');
    case 'no_credit':
      return claude ? t('ai.claude.keyNoCredit') : t('ai.connect.keyRejected');
    case 'rejected':
      return claude ? t('ai.claude.keyRejected') : t('ai.connect.keyRejected');
    default:
      return t('ai.connect.keyFailedFallback');
  }
}

/**
 * One compact "connect the AI" block, used by the setup wizard and the agent page.
 * Sign in with ChatGPT first (recommended); an OpenAI or a Claude API key are the other options,
 * each tested before it is saved.
 */
export function AiQuickConnect({ status }: { status: AiMemberStatus }) {
  const { t } = useTranslation('admin');
  const action = useAiMemberAction();
  const testKey = useTestApiKey();
  const chatgpt = useChatgptSignIn(action);
  const noteId = useId();
  // ChatGPT is the recommended path; a not-ready OpenAI mode has no key yet, so start there too.
  // A saved Claude connection that is not ready opens on its key.
  const [view, setView] = useState<'chatgpt' | KeyMode>(
    status.settings.mode === 'claude' ? 'claude' : 'chatgpt',
  );
  const keyMode: KeyMode = view === 'claude' ? 'claude' : 'api';
  const [apiKey, setApiKey] = useState('');
  const [pasted, setPasted] = useState('');
  const keyInputRef = useRef<HTMLInputElement>(null);
  const conn = status.connection;
  const savedChatgpt = status.settings.mode === 'chatgpt';
  const savedClaude = status.settings.mode === 'claude';

  const keyFailed = Boolean(testKey.data && !testKey.data.ok);
  const canSaveAnyway = keyFailed && !keyTestBlocks(testKey.data?.error);

  // A failed test moves focus back to the key, so screen readers read its error.
  useEffect(() => {
    if (keyFailed) keyInputRef.current?.focus();
  }, [keyFailed]);

  if (connectionReady(status))
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">
            {savedChatgpt
              ? t('ai.connect.connectedChatgpt')
              : savedClaude
                ? t('ai.claude.connected')
                : t('ai.connect.connectedKey')}
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

  const saveKey = async (key: string) => {
    await action.mutateAsync({
      kind: 'connection',
      settings: {
        mode: keyMode,
        // The model saved for this mode stays; another mode's model means nothing here.
        model: status.settings.mode === keyMode ? status.settings.model : '',
        apiKey: key,
      },
    });
    setApiKey('');
    testKey.reset();
  };

  /** Test the key, and save it straight away when it works (no separate Save click). */
  const checkAndSave = async () => {
    const key = apiKey.trim();
    if (!key) return;
    action.reset();
    try {
      const result = await testKey.mutateAsync({ apiKey: key, mode: keyMode });
      if (!result.ok) return;
      await saveKey(key);
    } catch {
      /* shown below */
    }
  };

  /** After a test that failed for a reason other than a rejected key. */
  const saveAnyway = async () => {
    const key = apiKey.trim();
    if (!key) return;
    action.reset();
    try {
      await saveKey(key);
    } catch {
      /* shown below */
    }
  };

  const switchTo = (next: 'chatgpt' | KeyMode) => {
    testKey.reset();
    action.reset();
    chatgpt.resetPopup();
    setApiKey('');
    setView(next);
  };
  const linkClass = 'h-auto px-0 text-left whitespace-normal';

  return (
    <div className="flex flex-col gap-4">
      {view === 'chatgpt' ? (
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
            <div className="flex flex-col items-start">
              <Button
                type="button"
                variant="link"
                size="touch"
                className={linkClass}
                onClick={() => switchTo('api')}
              >
                {t('ai.connect.useKey')}
              </Button>
              <Button
                type="button"
                variant="link"
                size="touch"
                className={linkClass}
                onClick={() => switchTo('claude')}
              >
                {t('ai.claude.useClaude')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field
            label={view === 'claude' ? t('ai.claude.keyLabel') : t('ai.connect.keyLabel')}
            hint={view === 'claude' ? t('ai.claude.keyHint') : t('ai.connect.keyHint')}
            error={keyFailed ? keyTestMessage(t, testKey.data?.error, keyMode) : undefined}
          >
            {(p) => (
              <Input
                {...p}
                ref={keyInputRef}
                type="password"
                value={apiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  view === 'claude' ? t('ai.claude.keyPlaceholder') : t('ai.connect.keyPlaceholder')
                }
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
            {canSaveAnyway && (
              <Button
                type="button"
                variant="outline"
                size="touch"
                className="w-full sm:w-auto"
                disabled={action.isPending}
                onClick={() => void saveAnyway()}
              >
                {t('ai.connect.saveAnyway')}
              </Button>
            )}
            {view === 'claude' && (
              <Button asChild variant="link" size="touch" className={linkClass}>
                <a href={ANTHROPIC_CONSOLE_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />
                  {t('ai.claude.getKey')}
                </a>
              </Button>
            )}
          </div>
          {view === 'claude' && (
            <p className="text-sm text-muted-foreground">{t('ai.claude.voiceNote')}</p>
          )}
          <div className="flex flex-col items-start">
            <Button
              type="button"
              variant="link"
              size="touch"
              className={linkClass}
              onClick={() => switchTo('chatgpt')}
            >
              {t('ai.connect.useChatgpt')}
            </Button>
            <Button
              type="button"
              variant="link"
              size="touch"
              className={linkClass}
              onClick={() => switchTo(view === 'claude' ? 'api' : 'claude')}
            >
              {view === 'claude' ? t('ai.connect.useKey') : t('ai.claude.useClaude')}
            </Button>
          </div>
        </div>
      )}
      {(action.error || testKey.error) && (
        <Banner tone="danger">{errorMessage(action.error ?? testKey.error)}</Banner>
      )}
    </div>
  );
}
