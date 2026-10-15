import { useState } from 'react';
import { AiConnectionBody, type AiMemberStatus } from '@wa-team-inbox/shared';
import type { useAiMemberAction } from '../api/ai';
import { officialLoginUrl } from './ai-status';

type AiAction = ReturnType<typeof useAiMemberAction>;

/**
 * EXPERIMENTAL one-click ChatGPT sign-in, shared by Settings → AI and the quick connect block:
 * save ChatGPT mode if needed, start sign-in, then open the official sign-in page in a new tab.
 * Errors surface through `action.error`.
 */
export function useChatgptSignIn(action: AiAction) {
  const [popupBlocked, setPopupBlocked] = useState(false);

  const signIn = async (status: AiMemberStatus, model = '') => {
    setPopupBlocked(false);
    // Open the tab synchronously so the browser treats it as user-initiated.
    const tab = window.open('about:blank', '_blank');
    try {
      if (status.settings.mode !== 'chatgpt') {
        const parsed = AiConnectionBody.safeParse({ mode: 'chatgpt', model });
        await action.mutateAsync({
          kind: 'connection',
          settings: parsed.success ? parsed.data : { mode: 'chatgpt', model: '' },
        });
      }
      const next = await action.mutateAsync({ kind: 'login' });
      const url = officialLoginUrl(next.connection.loginUrl);
      if (tab && url) {
        tab.opener = null;
        tab.location.href = url;
      } else tab?.close();
      setPopupBlocked(!tab);
    } catch {
      // The mutation error is shown by the caller.
      tab?.close();
    }
  };

  return { signIn, popupBlocked, resetPopup: () => setPopupBlocked(false) };
}
