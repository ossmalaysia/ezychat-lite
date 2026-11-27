import type { AiConnectionMode } from '@ezychat/shared';

/**
 * OpenAI models that take text only (an API key may name any model `/v1/models` lists for the Ask Ezy row). Every
 * other OpenAI model the app offers (gpt-4.1, gpt-4o, gpt-5.x, o3, o4-mini …) reads pictures; every Claude model and
 * every ChatGPT sign-in model does (agent replies already send customer photos to them).
 */
const TEXT_ONLY =
  /^(gpt-3\.5|gpt-4(-0314|-0613)?$|gpt-oss|o1-mini|o1-preview|o3-mini|codex|text-|davinci|babbage)/i;

/** Whether a model of this connection can read pictures (Ask Ezy's status flag; design ask-ezy-image §5). */
export function modelReadsPictures(mode: AiConnectionMode, model: string): boolean {
  if (mode !== 'api') return true;
  return !TEXT_ONLY.test(model.trim());
}
