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
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Trans, useTranslation } from 'react-i18next';
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
  | { kind: 'edit'; user: User }
  | { kind: 'reset'; user: User }
  | { kind: 'revoke'; user: User }
  | { kind: 'disable'; user: User }
  | null;

export function MembersPage() {
  const users = useUsers();
  const { user: me } = useAuth();
  const { t } = useTranslation('admin');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState('');
  const close = () => setDialog(null);

  const all = users.data ?? [];
  const query = search.trim().toLocaleLowerCase();
  const list = all.filter((u) =>
    `${u.displayName} ${u.username} ${u.role} ${u.kind === 'ai' ? t('ai.roleBadge') : ''}`
      .toLocaleLowerCase()
      .includes(query),
  );

  const columns: Column<User>[] = [
    {
      key: 'member',
      header: t('members.columns.member'),
      cell: (u) => <MemberIdentity user={u} isMe={u.id === me?.id} />,
    },
    {
      key: 'role',
      header: t('members.columns.role'),
      cell: (u) => (u.kind === 'ai' ? <AiBadge /> : <RoleBadge role={u.role} />),
    },
    { key: 'status', header: t('members.columns.status'), cell: (u) => <StatusBadges user={u} /> },
    {
      key: 'created',
      header: t('members.columns.created'),
      cell: (u) => <span className="text-muted-foreground">{formatDateTime(u.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only md:not-sr-only">{t('members.columns.actions')}</span>,
      className: 'md:text-right',
      cell: (u) => <RowActions user={u} isMe={u.id === me?.id} onAction={setDialog} />,
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{t('members.title')}</h1>
          <div className="flex flex-wrap gap-2">
            {!users.isPending && !users.isError && !all.some((u) => u.kind === 'ai') && (
              <Button asChild variant="outline" size="touch" className="md:min-h-9">
                <Link to="/admin/members/ai">
                  <Bot aria-hidden />
                  {t('ai.addMember')}
                </Link>
              </Button>
            )}
            <Button
              size="touch"
              className="md:min-h-9"
              onClick={() => setDialog({ kind: 'create' })}
            >
              <UserPlus aria-hidden />
              {t('members.add')}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t('ai.membersDescription')}
        </p>
      </div>

      <div className="mb-4 space-y-2">
        <SearchField
          value={search}
          onChange={setSearch}
          label={t('members.searchLabel')}
          placeholder={t('members.searchPlaceholder')}
        />
        {!users.isPending && !users.isError && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('members.count', { shown: list.length, count: all.length })}
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
                {u.kind === 'ai' ? <AiBadge /> : <RoleBadge role={u.role} />}
                <StatusBadges user={u} />
              </div>
              <p className="pl-11 text-xs text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey="members.added"
                  values={{ date: formatDateTime(u.createdAt) }}
                  components={{ time: <time dateTime={new Date(u.createdAt).toISOString()} /> }}
                />
              </p>
            </div>
          )}
          empty={
            query ? (
              <EmptyState
                title={t('members.empty.noMatchTitle')}
                description={t('members.empty.noMatchBody')}
                action={
                  <Button variant="outline" size="touch" onClick={() => setSearch('')}>
                    {t('members.empty.clearSearch')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title={t('members.empty.noneTitle')}
                description={t('members.empty.noneBody')}
              />
            )
          }
        />
      )}

      {dialog?.kind === 'create' && (
        <CreateMemberDialog
          onClose={close}
          onCreated={(name) => {
            close();
            toast.success(t('members.create.done', { name }));
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
            toast.success(t('members.revoke.done', { name: dialog.user.displayName }));
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

/** The AI row's robot badge. */
function AiBadge() {
  const { t } = useTranslation('admin');
  return (
    <Badge variant="secondary" className="gap-1">
      <Bot aria-hidden className="size-3" />
      {t('ai.roleBadge')}
    </Badge>
  );
}

function MemberIdentity({ user, isMe }: { user: User; isMe: boolean }) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
          {initials(user.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="font-medium [overflow-wrap:anywhere] md:truncate">
          {user.kind === 'ai' ? (
            <Link to="/admin/members/ai" className="underline-offset-4 hover:underline">
              {user.displayName}
            </Link>
          ) : (
            user.displayName
          )}
          {isMe && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {t('members.you')}
            </span>
          )}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {user.kind === 'ai' ? t('ai.assistant') : `@${user.username}`}
        </p>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation();
  return role === 'admin' ? (
    <Badge className="bg-info/15 text-info">{t('roles.admin')}</Badge>
  ) : (
    <Badge variant="secondary">{t('roles.agent')}</Badge>
  );
}

function StatusBadges({ user }: { user: User }) {
  const { t } = useTranslation('admin');
  return (
    <span className="inline-flex flex-wrap gap-1">
      {user.disabled ? (
        <Badge className="bg-danger/15 text-danger">{t('members.status.disabled')}</Badge>
      ) : (
        <Badge className="bg-success/15 text-success">{t('members.status.active')}</Badge>
      )}
      {user.mustChangePassword && (
        <Badge className="bg-warning/15 text-foreground">
          {t('members.status.mustChangePassword')}
        </Badge>
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
  const { t } = useTranslation(['admin', 'common']);
  return (
    <div className="flex shrink-0 items-center gap-1 md:justify-end">
      {user.kind === 'ai' ? (
        <Button
          asChild
          size={compact ? 'icon-touch' : 'touch'}
          variant={compact ? 'ghost' : 'outline'}
          className={compact ? undefined : 'md:min-h-8'}
        >
          <Link
            to="/admin/members/ai"
            aria-label={
              compact ? t('members.actions.editMember', { name: user.displayName }) : undefined
            }
          >
            <Pencil aria-hidden />
            {!compact && t('common:actions.edit')}
          </Link>
        </Button>
      ) : (
        <Button
          size={compact ? 'icon-touch' : 'touch'}
          variant={compact ? 'ghost' : 'outline'}
          className={compact ? undefined : 'md:min-h-8'}
          aria-label={
            compact ? t('members.actions.editMember', { name: user.displayName }) : undefined
          }
          onClick={() => onAction({ kind: 'edit', user })}
        >
          <Pencil aria-hidden />
          {!compact && t('common:actions.edit')}
        </Button>
      )}
      {user.kind !== 'ai' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-touch"
              variant="ghost"
              className={compact ? undefined : 'md:size-8'}
              aria-label={t('members.actions.moreFor', { name: user.displayName })}
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
              {t('members.actions.resetPassword')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 md:min-h-8"
              onSelect={() => onAction({ kind: 'revoke', user })}
            >
              <LogOut aria-hidden />
              {t('members.actions.signOutEverywhere')}
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
                  {user.disabled ? t('members.actions.enable') : t('members.actions.disable')}
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
  const { t } = useTranslation(['admin', 'common']);
  return (
    <Field label={t('members.form.role')} hint={hint}>
      {(p) => (
        <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
          <SelectTrigger {...p} className="min-h-11 w-full md:min-h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="agent" className="min-h-11 md:min-h-8">
              {t('common:roles.agent')}
            </SelectItem>
            <SelectItem value="admin" className="min-h-11 md:min-h-8">
              {t('common:roles.admin')}
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
  const { t } = useTranslation();
  return (
    <>
      <Button
        variant="outline"
        size="touch"
        className="sm:min-h-9"
        onClick={onCancel}
        disabled={pending}
      >
        {t('actions.cancel')}
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
  const { t } = useTranslation(['admin', 'common']);
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
      setLocalError(t('members.form.usernameTooShort'));
      return;
    }
    if (password.length < 8) {
      setLocalError(t('members.form.passTooShort'));
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
      title={t('members.create.title')}
      footer={
        <DialogFooterButtons
          onCancel={onClose}
          pending={create.isPending}
          formId="create-member-form"
          submitLabel={t('members.create.submit')}
        />
      }
    >
      <form
        id="create-member-form"
        onSubmit={submit}
        className="flex flex-col gap-4 pb-1"
        noValidate
      >
        <Field label={t('members.form.username')}>
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
        <Field label={t('members.form.displayName')}>
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
          label={t('members.form.tempPass')}
          hint={
            secureGeneration
              ? t('members.form.tempPasswordHint')
              : t('members.form.tempPasswordManualHint')
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
            {t('members.form.generate')}
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
  const { t } = useTranslation(['admin', 'common']);
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
          toast.success(t('members.edit.done'));
          onClose();
        },
      },
    );
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !patch.isPending && onClose()}
      title={t('members.edit.title', { name: user.displayName })}
      footer={
        <DialogFooterButtons
          onCancel={onClose}
          pending={patch.isPending}
          formId="edit-member-form"
          submitLabel={t('common:actions.save')}
        />
      }
    >
      <form id="edit-member-form" onSubmit={submit} className="flex flex-col gap-4 pb-1">
        <Field label={t('members.form.displayName')}>
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
          hint={isMe ? t('members.form.ownRoleHint') : undefined}
        />
        {patch.error && <Banner tone="danger">{errorMessage(patch.error)}</Banner>}
      </form>
    </ResponsiveDialog>
  );
}

function DisableMemberDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const patch = usePatchUser();
  const { t } = useTranslation('admin');
  const enabling = user.disabled;
  return (
    <ConfirmDialog
      open
      title={
        enabling
          ? t('members.disable.enableTitle', { name: user.displayName })
          : t('members.disable.disableTitle', { name: user.displayName })
      }
      confirmLabel={enabling ? t('members.actions.enable') : t('members.actions.disable')}
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
                  ? t('members.disable.enabled', { name: user.displayName })
                  : t('members.disable.disabled', { name: user.displayName }),
              );
              onClose();
            },
          },
        )
      }
      onClose={onClose}
    >
      <p>{enabling ? t('members.disable.enableBody') : t('members.disable.disableBody')}</p>
    </ConfirmDialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const reset = useResetPassword();
  const { t } = useTranslation(['admin', 'common']);
  const newPassword = reset.data?.password;

  if (newPassword) {
    return (
      <ResponsiveDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={t('members.reset.newTitle')}
        description={t('members.reset.newBody', { name: user.displayName })}
        footer={
          <Button size="touch" className="sm:min-h-9" onClick={onClose}>
            {t('common:actions.done')}
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
      title={t('members.reset.title', { name: user.displayName })}
      confirmLabel={t('members.actions.resetPassword')}
      danger
      loading={reset.isPending}
      error={reset.error ?? undefined}
      onConfirm={() => reset.mutate(user.id)}
      onClose={onClose}
    >
      <p>{t('members.reset.body')}</p>
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
  const { t } = useTranslation('admin');
  return (
    <ConfirmDialog
      open
      title={t('members.revoke.title', { name: user.displayName })}
      confirmLabel={t('members.revoke.confirm')}
      danger
      loading={revoke.isPending}
      error={revoke.error ?? undefined}
      onConfirm={() => revoke.mutate(user.id, { onSuccess: onDone })}
      onClose={onClose}
    >
      <p>{t('members.revoke.body')}</p>
    </ConfirmDialog>
  );
}
