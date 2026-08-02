/**
 * Exercises every adapter against a fake provider, credentials not required.
 *
 * `verify:providers` proves the abstraction holds and streams real completions
 * through whichever providers this deployment has paid for. That leaves the
 * paths that matter most untested, because they are the ones you cannot reach
 * with a working key: what happens on 401, on 429, on a 500, on a network
 * failure, on a context-length rejection.
 *
 * So this stands a local HTTP server in front of the adapters and makes the
 * provider misbehave on purpose. Nothing here talks to a vendor, nothing costs
 * anything, and it runs in CI without secrets.
 *
 *   npm run verify:adapters
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createOpenAICompatibleProvider } from '../lib/providers/openai-compatible';
import { GROQ_PROVIDER_NAME } from '../lib/providers/groq';
import { PERPLEXITY_PROVIDER_NAME } from '../lib/providers/perplexity';
import { registeredProviderNames } from '../lib/providers/registry';
import type { ChatProvider, ChatStreamEvent, ProviderErrorKind } from '../lib/providers/types';

let failures = 0;
function check(name: string, passed: boolean, detail = '') {
  if (passed) console.log(`  ok    ${name}`);
  else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

/** What the fake provider should do on the next request. */
type Behaviour =
  | { kind: 'stream'; chunks: string[]; usage?: { prompt: number; completion: number } }
  | { kind: 'status'; status: number; body: unknown }
  | { kind: 'models'; ids: string[] };

let behaviour: Behaviour = { kind: 'stream', chunks: ['ok'] };
let lastRequestBody: Record<string, unknown> = {};

function start(): Promise<{ server: Server; baseURL: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          lastRequestBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          lastRequestBody = {};
        }

        if (req.url?.includes('/models') && behaviour.kind === 'models') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: behaviour.ids.map((id) => ({ id })) }));
          return;
        }

        if (behaviour.kind === 'status') {
          res.writeHead(behaviour.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(behaviour.body));
          return;
        }

        if (behaviour.kind === 'stream') {
          // Server-sent events, the shape the OpenAI SDK parses.
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const text of behaviour.chunks) {
            res.write(
              `data: ${JSON.stringify({
                choices: [{ delta: { content: text }, finish_reason: null }],
              })}\n\n`,
            );
          }
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: behaviour.usage?.prompt ?? 11,
                completion_tokens: behaviour.usage?.completion ?? 3,
              },
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseURL: `http://127.0.0.1:${port}/v1` });
    });
  });
}

async function drain(provider: ChatProvider): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of provider.streamChat({
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 64,
  })) {
    events.push(event);
  }
  return events;
}

async function main() {
  const { server, baseURL } = await start();

  const make = (overrides: Partial<Parameters<typeof createOpenAICompatibleProvider>[1]> = {}) =>
    createOpenAICompatibleProvider('test-key', {
      name: 'fake',
      label: 'Fake',
      baseURL,
      probeModel: 'test-model',
      models: { source: 'endpoint' },
      ...overrides,
    });

  try {
    console.log('Registration\n');

    for (const name of [GROQ_PROVIDER_NAME, PERPLEXITY_PROVIDER_NAME]) {
      check(`${name} is registered`, registeredProviderNames().includes(name));
    }

    console.log('\nHappy path\n');

    behaviour = { kind: 'stream', chunks: ['Hel', 'lo'], usage: { prompt: 7, completion: 2 } };
    const events = await drain(make());
    const text = events
      .filter((e): e is Extract<ChatStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.text)
      .join('');
    const done = events.find((e) => e.type === 'done');

    check('streams text deltas in order', text === 'Hello', text);
    check('ends with a done event', done?.type === 'done');
    check(
      'reports usage from the final chunk',
      done?.type === 'done' && done.inputTokens === 7 && done.outputTokens === 2,
      JSON.stringify(done),
    );
    check(
      'reports the stop reason',
      done?.type === 'done' && done.stopReason === 'stop',
      String(done?.type === 'done' ? done.stopReason : ''),
    );

    console.log('\nRejection paths — the ones a working key cannot reach\n');

    /**
     * Each vendor failure must arrive as a typed event, never as a thrown
     * error: the chat route yields these to the browser, and a throw
     * mid-stream would close the connection with no explanation.
     */
    const cases: {
      label: string;
      status: number;
      body: unknown;
      kind: ProviderErrorKind;
      retryable: boolean;
      /**
       * Whether the message should name the provider.
       *
       * Most failures are the vendor's and saying so helps. `context_length` is
       * not: it is about the conversation, and naming a vendor in it would tell
       * the reader nothing they can act on. The rule that holds for ALL of them
       * is the one below — no key material, no raw payload.
       */
      namesProvider?: boolean;
    }[] = [
      {
        label: '401 → auth, not retryable',
        status: 401,
        body: { error: { message: 'bad key' } },
        kind: 'auth',
        retryable: false,
      },
      {
        label: '403 → auth, not retryable',
        status: 403,
        body: { error: { message: 'forbidden' } },
        kind: 'auth',
        retryable: false,
      },
      {
        label: '429 → rate_limit, retryable',
        status: 429,
        body: { error: { message: 'slow down' } },
        kind: 'rate_limit',
        retryable: true,
      },
      {
        label: '429 with insufficient_quota → quota, NOT retryable',
        status: 429,
        body: { error: { message: 'no credit', code: 'insufficient_quota' } },
        kind: 'quota',
        retryable: false,
      },
      {
        label: '402 → quota, not retryable',
        status: 402,
        body: { error: { message: 'payment required' } },
        kind: 'quota',
        retryable: false,
      },
      {
        label: '400 context_length_exceeded → context_length',
        status: 400,
        body: { error: { message: 'too long', code: 'context_length_exceeded' } },
        kind: 'context_length',
        retryable: false,
        namesProvider: false,
      },
      {
        label: '500 → provider, retryable',
        status: 500,
        body: { error: { message: 'boom' } },
        kind: 'provider',
        retryable: true,
      },
      {
        label: '400 otherwise → provider, not retryable',
        status: 400,
        body: { error: { message: 'nope' } },
        kind: 'provider',
        retryable: false,
      },
    ];

    for (const c of cases) {
      behaviour = { kind: 'status', status: c.status, body: c.body };
      const out = await drain(make());
      const error = out.find((e) => e.type === 'error');

      check(
        c.label,
        error?.type === 'error' && error.kind === c.kind && error.retryable === c.retryable,
        error?.type === 'error' ? `${error.kind}/${error.retryable}` : 'no error event',
      );
      const message = error?.type === 'error' ? error.message : '';
      check(
        `  ↳ carries no key material and no vendor payload`,
        Boolean(message) &&
          !message.includes('bad key') &&
          !message.includes('forbidden') &&
          !message.includes('boom') &&
          !message.includes('nope') &&
          !message.includes('test-key'),
        message,
      );
      if (c.namesProvider !== false) {
        check(`  ↳ names the provider`, message.includes('Fake'), message);
      }
    }

    console.log('\nWire-format differences the config exists for\n');

    behaviour = { kind: 'stream', chunks: ['x'] };
    await drain(make({ outputTokenParam: 'max_tokens' }));
    check(
      'max_tokens is sent when a provider requires the original name',
      lastRequestBody.max_tokens === 64 && lastRequestBody.max_completion_tokens === undefined,
      JSON.stringify(lastRequestBody).slice(0, 120),
    );

    await drain(make());
    check(
      'max_completion_tokens is the default',
      lastRequestBody.max_completion_tokens === 64 && lastRequestBody.max_tokens === undefined,
    );

    await drain(make({ requestUsageInStream: false }));
    check(
      'stream_options is omitted for providers that reject it',
      lastRequestBody.stream_options === undefined,
    );

    await drain(make());
    check('stream_options is sent by default', lastRequestBody.stream_options !== undefined);

    console.log('\nModel listing\n');

    behaviour = { kind: 'models', ids: ['b-model', 'a-model', 'whisper-large'] };
    const listed = await make({
      models: { source: 'endpoint', include: (id) => !id.includes('whisper') },
    }).listModels();
    check(
      'endpoint listing filters and sorts',
      listed.map((m) => m.id).join(',') === 'a-model,b-model',
      listed.map((m) => m.id).join(','),
    );

    const staticList = await make({
      models: { source: 'static', list: [{ id: 'only', displayName: 'Only' }] },
    }).listModels();
    check(
      'static listing is used where a provider has no /models endpoint',
      staticList.length === 1 && staticList[0].id === 'only',
    );

    behaviour = { kind: 'status', status: 401, body: { error: { message: 'bad key' } } };
    let listThrew: unknown = null;
    try {
      await make().listModels();
    } catch (err) {
      listThrew = err;
    }
    check(
      'listModels throws a typed error rather than returning empty',
      listThrew !== null && (listThrew as { kind?: string }).kind === 'auth',
      String((listThrew as { kind?: string })?.kind),
    );

    console.log('\nvalidateKey\n');

    behaviour = { kind: 'stream', chunks: ['hi'] };
    const okValidation = await make().validateKey();
    check('a working key validates', okValidation.valid);
    check('and reports a latency', typeof okValidation.latencyMs === 'number');
    check(
      'validateKey generates rather than listing models',
      typeof lastRequestBody.messages !== 'undefined',
      'no chat body was sent — it called /models instead',
    );

    behaviour = { kind: 'status', status: 401, body: { error: { message: 'bad key' } } };
    const badValidation = await make().validateKey();
    check('a rejected key does not validate', !badValidation.valid);
    check(
      'and gives a reason safe to show a user',
      Boolean(badValidation.reason?.includes('Fake')) && !badValidation.reason?.includes('bad key'),
      badValidation.reason,
    );

    console.log('\nMissing credential\n');

    let threw: unknown = null;
    try {
      createOpenAICompatibleProvider('', {
        name: 'fake',
        label: 'Fake',
        baseURL,
        probeModel: 'test-model',
        models: { source: 'endpoint' },
      });
    } catch (err) {
      threw = err;
    }
    check(
      'an empty key throws auth at construction, not at first use',
      threw !== null && (threw as { kind?: string }).kind === 'auth',
    );
  } finally {
    server.close();
  }

  console.log(
    failures === 0 ? '\nAll adapter checks passed.' : `\n${failures} adapter check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-adapters crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
