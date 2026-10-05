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
  shutdown(): Promise<void>;
  /** EXPERIMENTAL direct ChatGPT sign-in: live model list (or the documented fallback). */
  models?(): Promise<AiModelList>;
  /** Model ids a ChatGPT connection may save ('' = Auto is always allowed). */
  knownModels?(): readonly string[];
  /** Sends a short prompt with the saved model and reports the reply or error. */
  test?(model: string): Promise<AiTestResult>;
}
