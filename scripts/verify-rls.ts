/**
 * Proves the Phase 1 RLS policies actually hold.
 *
 * Creates two throwaway users, has each act as itself through the PUBLISHABLE
 * key (so RLS applies), and asserts that neither can reach the other's data.
 * Also checks that the encrypted provider key column is unreachable from a
 * normal session. Cleans up after itself.
 *
 *   npm run verify:rls
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';
import type { Database } from '../lib/db/types';

type Client = SupabaseClient<Database>;

const url = SUPABASE_URL();
const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = process.pid;
const USER_A = `rls-a-${stamp}@example.com`;
const USER_B = `rls-b-${stamp}@example.com`;
const PASSWORD = 'rls-test-password-1234';

let failures = 0;

function check(name: string, passed: boolean, detail = '') {
  if (passed) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

async function createUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

async function signIn(email: string): Promise<Client> {
  const client = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

async function main() {
  console.log('Setting up two test users...\n');
  const idA = await createUser(USER_A);
  const idB = await createUser(USER_B);
  const a = await signIn(USER_A);
  const b = await signIn(USER_B);

  try {
    // --- the signup trigger ------------------------------------------------
    const { data: profileA } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', idA)
      .single();
    check('trigger creates a profile on signup', profileA?.id === idA);
    check('new profiles default to role "user"', profileA?.role === 'user');

    const { count: prefCount } = await admin
      .from('user_preferences')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', idA);
    check('trigger creates a user_preferences row', prefCount === 1);

    // --- conversations -----------------------------------------------------
    const { data: convo, error: convoErr } = await a
      .from('conversations')
      .insert({ user_id: idA, title: 'A private chat' })
      .select()
      .single();
    check('user A can create their own conversation', !!convo && !convoErr, convoErr?.message);

    const convoId = convo!.id;

    const { data: ownRead } = await a.from('conversations').select('id').eq('id', convoId);
    check('user A can read their own conversation', ownRead?.length === 1);

    const { data: crossRead } = await b.from('conversations').select('id').eq('id', convoId);
    check("user B cannot read user A's conversation", crossRead?.length === 0);

    const { data: crossUpdate } = await b
      .from('conversations')
      .update({ title: 'hijacked' })
      .eq('id', convoId)
      .select();
    check("user B cannot update user A's conversation", crossUpdate?.length === 0);

    const { data: crossDelete } = await b.from('conversations').delete().eq('id', convoId).select();
    check("user B cannot delete user A's conversation", crossDelete?.length === 0);

    // Forging a row under someone else's user_id must be rejected by WITH CHECK.
    const { error: forgeErr } = await b
      .from('conversations')
      .insert({ user_id: idA, title: 'forged' });
    check('user B cannot insert a conversation owned by user A', !!forgeErr, 'insert succeeded');

    // --- messages (ownership is indirect, via the conversation) ------------
    const { error: msgErr } = await a
      .from('messages')
      .insert({ conversation_id: convoId, role: 'user', content: 'secret' });
    check('user A can add a message to their conversation', !msgErr, msgErr?.message);

    const { data: crossMsg } = await b.from('messages').select('id').eq('conversation_id', convoId);
    check("user B cannot read messages in user A's conversation", crossMsg?.length === 0);

    const { error: msgForgeErr } = await b
      .from('messages')
      .insert({ conversation_id: convoId, role: 'user', content: 'injected' });
    check("user B cannot write into user A's conversation", !!msgForgeErr, 'insert succeeded');

    // --- preferences -------------------------------------------------------
    const { data: crossPrefs } = await b.from('user_preferences').select('*').eq('user_id', idA);
    check("user B cannot read user A's preferences", crossPrefs?.length === 0);

    // --- profile updates ---------------------------------------------------
    // A legitimate update must still work. This is the case the original
    // recursive WITH CHECK broke (42P17), so it is asserted explicitly.
    const { error: renameErr } = await b
      .from('profiles')
      .update({ display_name: 'Renamed B' })
      .eq('id', idB);
    check('a user can update their own display name', !renameErr, renameErr?.message);

    const { data: renamed } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', idB)
      .single();
    check('the display name change persisted', renamed?.display_name === 'Renamed B');

    // --- privilege escalation ---------------------------------------------
    // Asserted against the database, not the response: the guard reverts the
    // column silently, so a row count would not prove anything.
    await b.from('profiles').update({ role: 'admin' }).eq('id', idB);
    const { data: afterEscalation } = await admin
      .from('profiles')
      .select('role')
      .eq('id', idB)
      .single();
    check(
      'a user cannot promote themselves to admin',
      afterEscalation?.role === 'user',
      `role is now "${afterEscalation?.role}"`,
    );

    const { data: crossPromote } = await b
      .from('profiles')
      .update({ display_name: 'hijacked' })
      .eq('id', idA)
      .select();
    check("user B cannot update user A's profile", crossPromote?.length === 0);

    const { data: isAdmin } = await b.rpc('is_admin');
    check('is_admin() is false for a normal user', isAdmin === false);

    // --- provider secrets --------------------------------------------------
    const { data: provider } = await admin
      .from('providers')
      .insert({
        name: `rls-test-${stamp}`,
        encrypted_api_key: 'ciphertext-should-never-leak',
        key_last4: '1234',
        enabled: true,
      })
      .select()
      .single();

    const { error: secretErr } = await b
      .from('providers')
      .select('encrypted_api_key')
      .eq('id', provider!.id);
    check(
      'encrypted_api_key is not selectable by a normal user',
      !!secretErr,
      'column was readable',
    );

    const { error: starErr } = await b.from('providers').select('*').eq('id', provider!.id);
    check('select * on providers is blocked for a normal user', !!starErr, 'select * succeeded');

    const { data: safeRead, error: safeErr } = await b
      .from('providers_public')
      .select('id, name, enabled')
      .eq('id', provider!.id);
    check(
      'providers_public exposes the safe columns',
      !safeErr && safeRead?.length === 1,
      safeErr?.message,
    );

    const leaked = JSON.stringify(safeRead ?? []);
    check('providers_public leaks no ciphertext', !leaked.includes('ciphertext-should-never-leak'));

    // --- audit logs --------------------------------------------------------
    const { data: auditRead } = await b.from('audit_logs').select('id');
    check('audit_logs are not readable by a normal user', auditRead?.length === 0);

    await admin.from('providers').delete().eq('id', provider!.id);
  } finally {
    await admin.auth.admin.deleteUser(idA).catch(() => {});
    await admin.auth.admin.deleteUser(idB).catch(() => {});
    console.log('\nTest users cleaned up.');
  }

  console.log(failures === 0 ? '\nAll RLS checks passed.' : `\n${failures} RLS check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nverify-rls crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
