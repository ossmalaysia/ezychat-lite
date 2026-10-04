import { useState } from 'react';
import { toast } from 'sonner';
import { useOpenChatCount, useResolveAllChats } from '../api/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, ErrorState } from './adminUi';

export function ResolveAllChatsCard() {
  const count = useOpenChatCount();
  const resolve = useResolveAllChats();
  const [confirming, setConfirming] = useState(false);
  const openCount = count.data?.openCount;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Inbox</CardTitle>
        <CardDescription>
          Finish the day by resolving every open chat for the whole team. Messages are kept and new
          incoming messages reopen chats automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        {count.isError ? (
          <ErrorState error={count.error} onRetry={() => void count.refetch()} />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {openCount === undefined
              ? 'Loading open chats…'
              : openCount === 0
                ? 'No open chats to resolve.'
                : `${openCount} open ${openCount === 1 ? 'chat' : 'chats'}`}
          </p>
        )}
        <Button
          variant="outline"
          size="touch"
          className="w-full sm:w-auto md:min-h-9"
          disabled={count.isPending || count.isError || !openCount || resolve.isPending}
          onClick={() => {
            resolve.reset();
            setConfirming(true);
          }}
        >
          Resolve all open chats
        </Button>
        <ConfirmDialog
          open={confirming}
          title="Resolve all open chats?"
          confirmLabel="Resolve all"
          loading={resolve.isPending}
          error={resolve.error ?? undefined}
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            resolve.mutate(undefined, {
              onSuccess: ({ resolvedCount }) => {
                toast.success(
                  resolvedCount === 0
                    ? 'No open chats to resolve.'
                    : `Resolved ${resolvedCount} ${resolvedCount === 1 ? 'chat' : 'chats'}.`,
                );
                setConfirming(false);
              },
            })
          }
        >
          <p>
            This will resolve all currently open chats across the whole team
            {openCount === undefined ? '.' : ` (${openCount} right now).`} Assignees will be
            cleared. Messages and unread counts are kept. You can reopen individual chats later.
          </p>
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}
