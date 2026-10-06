import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiSettings } from '@wa-team-inbox/shared';
import { generateOpenAi } from '../src/ai/provider.js';

const settings: AiSettings = {
  enabled: true,
  displayName: 'AI',
  mode: 'api',
  model: '',
  instructions: '',
};
const prompt = {
  instructions: 'Only answer from supplied business knowledge',
  input: 'Opening hours?',
};
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAI Responses provider', () => {
  it('uses the official fixed endpoint, private structured output and no tools', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"reply":"9am to 5pm","action":"answer"}' }],
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(
      await generateOpenAi(settings, 'sk-test-secret', prompt, new AbortController().signal),
    ).toEqual({ reply: '9am to 5pm', action: 'answer' });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'gpt-4.1-mini',
      tools: [],
      store: false,
      instructions: prompt.instructions,
      text: { format: { strict: true, type: 'json_schema' } },
    });
  });
  it('sends a stable prompt_cache_key per install and model, and none without an install id', async () => {
    const reply = () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"reply":"OK","action":"answer"}' }],
            },
          ],
        }),
      );
    const fetcher = vi.fn().mockImplementation(async () => reply());
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    const cached = { ...prompt, cacheId: 'install-abc' };
    await generateOpenAi(settings, 'sk', cached, signal);
    await generateOpenAi(settings, 'sk', { ...cached, input: 'Another customer' }, signal);
    await generateOpenAi({ ...settings, model: 'gpt-4.1' }, 'sk', cached, signal);
    await generateOpenAi(settings, 'sk', prompt, signal);
    const keys = fetcher.mock.calls.map(
      ([, request]) => JSON.parse(request.body).prompt_cache_key as string | undefined,
    );
    expect(keys[0]).toMatch(/^ezychat-[0-9a-f]{16}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).toBeUndefined();
  });
  it('sends customer images as low-detail input_image parts after the text, and plain text without them', async () => {
    const reply = () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"reply":"OK","action":"answer"}' }],
            },
          ],
        }),
      );
    const fetcher = vi.fn().mockImplementation(async () => reply());
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    await generateOpenAi(settings, 'sk', prompt, signal);
    await generateOpenAi(settings, 'sk', { ...prompt, images: [] }, signal);
    await generateOpenAi(
      settings,
      'sk',
      {
        ...prompt,
        images: [
          { mime: 'image/jpeg', base64: '/9j/AAAA' },
          { mime: 'image/png', base64: 'iVBORw0KGgo=' },
        ],
      },
      signal,
    );
    const [plain, empty, images] = fetcher.mock.calls.map(([, request]) => request.body as string);
    expect(JSON.parse(plain!).input).toBe(prompt.input);
    expect(empty).toBe(plain);
    const body = JSON.parse(images!);
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt.input },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,/9j/AAAA', detail: 'low' },
          { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'low' },
        ],
      },
    ]);
    expect(body.instructions).toBe(prompt.instructions);
  });
  it('does not call the provider without a key or after cancellation', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      generateOpenAi(settings, null, prompt, new AbortController().signal),
    ).rejects.toThrow('API key');
    const abort = new AbortController();
    abort.abort();
    await expect(generateOpenAi(settings, 'sk-secret', prompt, abort.signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])(
    'sanitizes HTTP %i errors without parsing or echoing raw bodies',
    async (status) => {
      const response = new Response('SECRET provider body and customer text', { status });
      const json = vi.spyOn(response, 'json');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
      await expect(
        generateOpenAi(settings, 'sk-secret', prompt, new AbortController().signal),
      ).rejects.not.toThrow('SECRET');
      expect(json).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid decisions and incomplete responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [
                  { type: 'output_text', text: '{"reply":"invented","action":"delete_files"}' },
                ],
              },
            ],
          }),
        ),
      ),
    );
    await expect(
      generateOpenAi(settings, 'key', prompt, new AbortController().signal),
    ).rejects.toThrow('invalid answer');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', output: [] }))),
    );
    await expect(
      generateOpenAi(settings, 'key', prompt, new AbortController().signal),
    ).rejects.toThrow('did not complete');
  });
  it('cancels in-flight HTTP generation without echoing fetch error details', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async (_url, request) =>
            new Promise((_resolve, reject) =>
              request.signal.addEventListener('abort', () =>
                reject(new Error('Secret API details')),
              ),
            ),
        ),
    );
    const result = generateOpenAi(settings, 'key', prompt, abort.signal);
    abort.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });
});
