import { useState } from 'react';
import type React from 'react';
import type { Role, User } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import {
  useCreateUser,
  usePatchUser,
  useResetPassword,
  useRevokeSessions,
  useUsers,
} from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { Avatar, Banner, Button, Input, Modal, Spinner } from '../components/legacy';
import { formatDateTime } from '../lib/format';
import {
  Badge,
  ConfirmModal,
  CopyButton,
  ErrorState,
  PageHeader,
  Select,
  Toggle,
  generatePassword,
} from './adminUi';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: User }
  | { kind: 'reset'; user: User }
  | { kind: 'revoke'; user: User }
  | null;

export function MembersPage() {
  const users = useUsers();
  const { user: me } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setDialog(null);

  const list = users.data ?? [];

  return (
    <div>
      <PageHeader
        title="Members"
        description="People who can sign in to the team inbox."
        actions={<Button onClick={() => setDialog({ kind: 'create' })}>Add member</Button>}
      />

      {notice && (
        <Banner
          tone="success"
          className="mb-4"
          action={
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          }
        >
          {notice}
        </Banner>
      )}

      {users.isPending ? (
        <div className="flex justify-center py-10 text-emerald-600">
          <Spinner className="size-6" />
        </div>
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : list.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">No members yet.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white md:block dark:border-neutral-800 dark:bg-neutral-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-950/40 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {list.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <MemberIdentity user={u} isMe={u.id === me?.id} />
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadges user={u} />
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{formatDateTime(u.createdAt)}</td>
                    <td className="px-4 py-3">
                      <RowActions user={u} onAction={setDialog} className="justify-end" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <ul className="space-y-3 md:hidden">
            {list.map((u) => (
              <li
                key={u.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <MemberIdentity user={u} isMe={u.id === me?.id} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <RoleBadge role={u.role} />
                  <StatusBadges user={u} />
                </div>
                <RowActions user={u} onAction={setDialog} className="mt-3" />
              </li>
            ))}
          </ul>
        </>
      )}

      {dialog?.kind === 'create' && (
        <CreateMemberModal
          onClose={close}
          onCreated={(name) => {
            close();
            setNotice(`${name} was added. Share the temporary password with them.`);
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditMemberModal user={dialog.user} isMe={dialog.user.id === me?.id} onClose={close} />
      )}
      {dialog?.kind === 'reset' && <ResetPasswordModal user={dialog.user} onClose={close} />}
      {dialog?.kind === 'revoke' && (
        <RevokeSessionsModal
          user={dialog.user}
          onClose={close}
          onDone={() => {
            close();
            setNotice(`Signed ${dialog.user.displayName} out of all devices.`);
          }}
        />
      )}
    </div>
  );
}

function MemberIdentity({ user, isMe }: { user: User; isMe: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={user.displayName} size="sm" seed={user.username} />
      <div className="min-w-0">
        <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
          {user.displayName}
          {isMe && <span className="ml-1 text-xs font-normal text-neutral-500">(you)</span>}
        </p>
        <p className="truncate text-sm text-neutral-500">@{user.username}</p>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={role === 'admin' ? 'info' : 'neutral'}>{role === 'admin' ? 'Admin' : 'Agent'}</Badge>;
}

function StatusBadges({ user }: { user: User }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {user.disabled ? <Badge tone="error">Disabled</Badge> : <Badge tone="success">Active</Badge>}
      {user.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
    </span>
  );
}

function RowActions({
  user,
  onAction,
  className,
}: {
  user: User;
  onAction: (d: Dialog) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
      <Button size="sm" variant="secondary" onClick={() => onAction({ kind: 'edit', user })}>
        Edit
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onAction({ kind: 'reset', user })}>
        Reset password
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onAction({ kind: 'revoke', user })}>
        Sign out everywhere
      </Button>
    </div>
  );
}

function CreateMemberModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const create = useCreateUser();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [password, setPassword] = useState(() => generatePassword());
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (username.trim().length < 3) {
      setLocalError('Username must be at least 3 characters.');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    create.mutate(
      { username: username.trim(), displayName: displayName.trim(), role, password },
      { onSuccess: () => onCreated(displayName.trim() || username.trim()) },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add member"
      dismissable={!create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-member-form" loading={create.isPending}>
            Create member
          </Button>
        </>
      }
    >
      <form id="create-member-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          required
        />
        <Input
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </Select>
        <div className="space-y-2">
          <Input
            label="Temporary password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            hint="They will be asked to change it at first sign-in."
            className="font-mono"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPassword(generatePassword())}>
              Generate
            </Button>
            <CopyButton text={password} />
          </div>
        </div>
        {(localError || create.error) && (
          <Banner tone="error">{localError ?? errorMessage(create.error)}</Banner>
        )}
      </form>
    </Modal>
  );
}

function EditMemberModal({
  user,
  isMe,
  onClose,
}: {
  user: User;
  isMe: boolean;
  onClose: () => void;
}) {
  const patch = usePatchUser();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role);
  const [disabled, setDisabled] = useState(user.disabled);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: { displayName?: string; role?: Role; disabled?: boolean } = {};
    if (displayName.trim() && displayName.trim() !== user.displayName)
      body.displayName = displayName.trim();
    if (role !== user.role) body.role = role;
    if (disabled !== user.disabled) body.disabled = disabled;
    if (Object.keys(body).length === 0) return onClose();
    patch.mutate({ id: user.id, patch: body }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.displayName}`}
      dismissable={!patch.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={patch.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-member-form" loading={patch.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="edit-member-form" onSubmit={submit} className="space-y-4">
        <Input
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          disabled={isMe}
          hint={isMe ? "You can't change your own role." : undefined}
        >
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </Select>
        <Toggle
          label="Disabled"
          description={
            isMe
              ? "You can't disable your own account."
              : 'Disabled members are signed out immediately and cannot sign in.'
          }
          checked={disabled}
          onChange={setDisabled}
          disabled={isMe}
        />
        {patch.error && <Banner tone="error">{errorMessage(patch.error)}</Banner>}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const reset = useResetPassword();
  const newPassword = reset.data?.password;

  if (newPassword) {
    return (
      <Modal
        open
        onClose={onClose}
        title="New temporary password"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-3 text-sm">
          <p className="text-neutral-700 dark:text-neutral-300">
            Share this password with {user.displayName}. It is shown only once; they must change
            it at next sign-in. Their other sessions were signed out.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-neutral-100 px-3 py-2 font-mono text-base dark:bg-neutral-800">
              {newPassword}
            </code>
            <CopyButton text={newPassword} />
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <ConfirmModal
      open
      title={`Reset password for ${user.displayName}?`}
      confirmLabel="Reset password"
      danger
      loading={reset.isPending}
      error={reset.error ?? undefined}
      onConfirm={() => reset.mutate(user.id)}
      onClose={onClose}
    >
      <p>A new temporary password will be generated and all of their sessions signed out.</p>
    </ConfirmModal>
  );
}

function RevokeSessionsModal({
  user,
  onClose,
  onDone,
}: {
  user: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const revoke = useRevokeSessions();
  return (
    <ConfirmModal
      open
      title={`Sign ${user.displayName} out everywhere?`}
      confirmLabel="Sign out"
      danger
      loading={revoke.isPending}
      error={revoke.error ?? undefined}
      onConfirm={() => revoke.mutate(user.id, { onSuccess: onDone })}
      onClose={onClose}
    >
      <p>All of their devices will be signed out immediately.</p>
    </ConfirmModal>
  );
}
