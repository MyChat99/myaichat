/**
 * Proves the Phase 2 acceptance criteria against a running dev server.
 *
 * Covers: a full streamed exchange, history persisted for reload, stop halting
 * generation server-side, regenerate rewinding the thread, usage logging, the
 * cross-user 404, and an XSS payload rendering inert.
 *
 *   npm run dev            # in another terminal
 *   npm run verify:chat    # BASE_URL=http://localhost:3001 to override the port
 *
 * Sends a handful of very short prompts, so it costs a fraction of a cent.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { createClient, type Session } from '@supabase/supabase-js';
import React from 'react';

import { Markdown } from '../components/chat/markdown';
import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const CHUNK_SIZE = 3180;

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = process.pid;
const PASSWORD = 'chat-test-password-1234';

let failures = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function sessionCookie(session: Session): string {
  const name = `sb-${projectRef}-auth-token`;
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`;
  if (value.length <= CHUNK_SIZE) return `${name}=${value}`;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(`${name}.${chunks.length}=${value.slice(i, i + CHUNK_SIZE)}`);
  }
  return chunks.join('; ');
}

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const client = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return { id: data.user.id, cookie: sessionCookie(signIn.session!) };
}

async function newConversation(userId: string) {
  const { data: model } = await admin
    .from('models')
    .select('id')
    .eq('enabled', true)
    .limit(1)
    .single();
  const { data, error } = await admin
    .from('conversations')
    .insert({ user_id: userId, title: 'New chat', model_id: model?.id ?? null })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

type StreamOutcome = { text: string; events: string[]; status: number };

/** POSTs to /api/chat and drains the NDJSON stream. `stopAfterChars` aborts mid-stream. */
async function stream(
  cookie: string,
  body: Record<string, unknown>,
  stopAfterChars?: number,
): Promise<StreamOutcome> {
  const controller = new AbortController();
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    return { text: '', events: [], status: response.status };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const events: string[] = [];

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { type: string; text?: string };
        events.push(event.type);
        if (event.type === 'text') text += event.text ?? '';
      }
      if (stopAfterChars !== undefined && text.length >= stopAfterChars) {
        controller.abort();
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
  }

  return { text, events, status: response.status };
}

async function messagesFor(conversationId: string) {
  const { data } = await admin
    .from('messages')
    .select('id, role, content, input_tokens, output_tokens, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

async function main() {
  try {
    await fetch(BASE_URL, { redirect: 'manual' });
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first (npm run dev).`);
    process.exit(1);
  }

  console.log(`Testing chat against ${BASE_URL}\n`);

  const alice = await makeUser(`chat-a-${stamp}@example.com`);
  const bob = await makeUser(`chat-b-${stamp}@example.com`);

  try {
    // --- auth ---------------------------------------------------------------
    // `redirect: 'manual'` matters: if the proxy ever starts redirecting API
    // routes again, a default fetch would follow the 307 to the HTML login page
    // and report a misleading 200.
    const anon = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: '00000000-0000-0000-0000-000000000000' }),
      redirect: 'manual',
    });
    check('unauthenticated POST /api/chat returns 401', anon.status === 401, `got ${anon.status}`);
    check(
      'unauthenticated POST /api/chat returns JSON, not an HTML redirect',
      (anon.headers.get('content-type') ?? '').includes('application/json'),
      `content-type: ${anon.headers.get('content-type')}`,
    );

    // --- a full streamed exchange -------------------------------------------
    const convo = await newConversation(alice.id);
    const first = await stream(alice.cookie, {
      conversationId: convo,
      message: 'Reply with exactly: HELLO',
    });

    check('stream returns text deltas', first.text.length > 0, `got "${first.text}"`);
    check('stream emits a done event', first.events.includes('done'));
    check('stream emits no error event', !first.events.includes('error'));

    const persisted = await messagesFor(convo);
    check(
      'both turns persisted for reload',
      persisted.length === 2 && persisted[0].role === 'user' && persisted[1].role === 'assistant',
      `${persisted.length} row(s)`,
    );
    check('assistant content matches what was streamed', persisted[1]?.content === first.text);
    check(
      'token counts recorded on the assistant message',
      (persisted[1]?.input_tokens ?? 0) > 0 && (persisted[1]?.output_tokens ?? 0) > 0,
      `in=${persisted[1]?.input_tokens} out=${persisted[1]?.output_tokens}`,
    );

    const { data: convoRow } = await admin
      .from('conversations')
      .select('title')
      .eq('id', convo)
      .single();
    check(
      'conversation auto-titled from the first message',
      convoRow?.title !== 'New chat',
      `title="${convoRow?.title}"`,
    );

    const { count: usageCount } = await admin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', alice.id);
    check('usage_logs row written', (usageCount ?? 0) >= 1);

    // --- cross-user isolation ----------------------------------------------
    const cross = await stream(bob.cookie, {
      conversationId: convo,
      message: 'Whose chat is this?',
    });
    check(
      "user B cannot post into user A's conversation",
      cross.status === 404,
      `got ${cross.status}`,
    );

    // --- regenerate ---------------------------------------------------------
    const beforeRegen = await messagesFor(convo);
    const oldAssistantId = beforeRegen[1].id;
    const regen = await stream(alice.cookie, {
      conversationId: convo,
      truncateFromMessageId: oldAssistantId,
    });
    check('regenerate produces a new response', regen.text.length > 0);

    const afterRegen = await messagesFor(convo);
    check(
      'regenerate replaces rather than appends',
      afterRegen.length === 2,
      `${afterRegen.length} row(s)`,
    );
    check('the old assistant message is gone', !afterRegen.some((m) => m.id === oldAssistantId));

    // --- edit and resubmit ---------------------------------------------------
    const userMessageId = afterRegen[0].id;
    const edited = await stream(alice.cookie, {
      conversationId: convo,
      message: 'Reply with exactly: EDITED',
      truncateFromMessageId: userMessageId,
    });
    check('edit-and-resubmit produces a response', edited.text.length > 0);

    const afterEdit = await messagesFor(convo);
    check(
      'edited thread still has exactly one exchange',
      afterEdit.length === 2,
      `${afterEdit.length} row(s)`,
    );
    check(
      'the edited user message replaced the original',
      afterEdit[0].content.includes('EDITED') && afterEdit[0].id !== userMessageId,
    );

    // --- stop ---------------------------------------------------------------
    const stopConvo = await newConversation(alice.id);
    const stopped = await stream(
      alice.cookie,
      { conversationId: stopConvo, message: 'Count slowly from 1 to 100, one number per line.' },
      5, // abort as soon as a few characters have arrived
    );
    check('stop halts the stream early', !stopped.events.includes('done'));

    // The server must notice the disconnect and stop generating, not run to
    // completion in the background — a full 1..100 answer would be far longer.
    await new Promise((r) => setTimeout(r, 3000));
    const stopMessages = await messagesFor(stopConvo);
    const partial = stopMessages.find((m) => m.role === 'assistant');
    check('the partial answer is kept, not discarded', partial !== undefined);
    check(
      'generation actually stopped server-side',
      (partial?.content.length ?? 0) < 400,
      `persisted ${partial?.content.length ?? 0} chars`,
    );

    // --- XSS ----------------------------------------------------------------
    // Renders the real component, so this exercises the shipped plugin chain.
    const payload = [
      '<script>window.__pwned = 1</script>',
      '<img src=x onerror="window.__pwned=1">',
      '<a href="javascript:alert(1)">click</a>',
      '',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n');

    const html = renderToStaticMarkup(React.createElement(Markdown, { content: payload }));
    check('script tags are stripped', !/<script/i.test(html));
    check('inline event handlers are stripped', !/onerror=/i.test(html));
    check('javascript: URLs are stripped', !/href="javascript:/i.test(html));
    check('code blocks still render', /<pre/.test(html) && html.includes('const'));
    check('syntax highlighting classes survive sanitization', /hljs/.test(html));
  } finally {
    await admin.auth.admin.deleteUser(alice.id).catch(() => {});
    await admin.auth.admin.deleteUser(bob.id).catch(() => {});
    console.log('\nTest users cleaned up.');
  }

  console.log(failures === 0 ? '\nAll chat checks passed.' : `\n${failures} chat check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-chat crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
