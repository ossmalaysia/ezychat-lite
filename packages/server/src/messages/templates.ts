import type { MessageTemplate } from '@ezychat/shared';
import { WaUnavailableError, type WaAdapter, type WaTemplate } from '@ezychat/wa';
import { HttpError, errors } from '../http/errors.js';
import { capabilitiesOf } from '../inboxes/types.js';

/** Templates are read from the connection at most this often per inbox (unless refreshed). */
export const TEMPLATE_CACHE_MS = 5 * 60_000;

/** Highest `{{n}}` in a template body: the number of values a send must fill in. */
export function templateVariables(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** The connection's template as the inbox shows it: body variables only are sent (v1). */
export function toMessageTemplate(t: WaTemplate): MessageTemplate {
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    body: t.body,
    variables: templateVariables(t.body),
    examples: [...t.examples],
    header: t.header,
    buttons: t.buttons,
    sendable: (t.header === null || t.header === 'text') && !t.buttons,
  };
}

/** The body with each `{{n}}` replaced by `params[n-1]`: the text stored for the sent message. */
export function fillTemplate(body: string, params: readonly string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n: string) => params[Number(n) - 1] ?? whole);
}

export function templatesUnsupported(): HttpError {
  return new HttpError(409, 'templates_unsupported', 'This inbox does not send message templates');
}

/**
 * Approved templates of each inbox, cached TEMPLATE_CACHE_MS per inbox and per adapter (a type
 * change starts empty). 409 `templates_unsupported` without the capability, 503 offline.
 */
export class TemplateCatalog {
  private readonly cache = new Map<
    number,
    { wa: WaAdapter; until: number; templates: MessageTemplate[] }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  async list(inboxId: number, wa: WaAdapter, refresh = false): Promise<MessageTemplate[]> {
    if (!capabilitiesOf(wa).templates || !wa.listTemplates) throw templatesUnsupported();
    const hit = this.cache.get(inboxId);
    if (!refresh && hit && hit.wa === wa && hit.until > this.now()) return hit.templates;
    let raw: WaTemplate[];
    try {
      raw = await wa.listTemplates();
    } catch (err) {
      if (err instanceof WaUnavailableError) throw errors.waUnavailable();
      throw err;
    }
    const templates = raw.map(toMessageTemplate);
    this.cache.set(inboxId, { wa, until: this.now() + TEMPLATE_CACHE_MS, templates });
    return templates;
  }
}
