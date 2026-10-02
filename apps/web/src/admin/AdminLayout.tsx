// PLACEHOLDER created by Task 11 — Task 13 replaces this file wholesale.
// Contract: App.tsx mounts `{ AdminLayout }` (named export) at `/admin/*` behind <RequireAuth admin>;
// it owns its nested <Routes> (members, quick-replies, whatsapp, tunnel, settings, audit).
import { Link } from 'react-router-dom';

export function AdminLayout() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-lg font-semibold">Admin</h1>
      <p className="text-sm text-neutral-500">Admin pages are coming soon.</p>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center text-emerald-700 dark:text-emerald-400"
      >
        Back to inbox
      </Link>
    </div>
  );
}

export default AdminLayout;
