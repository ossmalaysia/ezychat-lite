// Proposed (mcp-for-members), mock only: the app sign-in approve page (`/oauth/authorize`) as a signed-in team member.
// Production: the server's `/oauth/authorize` page through `/api/oauth/request` and `/api/oauth/decision`, which accept a
// member while "Members can connect AI assistants" is on (else 403 `mcp_members_off`); the approval is always for the
// signed-in person. Here Approve / Deny only change this page and the mock token list.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createMemberToken, useMembersEnabled } from '@/mock/members';
import { AuthShell } from './AuthShell';
import { useAuth } from './AuthProvider';

type Outcome = 'asking' | 'approved' | 'denied';

export function OAuthConsentPage() {
  const { t } = useTranslation('admin');
  const { user, isAdmin } = useAuth();
  const enabled = useMembersEnabled();
  const [params] = useSearchParams();
  const app = params.get('app')?.slice(0, 40) || 'Claude';
  const [outcome, setOutcome] = useState<Outcome>('asking');
  if (!user) return null;
  const name = user.displayName;

  const back = (
    <Button asChild variant="outline" size="touch" className="w-full">
      <Link to="/">{t('mockMembers.oauth.back')}</Link>
    </Button>
  );

  if (!isAdmin && !enabled)
    return (
      <AuthShell
        title={t('mockMembers.oauth.offTitle')}
        subtitle={t('mockMembers.oauth.signedInAs', { name })}
      >
        <div className="flex flex-col gap-4" data-testid="oauth-off">
          <div className="flex items-start gap-3 rounded-md bg-muted px-3 py-2.5 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>{t('mockMembers.oauth.off')}</p>
          </div>
          {back}
        </div>
      </AuthShell>
    );

  if (outcome !== 'asking')
    return (
      <AuthShell
        title={t(
          outcome === 'approved' ? 'mockMembers.oauth.approved' : 'mockMembers.oauth.denied',
        )}
      >
        <div className="flex flex-col gap-4" data-testid={`oauth-${outcome}`}>
          <div className="flex justify-center">
            {outcome === 'approved' ? (
              <CheckCircle2 className="size-10 text-success" aria-hidden />
            ) : (
              <XCircle className="size-10 text-muted-foreground" aria-hidden />
            )}
          </div>
          {back}
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      title={t('mockMembers.oauth.title', { app, name })}
      subtitle={t('mockMembers.oauth.body')}
    >
      <div className="flex flex-col gap-3" data-testid="oauth-ask">
        <p className="text-center text-sm text-muted-foreground">
          {t('mockMembers.oauth.signedInAs', { name })}
        </p>
        <Button
          size="touch"
          className="w-full"
          onClick={() => {
            if (!isAdmin)
              createMemberToken(
                { username: user.username, displayName: user.displayName },
                {
                  name: `${app} (app sign-in)`,
                  expiresInDays: null,
                  canSend: false,
                  canMessageNewNumbers: false,
                },
                { connectedApp: true },
              );
            setOutcome('approved');
          }}
        >
          {t('mockMembers.oauth.approve')}
        </Button>
        <Button
          variant="outline"
          size="touch"
          className="w-full"
          onClick={() => setOutcome('denied')}
        >
          {t('mockMembers.oauth.deny')}
        </Button>
      </div>
    </AuthShell>
  );
}
