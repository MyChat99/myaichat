/**
 * Editions — gathering pages, and what happens when the gathering is undone.
 *
 * The requirement that shapes this whole feature: deleting an edition must
 * release its pages **where they were**. A page written last Tuesday goes back
 * under Tuesday, not under Today.
 *
 * That is not a UI concern. `conversations_set_updated_at` restamped the row on
 * every update, the sidebar groups by `updated_at`, and `on delete set null` is
 * an update — so deleting an edition would have moved every one of its pages to
 * "Today" and destroyed the real history, while looking exactly like it worked.
 *
 * So these assertions are against STORED STATE, at the layer where the risk
 * lives. Ownership is checked through the anon client with each user's own
 * session, because RLS is the actual authorisation boundary and a check written
 * against the service role proves nothing about it.
 *
 *   npm run verify:editions
 */
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const url = SUPABASE_URL();
const PASSWORD = 'editions-plate-folio-2610';

const admin = createClient<Database>(url, SECRET_KEY(), {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
function check(name: string, passed: boolean, detail = '') {
  if (passed) console.log(`  ok    ${name}`);
  else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

/** A client bound to a real user's session, so RLS applies as it does in the app. */
async function asUser(tag: string) {
  const email = `editions-${tag}-${process.pid}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const client = createClient<Database>(url, PUBLISHABLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  return { id: data.user.id, client };
}

/** Five days ago, to a fixed instant — the "previous day" the requirement is about. */
const EARLIER = new Date(Date.now() - 5 * 86_400_000).toISOString();

/**
 * Compare INSTANTS, never the strings.
 *
 * JavaScript writes `2026-07-29T21:33:59.703Z`; Postgres returns
 * `2026-07-29T21:33:59.703+00:00`. Identical moments, different text, and a
 * `===` between them fails while reporting two timestamps that look the same —
 * which is how this file first accused a working trigger of restamping a row it
 * had left completely alone.
 */
function sameInstant(a: string | null | undefined, b: string): boolean {
  return typeof a === 'string' && Date.parse(a) === Date.parse(b);
}

async function main() {
  const alice = await asUser('alice');
  const bob = await asUser('bob');

  try {
    // ── the requirement ───────────────────────────────────────────────────
    console.log('A page from a previous day survives its edition being deleted\n');

    const { data: edition } = await alice.client
      .from('editions')
      .insert({ user_id: alice.id, name: 'August' })
      .select('id')
      .single();
    check('an edition can be created', Boolean(edition?.id));

    const { data: page } = await admin
      .from('conversations')
      .insert({
        user_id: alice.id,
        title: 'Written five days ago',
        created_at: EARLIER,
        updated_at: EARLIER,
      })
      .select('id, updated_at')
      .single();
    check(
      'and a page dated five days ago exists',
      sameInstant(page?.updated_at, EARLIER),
      page?.updated_at,
    );

    await alice.client.from('conversations').update({ edition_id: edition!.id }).eq('id', page!.id);

    const afterAssign = await admin
      .from('conversations')
      .select('edition_id, updated_at')
      .eq('id', page!.id)
      .single();

    check('assigning it to an edition takes', afterAssign.data?.edition_id === edition!.id);
    check(
      'and does NOT restamp updated_at — the page stays on its own day',
      sameInstant(afterAssign.data?.updated_at, EARLIER),
      `${EARLIER} → ${afterAssign.data?.updated_at}`,
    );

    await alice.client.from('editions').delete().eq('id', edition!.id);

    const afterDelete = await admin
      .from('conversations')
      .select('id, title, edition_id, updated_at')
      .eq('id', page!.id)
      .maybeSingle();

    check('deleting the edition does NOT delete the page', afterDelete.data !== null);
    check('the page comes loose', afterDelete.data?.edition_id === null);
    check(
      'and it is STILL dated five days ago, not today',
      sameInstant(afterDelete.data?.updated_at, EARLIER),
      `${EARLIER} → ${afterDelete.data?.updated_at}`,
    );

    // ── a real edit still restamps ────────────────────────────────────────
    /**
     * The other half, and the reason the trigger was narrowed rather than
     * dropped. If membership changes stopped restamping by removing the trigger,
     * renaming a page would stop restamping too and the sidebar would freeze.
     */
    await alice.client.from('conversations').update({ title: 'Renamed' }).eq('id', page!.id);
    const afterEdit = await admin
      .from('conversations')
      .select('updated_at')
      .eq('id', page!.id)
      .single();
    check(
      'but a REAL edit does restamp it, so ordering still works',
      !sameInstant(afterEdit.data?.updated_at, EARLIER),
      String(afterEdit.data?.updated_at),
    );

    // ── one edition at a time ─────────────────────────────────────────────
    console.log('\nA page belongs to at most one edition\n');

    const { data: first } = await alice.client
      .from('editions')
      .insert({ user_id: alice.id, name: 'First' })
      .select('id')
      .single();
    const { data: second } = await alice.client
      .from('editions')
      .insert({ user_id: alice.id, name: 'Second' })
      .select('id')
      .single();

    await alice.client.from('conversations').update({ edition_id: first!.id }).eq('id', page!.id);
    await alice.client.from('conversations').update({ edition_id: second!.id }).eq('id', page!.id);

    const moved = await admin
      .from('conversations')
      .select('edition_id')
      .eq('id', page!.id)
      .single();
    check(
      'moving it to another edition replaces rather than adds',
      moved.data?.edition_id === second!.id,
    );

    await alice.client.from('conversations').update({ edition_id: null }).eq('id', page!.id);
    const removed = await admin
      .from('conversations')
      .select('edition_id')
      .eq('id', page!.id)
      .single();
    check('and it can be taken out entirely', removed.data?.edition_id === null);

    // ── ownership, through RLS ────────────────────────────────────────────
    console.log("\nOne user cannot reach another's editions\n");

    const bobReads = await bob.client.from('editions').select('id').eq('id', first!.id);
    check(
      "Bob cannot READ Alice's edition",
      (bobReads.data ?? []).length === 0,
      `${(bobReads.data ?? []).length} row(s)`,
    );

    const bobRenames = await bob.client
      .from('editions')
      .update({ name: 'Stolen' })
      .eq('id', first!.id)
      .select('id');
    check("Bob cannot RENAME Alice's edition", (bobRenames.data ?? []).length === 0);

    const bobDeletes = await bob.client.from('editions').delete().eq('id', first!.id).select('id');
    check("Bob cannot DELETE Alice's edition", (bobDeletes.data ?? []).length === 0);

    const stillThere = await admin
      .from('editions')
      .select('name')
      .eq('id', first!.id)
      .maybeSingle();
    check(
      "and Alice's edition is untouched by all of that",
      stillThere.data?.name === 'First',
      String(stillThere.data?.name),
    );

    /**
     * The gap RLS does NOT close, and the reason there is a trigger.
     *
     * Bob owns his own conversation, so the `conversations` policy permits the
     * write — it has no opinion about the VALUE of `edition_id`. Without the
     * `conversations_edition_owned` trigger, Bob could file his page inside
     * Alice's edition. Asserted through the service role as well, because the
     * trigger has to hold for the client every server action in this app uses.
     */
    const { data: bobPage } = await admin
      .from('conversations')
      .insert({ user_id: bob.id, title: "Bob's page" })
      .select('id')
      .single();

    const cross = await bob.client
      .from('conversations')
      .update({ edition_id: first!.id })
      .eq('id', bobPage!.id)
      .select('id');
    check(
      "Bob cannot file HIS page into Alice's edition",
      (cross.data ?? []).length === 0,
      `${(cross.data ?? []).length} row(s) updated`,
    );

    const crossService = await admin
      .from('conversations')
      .update({ edition_id: first!.id })
      .eq('id', bobPage!.id)
      .select('id');
    check(
      'and neither can the SERVICE ROLE, which bypasses RLS entirely',
      crossService.error !== null,
      crossService.error ? 'refused' : 'the write succeeded — the trigger is not enforcing',
    );

    // ── shape guards ──────────────────────────────────────────────────────
    console.log('\nWhat the table refuses\n');

    const blank = await alice.client
      .from('editions')
      .insert({ user_id: alice.id, name: '   ' })
      .select('id');
    check('a name of nothing but spaces is refused', blank.error !== null);

    const tooLong = await alice.client
      .from('editions')
      .insert({ user_id: alice.id, name: 'x'.repeat(81) })
      .select('id');
    check('and so is one past 80 characters', tooLong.error !== null);
  } finally {
    await admin.auth.admin.deleteUser(alice.id).catch(() => {});
    await admin.auth.admin.deleteUser(bob.id).catch(() => {});
    console.log('\nTest users cleaned up.');
  }

  console.log(
    failures === 0
      ? '\nEditions gather pages, and releasing them leaves history alone.'
      : `\n${failures} edition check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-editions crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
