import type { AppContext } from '../context.js';
import type { AiProvider } from './provider-types.js';
import { DirectChatGptProvider } from './chatgpt-direct.js';

/**
 * API-key mode uses the public OpenAI API; ChatGPT mode uses the EXPERIMENTAL direct client
 * (ChatGPT OAuth + the non-public Codex backend). No Codex binary is bundled or launched.
 */
export function createAiProvider(ctx: AppContext): AiProvider {
  return new DirectChatGptProvider(ctx);
}
