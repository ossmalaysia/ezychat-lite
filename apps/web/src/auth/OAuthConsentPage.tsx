import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OAuthDecisionBody } from '@ezychat/shared';
import { ApiError, errorMessage } from '../api/client';
import { useOAuthDecision, useOAuthRequest } from '../api/queries';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { AuthShell, ButtonSpinner, FullPageLoader } from './AuthShell';

/** Why the page cannot ask for approval, in the admin's language. */
function useProblem() {
  const { t } = useTranslation('auth');
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.status === 403) return t('oauth.adminOnly');
      if (e.status === 409) return t('oauth.accessOff');
      if (e.status === 400) return t('oauth.badRequest');
    }
    return errorMessage(e);
  };
}

/**
 * /oauth/authorize: an AI assistant app (claude.ai, ChatGPT, …) sent the admin here to approve its
 * connection to the inbox. Approve sends the browser back to the app with a one-time code; the
 * server never redirects an unchecked request (bad requests stay on this page).
 */
export function OAuthConsentPage() {
  const { t } = useTranslation('auth');
  const { search } = useLocation();
  const query = search.startsWith('?') ? search.slice(1) : search;
  const request = useOAuthRequest(query);
  const decision = useOAuthDecision();
  const problem = useProblem();
  // The button the admin pressed: it spins until the browser has left for the app.
  const [choice, setChoice] = useState<boolean | null>(null);

  if (request.isPending) return <FullPageLoader />;
  if (request.isError) {
    return (
      <AuthShell title={t('oauth.errorTitle')}>
        <div className="flex flex-col gap-4">
          <Banner tone="danger">{problem(request.error)}</Banner>
          <Button asChild variant="outline" size="touch">
            <Link to="/">{t('oauth.backToInbox')}</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const { clientName, redirectHost } = request.data;
  const name = clientName || t('oauth.unnamedApp');
  const busy = decision.isPending || decision.isSuccess;
  const decide = (approve: boolean) => {
    setChoice(approve);
    const params = Object.fromEntries(new URLSearchParams(query));
    decision.mutate({ ...params, approve } as OAuthDecisionBody, {
      onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
    });
  };

  return (
    <AuthShell title={t('oauth.title', { name })} subtitle={t('oauth.subtitle')}>
      <div className="flex flex-col gap-4" data-testid="oauth-consent">
        <p className="rounded-md bg-muted px-3 py-2.5 text-sm">
          {/* A margin, not a literal space, separates the label: Chinese takes no space. */}
          <span className="me-1 font-medium">{t('oauth.returnsTo')}</span>
          <code className="font-mono text-xs [overflow-wrap:anywhere]" data-testid="oauth-host">
            {redirectHost}
          </code>
        </p>
        <div className="flex flex-col gap-1.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
            {t('oauth.canTitle')}
          </p>
          <ul className="list-disc ps-5 text-muted-foreground">
            <li>{t('oauth.canRead')}</li>
            <li>{t('oauth.canSetup')}</li>
          </ul>
          <p className="text-muted-foreground">{t('oauth.sendLater')}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t('oauth.trust', { host: redirectHost })}</p>
        {decision.error != null && <Banner tone="danger">{problem(decision.error)}</Banner>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="touch"
            disabled={busy}
            onClick={() => decide(false)}
          >
            {busy && choice === false && <ButtonSpinner />}
            {t('oauth.deny')}
          </Button>
          <Button type="button" size="touch" disabled={busy} onClick={() => decide(true)}>
            {busy && choice === true && <ButtonSpinner />}
            {t('oauth.approve')}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
