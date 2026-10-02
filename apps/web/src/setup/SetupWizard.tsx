import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Check, CircleCheck, Globe, Inbox, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApiError, errorMessage } from '../api/client';
import { useSetupAdmin, useSetupStatus } from '../api/queries';
import { AuthShell, ButtonSpinner, Field, FullPageLoader } from '../auth/AuthShell';
import { Banner } from '@/components/app';
import { Button } from '@/components/ui/button';
import { WaLinkStep } from './WaLinkStep';

type Step = 'admin' | 'whatsapp' | 'done';

const STEPS: { id: Step; label: string }[] = [
  { id: 'admin', label: 'Admin account' },
  { id: 'whatsapp', label: 'Link WhatsApp' },
  { id: 'done', label: 'Remote access' },
];

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              i < idx && 'bg-primary text-primary-foreground',
              i === idx && 'border-2 border-primary text-primary',
              i > idx && 'border border-border text-muted-foreground',
            )}
            aria-current={i === idx ? 'step' : undefined}
          >
            {i < idx ? <Check className="size-4" aria-label="Done" /> : i + 1}
          </span>
          <span
            className={cn(
              'hidden truncate sm:inline',
              i === idx ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <span
              aria-hidden="true"
              className={cn('h-px min-w-3 flex-1', i < idx ? 'bg-primary' : 'bg-border')}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function AdminStep({ onDone }: { onDone: () => void }) {
  const create = useSetupAdmin();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const usernameError =
    username.length > 0 && !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)
      ? '3–32 characters: letters, numbers, dot, dash, underscore.'
      : undefined;
  const passwordError =
    password.length > 0 && password.length < 8 ? 'At least 8 characters.' : undefined;
  const confirmError =
    confirm.length > 0 && confirm !== password ? 'Passwords do not match.' : undefined;
  const valid =
    !usernameError &&
    username.length >= 3 &&
    displayName.trim().length > 0 &&
    password.length >= 8 &&
    password === confirm;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate({ username, displayName: displayName.trim(), password }, { onSuccess: onDone });
  };

  const forbidden = create.error instanceof ApiError && create.error.status === 403;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-muted-foreground">
        Create the first admin account. You can add team members later.
      </p>
      {create.error && (
        <Banner tone="danger" title={forbidden ? 'Setup must be done on this computer' : undefined}>
          {forbidden
            ? 'For security, the first admin can only be created from the computer running WA Team Inbox. Open http://localhost:7420 there.'
            : errorMessage(create.error)}
        </Banner>
      )}
      <Field
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={usernameError}
      />
      <Field
        label="Display name"
        autoComplete="name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        hint="Shown to teammates next to your replies."
      />
      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={passwordError}
        hint="At least 8 characters."
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={confirmError}
      />
      <Button
        type="submit"
        size="touch"
        className="w-full"
        aria-busy={create.isPending || undefined}
        disabled={create.isPending || !valid}
      >
        {create.isPending ? <ButtonSpinner /> : <UserPlus aria-hidden="true" />}
        Create admin
      </Button>
    </form>
  );
}

function DoneStep() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">You're all set</p>
          <p className="text-muted-foreground">Your team inbox is ready.</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Want teammates to use the inbox from their phones outside this network? Turn on a Cloudflare
        tunnel under <strong className="text-foreground">Admin → Tunnel</strong>. You can also add
        team members under <strong className="text-foreground">Admin → Members</strong>.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="touch" className="w-full sm:flex-1" onClick={() => navigate('/', { replace: true })}>
          <Inbox aria-hidden="true" />
          Go to inbox
        </Button>
        <Button asChild variant="outline" size="touch" className="w-full sm:flex-1">
          <Link to="/admin/tunnel">
            <Globe aria-hidden="true" />
            Set up remote access
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** First-run wizard: create admin → link WhatsApp → optional remote access. */
export function SetupWizard() {
  const status = useSetupStatus();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('admin');
  // Once needsSetup=true has been seen this visit we're mid-wizard: creating the admin flips
  // needsSetup to false *before* the step advances, which must not bounce us to the inbox.
  const [wizardStarted, setWizardStarted] = useState(false);
  if (status.data?.needsSetup && !wizardStarted) setWizardStarted(true);

  if (status.isPending) return <FullPageLoader />;
  // Setup already finished (and we're not mid-wizard) → leave.
  if (!wizardStarted && step === 'admin' && status.data && !status.data.needsSetup)
    return <Navigate to="/" replace />;

  return (
    <AuthShell
      title="Welcome to WA Team Inbox"
      subtitle="Let's get your shared inbox running."
      illustration={step === 'admin' ? '/illustrations/welcome.png' : undefined}
      wide
    >
      <StepIndicator current={step} />
      {status.error && step === 'admin' && (
        <Banner tone="danger" className="mb-4">
          {errorMessage(status.error)}
        </Banner>
      )}
      {step === 'admin' && <AdminStep onDone={() => setStep('whatsapp')} />}
      {step === 'whatsapp' && (
        <WaLinkStep
          onContinue={() => setStep('done')}
          onSkip={() => navigate('/', { replace: true })}
        />
      )}
      {step === 'done' && <DoneStep />}
    </AuthShell>
  );
}

export default SetupWizard;
