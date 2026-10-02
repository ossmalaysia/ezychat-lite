import clsx from 'clsx';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { useSetupAdmin, useSetupStatus } from '../api/queries';
import { AuthShell } from '../auth/AuthShell';
import { Banner, Button, FullPageSpinner, Input } from '../components/ui';
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
            className={clsx(
              'inline-flex size-6 shrink-0 items-center justify-center rounded-full font-semibold',
              i < idx && 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-neutral-950',
              i === idx &&
                'border-2 border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300',
              i > idx && 'border border-neutral-300 text-neutral-500 dark:border-neutral-700',
            )}
            aria-current={i === idx ? 'step' : undefined}
          >
            {i < idx ? '✓' : i + 1}
          </span>
          <span
            className={clsx(
              'hidden truncate sm:inline',
              i === idx ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-500',
            )}
          >
            {s.label}
          </span>
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
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Create the first admin account. You can add team members later.
      </p>
      {create.error && (
        <Banner tone="error" title={forbidden ? 'Setup must be done on this computer' : undefined}>
          {forbidden
            ? 'For security, the first admin can only be created from the computer running WA Team Inbox. Open http://localhost:7420 there.'
            : errorMessage(create.error)}
        </Banner>
      )}
      <Input
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={usernameError}
      />
      <Input
        label="Display name"
        autoComplete="name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        hint="Shown to teammates next to your replies."
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={passwordError}
        hint="At least 8 characters."
      />
      <Input
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={confirmError}
      />
      <Button type="submit" size="lg" fullWidth loading={create.isPending} disabled={!valid}>
        Create admin
      </Button>
    </form>
  );
}

function DoneStep() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="success" title="You're all set">
        Your team inbox is ready.
      </Banner>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Want teammates to use the inbox from their phones outside this network? Turn on a Cloudflare
        tunnel under <strong>Admin → Tunnel</strong>. You can also add team members under{' '}
        <strong>Admin → Members</strong>.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" fullWidth onClick={() => navigate('/', { replace: true })}>
          Go to inbox
        </Button>
        <Link
          to="/admin/tunnel"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-neutral-300 px-5 text-base font-medium text-neutral-900 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          Set up remote access
        </Link>
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

  if (status.isPending) return <FullPageSpinner />;
  // Setup already finished (and we're not mid-wizard) → leave.
  if (!wizardStarted && step === 'admin' && status.data && !status.data.needsSetup)
    return <Navigate to="/" replace />;

  return (
    <AuthShell
      title="Welcome to WA Team Inbox"
      subtitle="Let's get your shared inbox running."
      wide
    >
      <StepIndicator current={step} />
      {status.error && step === 'admin' && (
        <Banner tone="error">{errorMessage(status.error)}</Banner>
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
