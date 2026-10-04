import { useState } from 'react';
import type React from 'react';
import {
  Bot,
  KeyRound,
  LogOut,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Role, User } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import { AiMemberPanel } from './AiMemberPanel';
import {
  useCreateUser,
  usePatchUser,
  useResetPassword,
  useRevokeSessions,
  useUsers,
} from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../lib/format';
import {
  Banner,
  EmptyState,
  ResponsiveDialog,
  ResponsiveTable,
  type Column,
} from '@/components/app';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SearchField } from '@/components/app/SearchField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ConfirmDialog,
  CopyButton,
  ErrorState,
  Field,
  ListSkeleton,
  Pending,
  canGeneratePassword,
  generatePassword,
} from './adminUi';

type Dialog =
  | { kind: 'create' }
  | { kind: 'ai' }
  | { kind: 'edit'; user: User }
  | { kind: 'reset'; user: User }
  | { kind: 'revoke'; user: User }
  | { kind: 'disable'; user: User }
  | null;

export function MembersPage() {
  const users = useUsers();
  const { user: me } = useAuth();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState('');
  const close = () => setDialog(null);

  const all = users.data ?? [];
  const query = search.trim().toLocaleLowerCase();
  const list = all.filter((u) =>
    `${u.displayName} ${u.username} ${u.role} ${u.kind === 'ai' ? 'AI Sales Agent' : ''}`
      .toLocaleLowerCase()
      .includes(query),
  );

  const columns: Column<User>[] = [
    {
      key: 'member',
      header: 'Member',
      cell: (u) => <MemberIdentity user={u} isMe={u.id === me?.id} />,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (u) =>
        u.kind === 'ai' ? (
          <Badge variant="secondary">AI · Sales Agent</Badge>
        ) : (
          <RoleBadge role={u.role} />
        ),
    },
    { key: 'status', header: 'Status', cell: (u) => <StatusBadges user={u} /> },
    {
      key: 'created',
      header: 'Created',
      cell: (u) => <span className="text-muted-foreground">{formatDateTime(u.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only md:not-sr-only">Actions</span>,
      className: 'md:text-right',
      cell: (u) => <RowActions user={u} isMe={u.id === me?.id} onAction={setDialog} />,
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Members</h1>
          <div className="flex flex-wrap gap-2">
            {!users.isPending && !users.isError && !all.some((u) => u.kind === 'ai') && (
              <Button
                variant="outline"
                size="touch"
                className="md:min-h-9"
                onClick={() => setDialog({ kind: 'ai' })}
              >
                <Bot aria-hidden />
                Add AI member
              </Button>
            )}
            <Button
              size="touch"
              className="md:min-h-9"
              onClick={() => setDialog({ kind: 'create' })}
            >
              <UserPlus aria-hidden />
              Add member
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Your team and AI assistant for customer chats.
        </p>
      </div>

      <div className="mb-4 space-y-2">
        <SearchField
          value={search}
          onChange={setSearch}
          label="Search members"
          placeholder="Search name, username or role"
        />
        {!users.isPending && !users.isError && (
          <p role="status" className="text-sm text-muted-foreground">
            {list.length} of {all.length} members
          </p>
        )}
      </div>
      {users.isPending ? (
        <ListSkeleton />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <ResponsiveTable
          rows={list}
          columns={columns}
          rowKey={(u) => u.id}
          renderMobileRow={(u) => (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <MemberIdentity user={u} isMe={u.id === me?.id} />
                <RowActions user={u} isMe={u.id === me?.id} onAction={setDialog} compact />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pl-11">
                {u.kind === 'ai' ? (
                  <Badge variant="secondary">AI · Sales Agent</Badge>
                ) : (
                  <RoleBadge role={u.role} />
                )}
                <StatusBadges user={u} />
              </div>
              <p className="pl-11 text-xs text-muted-foreground">
                Added{' '}
                <time dateTime={new Date(u.createdAt).toISOString()}>
                  {formatDateTime(u.createdAt)}
                </time>
              </p>
            </div>
          )}
          empty={
            query ? (
              <EmptyState
                title="No matching members"
                description="Try a different name, username or role."
                action={
                  <Button variant="outline" size="touch" onClick={() => setSearch('')}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState title="No members yet" description="Add a member so they can sign in." />
            )
          }
        />
      )}

      {dialog?.kind === 'ai' && <AiMemberPanel onClose={close} />}
      {dialog?.kind === 'create' && (
        <CreateMemberDialog
          onClose={close}
          onCreated={(name) => {
            close();
            toast.success(`${name} was added. Share the temporary password with them.`);
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <EditMemberDialog user={dialog.user} isMe={dialog.user.id === me?.id} onClose={close} />
      )}
      {dialog?.kind === 'reset' && <ResetPasswordDialog user={dialog.user} onClose={close} />}
      {dialog?.kind === 'revoke' && (
        <RevokeSessionsDialog
          user={dialog.user}
          onClose={close}
          onDone={() => {
            close();
            toast.success(`Signed ${dialog.user.displayName} out of all devices.`);
          }}
        />
      )}
      {dialog?.kind === 'disable' && <DisableMemberDialog user={dialog.user} onClose={close} />}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
    ).toUpperCase() || '?'
  );
}

function MemberIdentity({ user, isMe }: { user: User; isMe: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
          {initials(user.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere] md:truncate">
          {user.displayName}
          {isMe && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {user.kind === 'ai' ? 'AI assistant' : `@${user.username}`}
        </p>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return role === 'admin' ? (
    <Badge className="bg-info/15 text-info">Admin</Badge>
  ) : (
    <Badge variant="secondary">Agent</Badge>
  );
}

function StatusBadges({ user }: { user: User }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {user.disabled ? (
        <Badge className="bg-danger/15 text-danger">Disabled</Badge>
      ) : (
        <Badge className="bg-success/15 text-success">Active</Badge>
      )}
      {user.mustChangePassword && (
        <Badge className="bg-warning/15 text-foreground">Must change password</Badge>
      )}
    </span>
  );
}

function RowActions({
  user,
  isMe,
  onAction,
  compact = false,
}: {
  user: User;
  isMe: boolean;
  onAction: (d: Dialog) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 md:justify-end">
      <Button
        size={compact ? 'icon-touch' : 'touch'}
        variant={compact ? 'ghost' : 'outline'}
        className={compact ? undefined : 'md:min-h-8'}
        aria-label={compact ? `Edit ${user.displayName}` : undefined}
        onClick={() => onAction(user.kind === 'ai' ? { kind: 'ai' } : { kind: 'edit', user })}
      >
        <Pencil aria-hidden />
        {!compact && 'Edit'}
      </Button>
      {user.kind !== 'ai' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-touch"
              variant="ghost"
              className={compact ? undefined : 'md:size-8'}
              aria-label={`More actions for ${user.displayName}`}
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="min-h-11 md:min-h-8"
              onSelect={() => onAction({ kind: 'reset', user })}
            >
              <KeyRound aria-hidden />
              Reset password
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 md:min-h-8"
              onSelect={() => onAction({ kind: 'revoke', user })}
            >
              <LogOut aria-hidden />
              Sign out everywhere
            </DropdownMenuItem>
            {!isMe && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="min-h-11 md:min-h-8"
                  variant={user.disabled ? 'default' : 'destructive'}
                  onSelect={() => onAction({ kind: 'disable', user })}
                >
                  {user.disabled ? <UserCheck aria-hidden /> : <UserX aria-hidden />}
                  {user.disabled ? 'Enable' : 'Disable'}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: Role;
  onChange: (r: Role) => void;
  disabled?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <Field label="Role" hint={hint}>
      {(p) => (
        <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
          <SelectTrigger {...p} className="min-h-11 w-full md:min-h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="agent" className="min-h-11 md:min-h-8">
              Agent
            </SelectItem>
            <SelectItem value="admin" className="min-h-11 md:min-h-8">
              Admin
            </SelectItem>
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

function DialogFooterButtons({
  onCancel,
  pending,
  formId,
  submitLabel,
}: {
  onCancel: () => void;
  pending: boolean;
  formId: string;
  submitLabel: string;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="touch"
        className="sm:min-h-9"
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button type="submit" form={formId} size="touch" className="sm:min-h-9" disabled={pending}>
        <Pending show={pending} />
        {submitLabel}
      </Button>
    </>
  );
}

function CreateMemberDialog({
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
  const secureGeneration = canGeneratePassword();
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
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !create.isPending && onClose()}
      title="Add member"
      footer={
        <DialogFooterButtons
          onCancel={onClose}
          pending={create.isPending}
          formId="create-member-form"
          submitLabel="Create member"
        />
      }
    >
      <form
        id="create-member-form"
        onSubmit={submit}
        className="flex flex-col gap-4 pb-1"
        noValidate
      >
        <Field label="Username">
          {(p) => (
            <Input
              {...p}
              className="h-11 md:h-9"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              required
            />
          )}
        </Field>
        <Field label="Display name">
          {(p) => (
            <Input
              {...p}
              className="h-11 md:h-9"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          )}
        </Field>
        <RoleSelect value={role} onChange={setRole} />
        <Field
          label="Temporary password"
          hint={
            secureGeneration
              ? 'They will be asked to change it at first sign-in.'
              : 'Automatic generation is unavailable in this browser. Enter a strong password; they will change it at first sign-in.'
          }
        >
          {(p) => (
            <Input
              {...p}
              className="h-11 font-mono md:h-9"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="touch"
            variant="outline"
            className="md:min-h-9"
            disabled={!secureGeneration}
            onClick={() => setPassword(generatePassword())}
          >
            <RefreshCw aria-hidden />
            Generate
          </Button>
          <CopyButton text={password} />
        </div>
        {(localError || create.error) && (
          <Banner tone="danger">{localError ?? errorMessage(create.error)}</Banner>
        )}
      </form>
    </ResponsiveDialog>
  );
}

function EditMemberDialog({
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: { displayName?: string; role?: Role } = {};
    if (displayName.trim() && displayName.trim() !== user.displayName)
      body.displayName = displayName.trim();
    if (role !== user.role) body.role = role;
    if (Object.keys(body).length === 0) return onClose();
    patch.mutate(
      { id: user.id, patch: body },
      {
        onSuccess: () => {
          toast.success('Member updated.');
          onClose();
        },
      },
    );
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !patch.isPending && onClose()}
      title={`Edit ${user.displayName}`}
      footer={
        <DialogFooterButtons
          onCancel={onClose}
          pending={patch.isPending}
          formId="edit-member-form"
          submitLabel="Save"
        />
      }
    >
      <form id="edit-member-form" onSubmit={submit} className="flex flex-col gap-4 pb-1">
        <Field label="Display name">
          {(p) => (
            <Input
              {...p}
              className="h-11 md:h-9"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
        </Field>
        <RoleSelect
          value={role}
          onChange={setRole}
          disabled={isMe}
          hint={isMe ? "You can't change your own role." : undefined}
        />
        {patch.error && <Banner tone="danger">{errorMessage(patch.error)}</Banner>}
      </form>
    </ResponsiveDialog>
  );
}

function DisableMemberDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const patch = usePatchUser();
  const enabling = user.disabled;
  return (
    <ConfirmDialog
      open
      title={enabling ? `Enable ${user.displayName}?` : `Disable ${user.displayName}?`}
      confirmLabel={enabling ? 'Enable' : 'Disable'}
      danger={!enabling}
      loading={patch.isPending}
      error={patch.error ?? undefined}
      onConfirm={() =>
        patch.mutate(
          { id: user.id, patch: { disabled: !enabling } },
          {
            onSuccess: () => {
              toast.success(
                enabling
                  ? `${user.displayName} can sign in again.`
                  : `${user.displayName} was disabled.`,
              );
              onClose();
            },
          },
        )
      }
      onClose={onClose}
    >
      <p>
        {enabling
          ? 'They will be able to sign in again.'
          : 'Disabled members are signed out immediately and cannot sign in.'}
      </p>
    </ConfirmDialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const reset = useResetPassword();
  const newPassword = reset.data?.password;

  if (newPassword) {
    return (
      <ResponsiveDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title="New temporary password"
        description={`Share this password with ${user.displayName}. It is shown only once; they must change it at next sign-in. Their other sessions were signed out.`}
        footer={
          <Button size="touch" className="sm:min-h-9" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <code
            data-testid="new-password"
            className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 font-mono text-base break-all"
          >
            {newPassword}
          </code>
          <CopyButton text={newPassword} />
        </div>
      </ResponsiveDialog>
    );
  }

  return (
    <ConfirmDialog
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
    </ConfirmDialog>
  );
}

function RevokeSessionsDialog({
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
    <ConfirmDialog
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
    </ConfirmDialog>
  );
}
