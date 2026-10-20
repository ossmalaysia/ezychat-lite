import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, KeyRound, Loader2, Sparkles } from 'lucide-react';
import type { AiMemberStatus } from '@ezychat/shared';
import { useAiMemberAction } from '../api/ai';
import { api, errorMessage } from '../api/client';
import { Banner } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { connectionReady } from './ai-status';
import { Field, Pending } from './adminUi';

type KeyCheck = { ok: boolean; error: string | null };

/**
 * PROPOSED (mock): checks an OpenAI API key before it is saved. The mock runner accepts keys that
 * start with "sk-"; production would make one small real request with the key.
 */
export function useTestApiKey() {
  return useMutation({
    mutationFn: (apiKey: string) =>
      api<KeyCheck>('/mock/ai/test-key', { method: 'POST', body: { apiKey } }),
  });
}

/**
 * PROPOSED: one compact "connect the AI" block, used by the setup wizard and the Sales Agent page.
 * Sign in with ChatGPT first (recommended); an OpenAI API key is the secondary option and is
 * tested before it is saved.
 */
export function AiQuickConnect({ status }: { status: AiMemberStatus }) {
  const { t } = useTranslation('admin');
  const action = useAiMemberAction();
  const testKey = useTestApiKey();
  const noteId = useId();
  const [useKey, setUseKey] = useState(status.settings.mode === 'api');
  const [apiKey, setApiKey] = useState('');
  const conn = status.connection;
  const ready = connectionReady(status);

  if (ready)
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">
            {status.settings.mode === 'chatgpt'
              ? t('mockSetup.connect.connectedChatgpt')
              : t('mockSetup.connect.connectedKey')}
          </p>
          {status.settings.mode === 'chatgpt' && conn.email && (
            <p className="break-words text-muted-foreground">
              {t('mockSetup.connect.connectedAs', { email: conn.email })}
            </p>
          )}
        </div>
      </div>
    );

  const signingIn = status.settings.mode === 'chatgpt' && conn.state === 'signing_in';

  /** Saves ChatGPT mode if needed, then starts sign-in (the mock finishes it after 2.5 s). */
  const signIn = async () => {
    testKey.reset();
    try {
      if (status.settings.mode !== 'chatgpt')
        await action.mutateAsync({ kind: 'connection', settings: { mode: 'chatgpt', model: '' } });
      await action.mutateAsync({ kind: 'login' });
    } catch {
      /* shown from action.error */
    }
  };

  /** Test key, and save it straight away when it works (no separate Save click). */
  const checkAndSave = async () => {
    const key = apiKey.trim();
    if (!key) return;
    try {
      const result = await testKey.mutateAsync(key);
      if (!result.ok) return;
      await action.mutateAsync({
        kind: 'connection',
        settings: { mode: 'api', model: '', apiKey: key },
      });
      setApiKey('');
    } catch {
      /* shown below */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!useKey ? (
        <div className="flex flex-col gap-3">
          {signingIn ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="inline-flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                {t('mockSetup.connect.signingIn')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="touch"
                disabled={action.isPending}
                onClick={() => action.mutate({ kind: 'logout' })}
              >
                {t('mockSetup.connect.cancel')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="touch"
                className="w-full sm:w-auto"
                aria-describedby={noteId}
                disabled={action.isPending}
                onClick={() => void signIn()}
              >
                {action.isPending ? <Pending show /> : <Sparkles aria-hidden />}
                {t('mockSetup.connect.chatgpt')}
              </Button>
              <Badge variant="secondary" className="pointer-events-none">
                {t('mockSetup.connect.recommended')}
              </Badge>
            </div>
          )}
          <p id={noteId} className="text-sm text-muted-foreground">
            {t('mockSetup.connect.note')}
          </p>
          <Button
            type="button"
            variant="link"
            size="touch"
            className="h-auto self-start px-0 text-left whitespace-normal"
            onClick={() => {
              action.reset();
              setUseKey(true);
            }}
          >
            {t('mockSetup.connect.useKey')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field
            label={t('mockSetup.connect.keyLabel')}
            hint={t('mockSetup.connect.keyHint')}
            error={
              testKey.data && !testKey.data.ok
                ? (testKey.data.error ?? t('mockSetup.connect.keyFailedFallback'))
                : undefined
            }
          >
            {(p) => (
              <Input
                {...p}
                type="password"
                value={apiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-…"
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
              {t('mockSetup.connect.testKey')}
            </Button>
          </div>
          <Button
            type="button"
            variant="link"
            size="touch"
            className="h-auto self-start px-0 text-left whitespace-normal"
            onClick={() => {
              testKey.reset();
              setUseKey(false);
            }}
          >
            {t('mockSetup.connect.useChatgpt')}
          </Button>
        </div>
      )}
      {(action.error || testKey.error) && (
        <Banner tone="danger">{errorMessage(action.error ?? testKey.error)}</Banner>
      )}
    </div>
  );
}
