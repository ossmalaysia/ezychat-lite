import type React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useSetupStatus } from '../api/queries';
import { Banner, Button, FullPageSpinner } from '../components/legacy';
import { useAuth } from './AuthProvider';

export interface RequireAuthProps {
  /** Only admins may pass; agents are sent to `/`. */
  admin?: boolean;
  children?: React.ReactNode;
}

/**
 * Route guard implementing the boot logic:
 * needsSetup → /setup; no user → /login; mustChangePassword → /change-password.
 * Renders `children` or an `<Outlet />`.
 */
export function RequireAuth({ admin = false, children }: RequireAuthProps) {
  const location = useLocation();
  const setup = useSetupStatus();
  const { user, isLoading, error } = useAuth();

  if (setup.isPending || isLoading) return <FullPageSpinner />;

  if (setup.data?.needsSetup) return <Navigate to="/setup" replace />;

  if (!user) {
    if (error) return <ServerUnreachable message={errorMessage(error)} />;
    const from = location.pathname + location.search;
    return <Navigate to="/login" replace state={from !== '/' ? { from } : undefined} />;
  }

  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;

  return <>{children ?? <Outlet />}</>;
}

function ServerUnreachable({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm space-y-3">
        <Banner tone="error" title="Can't load WA Team Inbox">
          {message}
        </Banner>
        <Button fullWidth onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    </div>
  );
}
