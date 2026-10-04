import type { AiConnection, AiDecision, AiSettings } from '@wa-team-inbox/shared';

export interface AiPrompt {
  instructions: string;
  input: string;
}
export interface AiProvider {
  generate(settings: AiSettings, apiKey: string | null, prompt: AiPrompt, signal: AbortSignal): Promise<AiDecision>;
  connection(): AiConnection;
  login(): Promise<AiConnection>;
  logout(): Promise<void>;
  shutdown(): Promise<void>;
}
