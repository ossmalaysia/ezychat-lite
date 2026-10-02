import type { z } from 'zod';
import { ApiErrorSchema } from '@wa-team-inbox/shared';

export const UNAUTHORIZED_EVENT = 'wati:unauthorized';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiInit<T> {
  method?: string;
  body?: unknown;
  form?: FormData;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

/**
 * Fetch `/api${path}` with same-origin cookies. JSON in / JSON out.
 * Non-2xx → ApiError (code/message from the server's `{ error: { code, message } }` body).
 * 401 additionally dispatches a `wati:unauthorized` window event.
 */
export async function api<T = unknown>(path: string, init: ApiInit<T> = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;
  if (init.form) {
    body = init.form;
  } else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection.');
  }

  const text = res.status === 204 ? '' : await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const parsed = ApiErrorSchema.safeParse(data);
    if (parsed.success)
      throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
    throw new ApiError(
      res.status,
      `http_${res.status}`,
      res.statusText || `Request failed (${res.status})`,
    );
  }

  if (init.schema) return init.schema.parse(data);
  return data as T;
}

/** Friendly message for any thrown error. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'rate_limited')
      return e.message || 'Too many attempts. Please wait and try again.';
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
