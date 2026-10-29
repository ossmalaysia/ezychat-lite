import { tool, type ToolSet } from 'ai';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AiToolCrmDetail } from '@ezychat/shared';
import { agentById } from '../../ai/agents.js';
import type {
  AgentToolInfo,
  AgentToolsInput,
  ExtensionToolCall,
  ExtensionToolsTurn,
} from '../../ai/agent/extension-tools.js';
import type { AppContext } from '../../context.js';
import { getChats } from '../../wa-bridge/index.js';
import { ZohoError } from './zoho.js';
import type { AddLeadResult } from './service.js';

export const FIND_CRM_CUSTOMER = 'find_crm_customer';
export const ADD_CRM_LEAD = 'add_crm_lead';
export const ZOHO_TOOL_NAMES = [FIND_CRM_CUSTOMER, ADD_CRM_LEAD] as const;
const SOURCE = 'zoho-crm';
const SOURCE_LABEL = 'Zoho CRM';
const FIND_TITLE = 'Find the customer';
const ADD_TITLE = 'Add a lead';

/** True when this agent's Zoho CRM counts as a source of facts (connected and Find the customer on). */
export function zohoLookupsAvailable(ctx: AppContext, agentId?: number | null): boolean {
  return !!ctx.services.zohoCrm?.usable(agentId);
}

const REFUSALS: Record<Exclude<AddLeadResult, { ok: true }>['reason'], string> = {
  exists:
    'Not added: this number is already in Zoho CRM. Do not add it again; continue the conversation.',
  no_name:
    "Not added yet: the lead needs the customer's name. Ask for it, then call add_crm_lead again with the name exactly as they wrote it.",
  no_number: 'Not added: this chat has no phone number Zoho CRM can use. Continue without it.',
  not_allowed: 'Not added: adding leads is switched off. Continue without it.',
  invalid_email:
    'Not added: that email address does not look valid. Ask the customer to check it, or leave it out.',
  not_from_customer:
    'Not added: pass only details the customer wrote in this chat, exactly as they wrote them, or leave them out.',
};

/**
 * The Zoho CRM tools for one AI agent turn: `find_crm_customer` when Find the customer is on, and
 * `add_crm_lead` when Add new leads is on too. A Zoho failure never hands the chat over: the tool
 * says Zoho CRM is not available and the AI answers without it. Try it (no chat) changes nothing.
 */
export function zohoAgentTools(
  ctx: AppContext,
  log: Logger,
  input: AgentToolsInput,
  options: { onCall?: (name: string) => void },
): ExtensionToolsTurn {
  const service = ctx.services.zohoCrm;
  const settings = service?.usable(input.agentId);
  const calls: ExtensionToolCall[] = [];
  const tools: ToolSet = {};
  const empty = {
    tools,
    failed: () => false,
    used: () => [],
    calls: () => [],
    dispose: async () => {},
  };
  if (!service || !settings || input.agentId === undefined) return empty;
  const agentId = input.agentId;
  const chatJid = input.chatJid;
  let found: AiToolCrmDetail | null = null;

  const run = async (
    name: string,
    title: string,
    body: () => Promise<{ output: string; crm?: AiToolCrmDetail; notRun?: boolean }>,
  ): Promise<string> => {
    options.onCall?.(name);
    const started = Date.now();
    let ok = true;
    let result: { output: string; crm?: AiToolCrmDetail; notRun?: boolean };
    try {
      result = await body();
    } catch (error) {
      if (input.signal.aborted) throw error;
      ok = false;
      log.warn(
        {
          event: 'zoho_crm_tool_failed',
          tool: name,
          kind: error instanceof ZohoError ? error.kind : 'other',
          status: error instanceof ZohoError ? error.status : null,
        },
        'Zoho CRM tool failed',
      );
      if (chatJid)
        service.addActivity(
          name === ADD_CRM_LEAD
            ? { kind: 'not_added', agentId, chatJid, reason: 'unavailable' }
            : { kind: 'failed', agentId, chatJid },
        );
      result = {
        output:
          'Zoho CRM is not available right now. Continue the conversation without it; do not mention it to the customer.',
      };
    }
    const ms = Date.now() - started;
    calls.push({
      tool: name,
      source: SOURCE,
      title,
      sourceLabel: SOURCE_LABEL,
      ok,
      ms,
      ...(result.crm ? { crm: result.crm } : {}),
      ...(result.notRun ? { notRun: true } : {}),
    });
    log.info({ event: 'ai_tool_call', tool: name, source: SOURCE, ok, ms }, 'AI tool call');
    ctx.bus.emit('ai:tool_call', {
      agent: input.agent,
      agentId,
      chatJid,
      tool: name,
      source: SOURCE,
      title,
      ok,
      ms,
    });
    return result.output;
  };

  tools[FIND_CRM_CUSTOMER] = tool({
    description:
      "Look up this chat's customer in the business's Zoho CRM by their WhatsApp number (Contacts, then " +
      'Leads). Call it once near the start of a conversation, before answering, to know who you are ' +
      "talking to: name, company, owner (the business's salesperson) and lead status. The owner and " +
      'status are for you only: never tell the customer about them.',
    inputSchema: z.object({}),
    execute: () =>
      run(FIND_CRM_CUSTOMER, FIND_TITLE, async () => {
        if (!chatJid)
          return {
            output:
              'Test only (Try it): there is no customer number here, so nothing was looked up. In a real chat this returns the customer\'s Zoho CRM record, or "not found".',
          };
        if (!service.hasNumber(chatJid))
          return { output: 'This chat has no phone number to look up. Continue without Zoho CRM.' };
        const record = await service.findCustomer(chatJid, input.signal);
        if (!found) {
          service.addActivity(
            record
              ? { kind: 'found', agentId, chatJid, module: record.module }
              : { kind: 'not_found', agentId, chatJid },
          );
        }
        found = { action: record ? 'found' : 'not_found' };
        if (!record)
          return {
            output: JSON.stringify({
              found: false,
              note:
                (settings.addLeads
                  ? 'Not in Zoho CRM yet. When the customer makes a real enquiry (asks to buy, book, order or get a quote), add them with add_crm_lead; it needs their name. '
                  : 'Not in Zoho CRM yet. ') + 'Answer as usual.',
            }),
            crm: found,
          };
        return {
          output: JSON.stringify({
            found: true,
            type: record.module === 'Contacts' ? 'contact' : 'lead',
            name: record.name,
            company: record.company,
            owner: record.owner,
            leadStatus: record.status,
            note: 'Use the name to greet the customer. Owner and lead status are internal: never tell the customer.',
          }),
          crm: found,
        };
      }),
  });

  if (settings.addLeads)
    tools[ADD_CRM_LEAD] = tool({
      description:
        "Add this chat's customer as a new lead in the business's Zoho CRM. Use it at most once, only " +
        'after find_crm_customer said the customer is not in Zoho CRM, and only when they make a real ' +
        'enquiry (they want to buy, book, order or get a quote), not for a greeting or a general question. ' +
        'Leave name, company and email out to use the saved contact, or pass exactly what the customer wrote ' +
        'in this chat; never invent them. "request" is your own one-line summary of what they want (no ' +
        'personal details). Never tell the customer about Zoho CRM or leads.',
      inputSchema: z.object({
        name: z.string().max(100).optional().describe("The customer's name, only as they wrote it"),
        company: z
          .string()
          .max(100)
          .optional()
          .describe("The customer's company, only as they wrote it"),
        email: z
          .string()
          .max(254)
          .optional()
          .describe("The customer's email address, only as they wrote it"),
        request: z
          .string()
          .max(300)
          .describe(
            'One line: what the customer wants, e.g. "Office lunch catering, 80 pax, 15 Nov"',
          ),
      }),
      execute: ({ name, company, email, request }) =>
        run(ADD_CRM_LEAD, ADD_TITLE, async () => {
          if (!chatJid)
            return {
              output:
                'Test only (Try it): nothing was added. In a real chat the lead would be added now; continue as you would after that.',
              crm: { action: 'lead_added' },
              notRun: true,
            };
          const result = await service.addLeadByAi(
            agentId,
            chatJid,
            { name, company, email, request },
            input.signal,
          );
          if (!result.ok) return { output: REFUSALS[result.reason] };
          if (!result.already) {
            // The chat line is written at once: the lead exists even if this reply never goes out.
            const agent = agentById(ctx.db, agentId);
            if (agent)
              getChats(ctx).addAiToolUsed(chatJid, agent.userId, [
                { title: ADD_TITLE, sourceLabel: SOURCE_LABEL, crm: { action: 'lead_added' } },
              ]);
          }
          return {
            output: `${result.already ? 'Already added' : 'Added'} as a lead in Zoho CRM. Do not mention this to the customer; continue the conversation.`,
            crm: { action: 'lead_added' },
          };
        }),
    });

  return {
    tools,
    // Zoho failures never end the turn.
    failed: () => false,
    used: (): AgentToolInfo[] =>
      chatJid && found ? [{ title: FIND_TITLE, sourceLabel: SOURCE_LABEL, crm: found }] : [],
    calls: () => [...calls],
    dispose: async () => {},
  };
}
