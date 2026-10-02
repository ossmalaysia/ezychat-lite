// PLACEHOLDER created by Task 11 — Task 12 replaces this file wholesale.
// Contract: App.tsx imports `{ InboxPage }` (named export) from './inbox/InboxPage'.
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui';

export function InboxPage() {
  const { user, isAdmin, logout } = useAuth();
  return (
    <div className="safe-x flex h-dvh flex-col bg-neutral-50 dark:bg-neutral-950">
      <header className="safe-top flex items-center gap-2 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="flex-1 py-3 font-semibold">Inbox</h1>
        {isAdmin && (
          <Link
            to="/admin"
            className="inline-flex min-h-11 items-center px-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            Admin
          </Link>
        )}
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>
      <main className="flex flex-1 items-center justify-center p-4 text-center text-sm text-neutral-500">
        Signed in as {user?.displayName}. The inbox UI is coming soon.
      </main>
    </div>
  );
}

export default InboxPage;
