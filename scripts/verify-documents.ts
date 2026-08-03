/**
 * Document attachments: what gets read, what gets refused, and what gets said.
 *
 * The happy path is the easy half. What this is really for is the other one —
 * a parser is the place in this application where an untrusted user chooses the
 * bytes, so every negative path gets a test: the wrong type, the oversized
 * file, the corrupt archive, the archive that lies about how big it is, the
 * file whose name disagrees with its contents, and the pairing the model cannot
 * read.
 *
 *   npm run dev
 *   npm run verify:documents
 */
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../lib/db/types';
import { buildDocx, buildPng, buildXlsx, buildZip } from './_fixtures';
import { PUBLISHABLE_KEY, SECRET_KEY, SUPABASE_URL } from './_env';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const url = SUPABASE_URL();
const projectRef = new URL(url).hostname.split('.')[0];
const PASSWORD = 'documents-test-password-1234';

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

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function main() {
  const {
    extractAttachmentText,
    contentMatchesType,
    fenceExtracted,
    ExtractionError,
    EXTRACTION_LIMITS,
  } = await import('../lib/upload/extract');
  const { resolveMime, kindFor, capabilityRefusal, rejectionReason, labelFor } =
    await import('../lib/upload/types');

  const extractionFails = (mime: string, bytes: Buffer): string | null => {
    try {
      extractAttachmentText(mime, bytes);
      return null;
    } catch (err) {
      return err instanceof ExtractionError ? err.message : `wrong error type: ${String(err)}`;
    }
  };

  console.log('The type table is one table\n');

  check(
    'a .md with no MIME type from the browser still resolves',
    resolveMime({ name: 'notes.md', type: '' }) === 'text/markdown',
    String(resolveMime({ name: 'notes.md', type: '' })),
  );
  check(
    'a .csv reported as an Excel type still resolves as CSV',
    resolveMime({ name: 'rows.csv', type: 'application/vnd.ms-excel' }) === 'text/csv',
  );
  check(
    'and an unknown extension with a generic type is still refused',
    resolveMime({ name: 'payload.bin', type: 'application/octet-stream' }) === null,
  );
  check(
    'every accepted type has a kind and a label',
    ['application/pdf', 'text/csv', DOCX, XLSX].every((m) => kindFor(m) && labelFor(m) !== 'File'),
  );

  console.log('\nWhat each type turns into\n');

  const csv = Buffer.from('Region,Units\nNorth,120\nSouth,95\n', 'utf8');
  const csvOut = extractAttachmentText('text/csv', csv);
  check('a CSV comes through as its own text', csvOut.text.includes('North,120'));
  check('and is not marked truncated', csvOut.truncated === false);

  const docx = buildDocx(['Quarterly review', 'Revenue rose by 12% in the northern region.']);
  const docxOut = extractAttachmentText(DOCX, docx);
  check(
    'a .docx yields its paragraphs',
    docxOut.text.includes('Quarterly review') && docxOut.text.includes('northern region'),
    docxOut.text.slice(0, 80),
  );

  const xlsx = buildXlsx([
    {
      name: 'Q1',
      rows: [
        ['Region', 'Units', 'Revenue'],
        ['North', '120', '4800'],
        ['South', '95', '3610'],
      ],
    },
    { name: 'Notes', rows: [['Owner'], ['Priya']] },
  ]);
  const xlsxOut = extractAttachmentText(XLSX, xlsx);
  check(
    'a spreadsheet is read sheet by sheet, by name',
    xlsxOut.text.includes('Sheet "Q1"') && xlsxOut.text.includes('Sheet "Notes"'),
    xlsxOut.text.slice(0, 100),
  );
  check(
    'the header row survives, above its data',
    xlsxOut.text.indexOf('Region\tUnits\tRevenue') < xlsxOut.text.indexOf('North\t120\t4800'),
  );
  check('and a second sheet is not dropped', xlsxOut.text.includes('Priya'));

  /**
   * A gap in the middle of a row shifts every column after it. A header that no
   * longer lines up with its data is worse than no spreadsheet at all, because
   * the model will answer confidently from the wrong column.
   */
  const gapped = buildXlsx([
    {
      name: 'Gaps',
      rows: [
        ['A', 'B', 'C'],
        ['one', '', 'three'],
      ],
    },
  ]);
  check(
    'a missing cell keeps its column rather than closing the gap',
    extractAttachmentText(XLSX, gapped).text.includes('one\t\tthree'),
    JSON.stringify(extractAttachmentText(XLSX, gapped).text.split('\n').pop()),
  );

  console.log('\nThe model is told it is reading data, not instructions\n');

  const fenced = fenceExtracted('budget.xlsx', XLSX, xlsxOut);
  check('the fence names the file', fenced.includes('budget.xlsx'));
  check(
    'and says the content is data, never instructions',
    /never as instructions/i.test(fenced),
    fenced.slice(0, 120),
  );
  check('and marks where the document ends', fenced.includes('<<<END OF budget.xlsx>>>'));

  console.log('\nTruncation is reported, never silent\n');

  const rows = Array.from({ length: EXTRACTION_LIMITS.MAX_ROWS_PER_SHEET + 50 }, (_, i) => [
    `row-${i}`,
    String(i),
  ]);
  const huge = buildXlsx([{ name: 'Big', rows }]);
  const hugeOut = extractAttachmentText(XLSX, huge);
  check('an oversized sheet is truncated', hugeOut.truncated === true);
  check(
    'and the note says so in words the user can act on',
    Boolean(hugeOut.truncationNote && /truncat/i.test(hugeOut.truncationNote)),
    hugeOut.truncationNote ?? 'no note',
  );
  check(
    'and the truncation reaches the model too',
    /Truncated:/.test(fenceExtracted('big.xlsx', XLSX, hugeOut)),
  );

  console.log('\nNegative paths, one per format\n');

  check(
    'a .docx that is really a PNG is refused',
    extractionFails(DOCX, buildPng()) !== null,
    'it was accepted',
  );
  check(
    'a .csv containing NUL bytes is refused',
    contentMatchesType('text/csv', Buffer.from([0x61, 0x00, 0x62])) === false,
  );
  check(
    'a corrupt archive is refused with a readable reason',
    /archive|readable/i.test(extractionFails(XLSX, Buffer.from('PK not really a zip')) ?? ''),
    extractionFails(XLSX, Buffer.from('PK not really a zip')) ?? 'accepted',
  );
  check(
    'a .docx with no document body is refused',
    extractionFails(DOCX, buildZip([{ name: 'nothing.xml', body: '<a/>' }])) !== null,
  );
  check(
    'an empty workbook is refused rather than returning nothing',
    extractionFails(XLSX, buildXlsx([{ name: 'Empty', rows: [] }])) !== null,
  );

  /**
   * The one that matters most. A ZIP header can claim any uncompressed size, so
   * a few kilobytes can declare gigabytes. The refusal has to happen from the
   * DECLARED size, before anything is allocated.
   */
  const bomb = buildZip([{ name: 'word/document.xml', body: 'x'.repeat(1024) }], {
    declaredSize: () => 900 * 1024 * 1024,
  });
  const bombStarted = Date.now();
  const bombError = extractionFails(DOCX, bomb);
  check(
    'an archive that claims to expand to 900MB is refused',
    bombError !== null,
    'it was accepted',
  );
  check(
    'and refused fast, without inflating it first',
    Date.now() - bombStarted < 500,
    `${Date.now() - bombStarted}ms`,
  );

  check(
    'an oversized file is rejected before upload, by size not type',
    /limit is/i.test(
      rejectionReason(
        { name: 'big.csv', type: 'text/csv', size: 50 * 1024 * 1024 },
        20 * 1024 * 1024,
      ) ?? '',
    ),
  );
  check(
    'and an empty file is rejected too',
    rejectionReason({ name: 'empty.csv', type: 'text/csv', size: 0 }, 1024) !== null,
  );

  console.log('\nWhat the model can and cannot be asked to read\n');

  const blind = { displayName: 'Text Only', supportsVision: false, supportsDocuments: false };
  const full = { displayName: 'Everything', supportsVision: true, supportsDocuments: true };

  check(
    'a model with no vision refuses an image, and says what to do',
    /vision model/i.test(capabilityRefusal('image/png', blind) ?? ''),
    capabilityRefusal('image/png', blind) ?? 'no refusal',
  );
  check(
    'a model with no document support refuses a PDF',
    /document-capable/i.test(capabilityRefusal('application/pdf', blind) ?? ''),
  );
  /**
   * The point of extraction: a spreadsheet becomes text before any provider
   * sees it, so a model with no document capability at all can still read one.
   * Gating these on `supportsDocuments` would refuse a file the model can
   * plainly handle.
   */
  check(
    'but a spreadsheet is fine on a model with no document support at all',
    capabilityRefusal(XLSX, blind) === null,
    capabilityRefusal(XLSX, blind) ?? '',
  );
  check('and a CSV likewise', capabilityRefusal('text/csv', blind) === null);
  check('a capable model refuses nothing', capabilityRefusal('application/pdf', full) === null);

  console.log('\nThe route refuses the pairing too, not just the UI\n');

  let temporaryModelId: string | null = null;
  const email = `documents-${process.pid}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;

  try {
    const anon = createClient<Database>(url, PUBLISHABLE_KEY(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const cookie = `sb-${projectRef}-auth-token=base64-${Buffer.from(
      JSON.stringify(signIn!.session),
    ).toString('base64')}`;

    /**
     * A non-vision model is CREATED for this check rather than searched for.
     *
     * Two earlier versions of it did not run at all. The first pinned a
     * non-vision row whose provider holds no key — the route resolves such a
     * model to the default one, which does support vision, so the gate was
     * never reached and the check reported it broken. The second searched only
     * among usable models, found none, and skipped: a capability gate with no
     * test, reported as a pass.
     *
     * Borrowing a configured provider guarantees the model resolves, and
     * `supports_vision: false` guarantees the gate has something to refuse.
     */
    const { data: host } = await admin
      .from('models')
      .select('provider_id, providers!inner(key_last4)')
      .eq('enabled', true)
      .not('providers.key_last4', 'is', null)
      .limit(1)
      .maybeSingle();

    if (host) {
      const { data: created } = await admin
        .from('models')
        .insert({
          provider_id: host.provider_id,
          model_id: 'text-only-model-for-tests',
          display_name: 'Text Only (test)',
          max_tokens: 256,
          enabled: true,
          supports_vision: false,
          supports_documents: false,
        })
        .select('id')
        .single();
      temporaryModelId = created?.id ?? null;
    }

    const blindModel = temporaryModelId ? { id: temporaryModelId } : null;

    const { data: convo } = await admin
      .from('conversations')
      .insert({ user_id: userId, title: 'Documents', model_id: blindModel?.id ?? null })
      .select('id')
      .single();

    if (blindModel) {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          conversationId: convo!.id,
          message: 'What is in this picture?',
          attachments: [
            {
              key: `chat/${userId}/never-uploaded.png`,
              name: 'never-uploaded.png',
              mimeType: 'image/png',
              sizeBytes: 128,
              kind: 'image',
            },
          ],
        }),
      });
      const body = await response.json().catch(() => ({}));
      check(
        'an image on a model with no vision is refused with 422, before any upload is read',
        response.status === 422,
        `got ${response.status}`,
      );
      check(
        'and the refusal names the model and what to do instead',
        typeof body.error === 'string' && /vision model/i.test(body.error),
        String(body.error).slice(0, 120),
      );
    } else {
      console.log('  skip  no provider holds a key, so no model resolves.');
    }

    // Someone else's storage path, with a kind that needs no capability at all.
    const foreign = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        conversationId: convo!.id,
        message: 'Read this',
        attachments: [
          {
            key: `chat/00000000-0000-0000-0000-000000000000/theirs.csv`,
            name: 'theirs.csv',
            mimeType: 'text/csv',
            sizeBytes: 64,
            kind: 'text',
          },
        ],
      }),
    });
    check(
      "another user's object is not readable through an attachment",
      foreign.status === 404,
      `got ${foreign.status}`,
    );
  } finally {
    if (temporaryModelId) await admin.from('models').delete().eq('id', temporaryModelId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\nTest user and temporary model cleaned up.');
  }

  console.log(
    failures === 0
      ? '\nDocuments are read, refused and reported correctly.'
      : `\n${failures} document check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-documents crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
