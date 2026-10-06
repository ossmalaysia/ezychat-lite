import type {
  AiConnection,
  AiDecision,
  AiModelList,
  AiSettings,
  AiTestResult,
} from '@wa-team-inbox/shared';

export interface AiPrompt {
  instructions: string;
  input: string;
  /**
   * Random per-install id (setting `ai_install_id`). Providers turn it plus the model into a stable
   * `prompt_cache_key` (see promptCacheKey). Never customer data.
   */
  cacheId?: string;
  /**
   * Customer images from the batch being answered, sent as `input_image` parts after the text
   * part of the user message. Absent or empty: the request body is exactly as without images.
   */
  images?: AiPromptImage[];
}
export interface AiPromptImage {
  mime: string;
  base64: string;
}
/** Low detail keeps image tokens small and replies fast. */
export const AI_IMAGE_DETAIL = 'low';

/** The user message content: the text part, then one `input_image` part per image. */
export function userMessageContent(text: string, images: readonly AiPromptImage[] | undefined) {
  return [
    { type: 'input_text', text },
    ...(images ?? []).map((image) => ({
      type: 'input_image',
      image_url: `data:${image.mime};base64,${image.base64}`,
      detail: AI_IMAGE_DETAIL,
    })),
  ];
}
export interface AiProvider {
  generate(
    settings: AiSettings,
    apiKey: string | null,
    prompt: AiPrompt,
    signal: AbortSignal,
  ): Promise<AiDecision>;
  connection(): AiConnection;
  login(): Promise<AiConnection>;
  /** Finishes a pending sign-in with the redirect address pasted from another computer. */
  submitCallbackUrl?(url: string): Promise<AiConnection>;
  logout(): Promise<void>;
  /** Called whenever the connection newly becomes expired or blocked (not on every failure). */
  onProblem?(listener: () => void): void;
  shutdown(): Promise<void>;
  /** EXPERIMENTAL direct ChatGPT sign-in: live model list (or the documented fallback). */
  models?(): Promise<AiModelList>;
  /** Model ids a ChatGPT connection may save ('' = Auto is always allowed). */
  knownModels?(): readonly string[];
  /** Sends a short prompt with the saved model and reports the reply or error. */
  test?(model: string): Promise<AiTestResult>;
  /** The model a ChatGPT request will use ('' = Auto resolves to the first live model). */
  resolveModel?(model: string): Promise<string>;
}
