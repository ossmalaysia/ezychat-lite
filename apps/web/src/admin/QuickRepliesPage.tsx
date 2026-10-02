import { useState } from 'react';
import type React from 'react';
import type { QuickReply } from '@wa-team-inbox/shared';
import { errorMessage } from '../api/client';
import { useDeleteQuickReply, useQuickReplies, useSaveQuickReply } from '../api/queries';
import { Banner, Button, Input, Modal, Spinner } from '../components/ui';
import { ConfirmModal, ErrorState, PageHeader, Textarea } from './adminUi';

const SHORTCUT_RE = /^[a-z0-9_-]{1,32}$/;

export function QuickRepliesPage() {
  const replies = useQuickReplies();
  const [editing, setEditing] = useState<QuickReply | 'new' | null>(null);
  const [deleting, setDeleting] = useState<QuickReply | null>(null);
  const del = useDeleteQuickReply();

  const list = [...(replies.data ?? [])].sort((a, b) => a.shortcut.localeCompare(b.shortcut));

  return (
    <div>
      <PageHeader
        title="Quick replies"
        description={
          <>
            Agents type <kbd className="rounded bg-neutral-200 px-1 font-mono dark:bg-neutral-800">/</kbd>{' '}
            followed by a shortcut in the composer to insert a reply.
          </>
        }
        actions={<Button onClick={() => setEditing('new')}>New quick reply</Button>}
      />

      {replies.isPending ? (
        <div className="flex justify-center py-10 text-emerald-600">
          <Spinner className="size-6" />
        </div>
      ) : replies.isError ? (
        <ErrorState error={replies.error} onRetry={() => void replies.refetch()} />
      ) : list.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">
          No quick replies yet. Create one to speed up common answers.
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-start dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  /{r.shortcut}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
                  {r.body}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <QuickReplyModal
          reply={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmModal
          open
          title={`Delete /${deleting.shortcut}?`}
          confirmLabel="Delete"
          danger
          loading={del.isPending}
          error={del.error ?? undefined}
          onConfirm={() =>
            del.mutate(deleting.id, {
              onSuccess: () => {
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
        </ConfirmModal>
      )}
    </div>
  );
}

function QuickReplyModal({ reply, onClose }: { reply: QuickReply | null; onClose: () => void }) {
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
    save.mutate({ id: reply?.id, shortcut, body }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={reply ? `Edit /${reply.shortcut}` : 'New quick reply'}
      dismissable={!save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="quick-reply-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="quick-reply-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input
          label="Shortcut"
          value={shortcut}
          onChange={(e) => setShortcut(e.target.value.toLowerCase().replace(/^\//, ''))}
          placeholder="price"
          autoCapitalize="none"
          autoCorrect="off"
          error={shortcutError}
          hint="Typed after / in the composer, e.g. /price"
        />
        <Textarea
          label="Reply text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={4096}
          error={bodyError}
        />
        {save.error && <Banner tone="error">{errorMessage(save.error)}</Banner>}
      </form>
    </Modal>
  );
}
