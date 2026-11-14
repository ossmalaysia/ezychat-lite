import { useMyChats } from '../mock/memberChats';

/**
 * Mock stand-in for the app's `auth/chat-scope.ts`: an agent limited to chosen chats gets no Ask Ezy
 * (it reads across chats). The mock keeps the scope in its member-chats stand-in, not on `User`.
 */
export function useChosenChatsOnly(): boolean {
  return useMyChats().limited;
}
