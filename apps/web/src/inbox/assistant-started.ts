import type { Chat, Message } from '@ezychat/shared';

/**
 * A direct chat an AI assistant started (MCP send_to_new_number) where the customer has not written
 * yet: the whole history is loaded, every message is ours and one of them came from the assistant.
 */
export function assistantStartedChat(
  chat: Pick<Chat, 'type'>,
  messages: readonly Pick<Message, 'fromMe' | 'viaAssistant'>[],
  hasOlder: boolean,
): boolean {
  return (
    chat.type === 'dm' &&
    !hasOlder &&
    messages.length > 0 &&
    messages.every((m) => m.fromMe) &&
    messages.some((m) => m.viaAssistant === true)
  );
}
