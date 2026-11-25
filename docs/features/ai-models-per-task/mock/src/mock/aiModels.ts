import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

/** Proposed (ai-models-per-task): which AI model does each job, per AI connection. */
export const AI_TASKS = ['agentReplies', 'askEzy', 'translate', 'writing', 'background'] as const;
export type AiTask = (typeof AI_TASKS)[number];
export type AiMode = 'chatgpt' | 'api' | 'claude';
export type AiThinking = 'low' | 'medium' | 'high';
export type ModelTier = 'fast' | 'balanced' | 'smart';

export interface AiModelInfo {
  id: string;
  /** The model has a thinking level (ChatGPT and OpenAI reasoning models). */
  thinking: boolean;
  tier: ModelTier | null;
}

export interface AiTaskState {
  /** `fast`, `main` or a model id. */
  choice: string;
  thinking: AiThinking | null;
  /** The model that runs now. */
  model: string;
  effectiveThinking: AiThinking | null;
  /** A saved model the connection no longer lists (the task runs on its fallback). */
  unavailable: string | null;
  isDefault: boolean;
}

export interface AiModelsStatus {
  mode: AiMode;
  mainModel: string;
  fastModel: string;
  models: AiModelInfo[];
  tasks: Record<AiTask, AiTaskState>;
  defaults: Record<AiTask, { choice: string }>;
  removedScenario: boolean;
}

export const aiModelsKey = ['mock', 'aiModels'] as const;

export function useAiModels() {
  return useQuery({
    queryKey: aiModelsKey,
    queryFn: () => api<AiModelsStatus>('/mock/ai-models'),
  });
}
