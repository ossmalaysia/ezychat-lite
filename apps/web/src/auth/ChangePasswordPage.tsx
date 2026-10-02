import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useChangePassword } from '../api/queries';
import { Banner, Button, FullPageSpinner, Input } from '../components/legacy';
import { useAuth } from './AuthProvider';
import { AuthShell } from './AuthShell';

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { user, isLoading, logout } = useAuth();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  if (isLoading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  const forced = user.mustChangePassword;
  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsOld = next.length > 0 && next === current;
  const valid = current.length > 0 && next.length >= 8 && next === confirm && !sameAsOld;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    change.mutate(
      { currentPassword: current, newPassword: next },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  };

  return (
    <AuthShell
      title={forced ? 'Choose a new password' : 'Change password'}
      subtitle={
        forced
          ? `Welcome, ${user.displayName}. Please replace your temporary password.`
          : user.displayName
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {change.error && <Banner tone="error">{errorMessage(change.error)}</Banner>}
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={touched && !current ? 'Required' : undefined}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint="At least 8 characters."
          error={
            tooShort
              ? 'At least 8 characters.'
              : sameAsOld
                ? 'Must differ from the current password.'
                : undefined
          }
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? 'Passwords do not match.' : undefined}
        />
        <Button type="submit" size="lg" fullWidth loading={change.isPending} disabled={!valid}>
          Save password
        </Button>
        <div className="flex justify-between gap-2">
          {!forced && (
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

export default ChangePasswordPage;
