import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { FastifyRequest } from 'fastify';

/** Credentials stay on the Fastify side; the SDK sees only protocol headers. */
const DROPPED_HEADERS = new Set(['authorization', 'cookie']);

function toWebRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || DROPPED_HEADERS.has(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request('http://localhost/mcp', { method: req.method, headers });
}

export interface McpHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Runs one Streamable HTTP request through the SDK in stateless JSON mode (no SSE, no session),
 * so Fastify keeps the reply: security headers, error handling and graceful close still apply.
 */
export async function handleMcpRequest(
  req: FastifyRequest,
  server: McpServer,
): Promise<McpHttpResponse> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(toWebRequest(req), { parsedBody: req.body });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return { status: res.status, headers, body: await res.text() };
  } finally {
    await server.close();
  }
}
