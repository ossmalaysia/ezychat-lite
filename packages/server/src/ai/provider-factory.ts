import type { AppContext } from '../context.js';
import type { AiProvider } from './provider-types.js';
import { BusinessAiProvider } from './provider.js';
import { DirectChatGptProvider } from './chatgpt-direct.js';

/**
 * Which implementation serves ChatGPT mode.
 * - 'direct' (EXPERIMENTAL spike): ChatGPT OAuth + the non-public Codex backend, no Codex binary.
 * - 'codex': the bundled Codex app-server helper (kept intact, unused while this is 'direct').
 */
export const CHATGPT_TRANSPORT: 'direct' | 'codex' = 'direct';

export function createAiProvider(ctx: AppContext): AiProvider {
  return CHATGPT_TRANSPORT === 'direct'
    ? new DirectChatGptProvider(ctx)
    : new BusinessAiProvider(ctx);
}
