import { useState } from 'react';
import type React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { QuickReply } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import { useDeleteQuickReply, useQuickReplies, useSaveQuickReply } from '../api/queries';
import { Banner, EmptyState, PageHeader, ResponsiveDialog } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchField } from '@/components/app/SearchField';
import { ConfirmDialog, ErrorState, Field, ListSkeleton, Pending } from './adminUi';

const SHORTCUT_RE = /^[a-z0-9_-]{1,32}$/;

export function QuickRepliesPage() {
  const replies = useQuickReplies();
  const [editing, setEditing] = useState<QuickReply | 'new' | null>(null);
  const [deleting, setDeleting] = useState<QuickReply | null>(null);
  const del = useDeleteQuickReply();
  const [search, setSearch] = useState('');

  const all = [...(replies.data ?? [])].sort((a, b) => a.shortcut.localeCompare(b.shortcut));
  const query = search.trim().toLocaleLowerCase();
  const list = all.filter((r) => `${r.shortcut} ${r.body}`.toLocaleLowerCase().includes(query));

  return (
    <div>
      <PageHeader
        title="Quick replies"
        description={
          <>
            Agents type <kbd className="rounded bg-muted px-1 font-mono">/</kbd> followed by a
            shortcut in the composer to insert a reply.
          </>
        }
        actions={
          <Button size="touch" className="md:min-h-9" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            New quick reply
          </Button>
        }
      />

      <div className="mb-4 space-y-2">
        <SearchField
          value={search}
          onChange={setSearch}
          label="Search quick replies"
          placeholder="Search shortcut or reply text"
        />
        {!replies.isPending && !replies.isError && (
          <p role="status" className="text-sm text-muted-foreground">
            {list.length} of {all.length} quick replies
          </p>
        )}
      </div>
      {replies.isPending ? (
        <ListSkeleton />
      ) : replies.isError ? (
        <ErrorState error={replies.error} onRetry={() => void replies.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          title={query ? 'No matching quick replies' : 'No quick replies yet'}
          description={
            query ? 'Try a different shortcut or phrase.' : 'Create one to speed up common answers.'
          }
          action={
            query ? (
              <Button variant="outline" size="touch" onClick={() => setSearch('')}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm sm:flex-row sm:items-start"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold text-primary">/{r.shortcut}</p>
                <p className="mt-1 text-base leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-foreground md:text-sm">
                  {r.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="touch"
                  variant="outline"
                  className="md:min-h-8"
                  onClick={() => setEditing(r)}
                  aria-label={`Edit /${r.shortcut}`}
                >
                  <Pencil aria-hidden />
                  Edit
                </Button>
                <Button
                  size="touch"
                  variant="ghost"
                  className="text-danger hover:text-danger md:min-h-8"
                  onClick={() => setDeleting(r)}
                  aria-label={`Delete /${r.shortcut}`}
                >
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <QuickReplyDialog
          reply={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          title={`Delete /${deleting.shortcut}?`}
          confirmLabel="Delete"
          danger
          loading={del.isPending}
          error={del.error ?? undefined}
          onConfirm={() =>
            del.mutate(deleting.id, {
              onSuccess: () => {
                toast.success(`Deleted /${deleting.shortcut}.`);
                setDeleting(null);
                del.reset();
              },
            })
          }
          onClose={() => {
            setDeleting(null);
            del.reset();
          }}
        >
          <p>This quick reply will no longer be available to agents.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function QuickReplyDialog({ reply, onClose }: { reply: QuickReply | null; onClose: () => void }) {
  const save = useSaveQuickReply();
  const [shortcut, setShortcut] = useState(reply?.shortcut ?? '');
  const [body, setBody] = useState(reply?.body ?? '');
  const [touched, setTouched] = useState(false);

  const shortcutError =
    touched && !SHORTCUT_RE.test(shortcut)
      ? 'Use 1-32 lowercase letters, digits, "-" or "_".'
      : undefined;
  const bodyError = touched && !body.trim() ? 'Reply text is required.' : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!SHORTCUT_RE.test(shortcut) || !body.trim()) return;
    save.mutate(
      { id: reply?.id, shortcut, body },
      {
        onSuccess: () => {
          toast.success(`Saved /${shortcut}.`);
          onClose();
        },
      },
    );
  };

  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => !o && !save.isPending && onClose()}
      title={reply ? `Edit /${reply.shortcut}` : 'New quick reply'}
      footer={
        <>
          <Button
            variant="outline"
            size="touch"
            className="sm:min-h-9"
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="quick-reply-form"
            size="touch"
            className="sm:min-h-9"
            disabled={save.isPending}
          >
            <Pending show={save.isPending} />
            Save
          </Button>
        </>
      }
    >
      <form id="quick-reply-form" onSubmit={submit} className="flex flex-col gap-4 pb-1" noValidate>
        <Field
          label="Shortcut"
          error={shortcutError}
          hint="Typed after / in the composer, e.g. /price"
        >
          {(p) => (
            <Input
              {...p}
              className="h-11 font-mono md:h-9"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value.toLowerCase().replace(/^\//, ''))}
              placeholder="price"
              autoCapitalize="none"
              autoCorrect="off"
            />
          )}
        </Field>
        <Field label="Reply text" error={bodyError}>
          {(p) => (
            <Textarea
              {...p}
              className="min-h-32"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={4096}
            />
          )}
        </Field>
        {save.error && <Banner tone="danger">{errorMessage(save.error)}</Banner>}
      </form>
    </ResponsiveDialog>
  );
}
