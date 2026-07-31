# Phase 6 — the moment credentials land

Everything in Phase 6 is built except the two steps that need an account:
the PUT to Cloudflare R2, and the send through Resend. This is the exact
sequence to finish it, in order, with the traps written down.

**Nothing here needs code.** If a step below asks you to change a file, that
is a bug in this document.

---

## Part A — Cloudflare R2

### A1. Create the bucket

Cloudflare dashboard → **R2 Object Storage** → *Create bucket*.

| Setting | Value | Why |
| --- | --- | --- |
| Name | `myaichat` | Must match `R2_BUCKET_NAME` exactly, including case |
| Location | Automatic | R2 has no egress fees, so region matters less than usual |
| **Public access** | **Disabled** | ⚠️ The single most important setting on this page |

> **Public access must stay off.** Every read in this app goes through
> `/api/uploads/download`, which checks that the object key belongs to the
> calling user before issuing a short-lived signed URL. A public bucket makes
> that check decorative — object keys are guessable enough that "nobody knows
> the URL" is not access control. `verify:storage` proves the ownership check
> works; it cannot prove the bucket is private. **Only you can check that.**

### A2. Create an API token

R2 → **Manage R2 API Tokens** → *Create API token*.

| Setting | Value |
| --- | --- |
| Permissions | **Object Read & Write** — not Admin Read & Write |
| Specify bucket | **Apply to specific buckets only** → `myaichat` |
| TTL | Leave as forever, or set a reminder to rotate |

Scoping to one bucket matters: a token that can reach every bucket in the
account is a token whose blast radius is the whole account. This app needs
exactly one bucket.

You get three values. **Copy them now — the secret is shown once.**

### A3. CORS — the step that silently breaks uploads

The browser PUTs straight to R2, so R2 must accept a cross-origin PUT from
your app's origin. Without this the upload fails with an opaque network error
and no useful console message.

R2 → your bucket → **Settings** → *CORS policy* → paste:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://myaichat-production.up.railway.app"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Three traps in that block:

1. **`AllowedHeaders` must include `content-type`.** The presign signs the
   content type, and `lib/upload/client.ts` sends it on the PUT. If R2 is not
   told to accept that header, the preflight fails before the upload starts.
2. **No trailing slash on origins.** `https://example.com/` does not match
   `https://example.com`.
3. **`http` for localhost, `https` for production.** A single wrong scheme
   means it works in one environment and not the other, which reads as a code
   bug for an hour before anyone re-reads this list.

Add your custom domain here too if you point one at Railway later.

### A4. Environment variables

`.env.local` for development, **and** Railway → Variables for production.
Both. Setting only one is the most common way this half-works.

```
R2_ACCOUNT_ID=            # Cloudflare dashboard → R2 → Account ID (right sidebar)
R2_ACCESS_KEY_ID=         # from the API token in A2
R2_SECRET_ACCESS_KEY=     # from the API token in A2 — shown once
R2_BUCKET_NAME=myaichat   # must match A1 exactly
```

`isStorageConfigured()` in `lib/r2/storage.ts` returns true only when **all
four** are present. Three out of four leaves the paperclip disabled with no
error anywhere — if the button stays greyed out, a variable is missing or
misspelled.

### A5. Verify, in this order

```bash
# 1. The app now believes storage exists
npm run dev
#    → open a chat. The paperclip should be enabled, not greyed out.

# 2. Rejection paths still reject (these already pass today)
npm run verify:storage
npm run verify:attachments

# 3. The round trip that could not be tested before
#    Attach a PNG, send, and confirm:
#    · the chip shows a thumbnail and a size, not "Uploading…" forever
#    · the message sends
#    · the image is visible in the R2 dashboard under chat/<your-user-id>/
```

Then the checks that only a human can do:

- [ ] **Open the bucket URL directly in a private window.** It must 401/403.
      If the file loads, public access is on — go back to A1.
- [ ] **Attach a 30MB file.** It must be rejected client-side, instantly,
      before any network request.
- [ ] **Attach a `.exe`.** Rejected, with a message naming the accepted formats.
- [ ] **Drag a file onto the composer.** The drop overlay appears; dropping
      attaches it.
- [ ] **Paste a screenshot** (`⌘⇧4` then `⌘V`). It attaches.
- [ ] **Remove a file before sending.** The chip disappears and the message
      sends without it.
- [ ] **Sign in as a second user** and try `/api/uploads/download?key=<the
      first user's key>`. Must 403. This is the check that proves a private
      bucket plus an ownership check actually composes.

---

## Part B — Resend

### B1. Get a key

[resend.com](https://resend.com) → **API Keys** → *Create*. Permission
**Sending access** is enough; full access is not needed.

### B2. The test-mode trap — read this before debugging anything

**Without a verified domain, Resend will only deliver to the email address
that owns the Resend account.** Sending to any other address returns a
`403` with a message about domain verification.

This produces a specific, confusing failure: *your own* test emails arrive
perfectly, and every real user's silently do not. It looks like a bug in the
app. It is not.

So there are two working configurations:

| | From address | Delivers to | Good for |
| --- | --- | --- | --- |
| **Unverified** | `onboarding@resend.dev` | only your own account email | local development, today |
| **Verified** | `noreply@yourdomain.com` | anyone | production, and required before real signups |

To verify a domain: Resend → **Domains** → *Add domain* → add the DKIM,
SPF and DMARC records it gives you at your DNS provider. Propagation is
usually minutes, occasionally hours.

You do not own a domain yet (per ISSUE-003), so **start unverified** and treat
production email as still blocked until a domain exists.

### B3. Environment variables

```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=onboarding@resend.dev    # until a domain is verified
NEXT_PUBLIC_APP_URL=http://localhost:3000  # links in emails are built from this
```

⚠️ `NEXT_PUBLIC_APP_URL` must be the **production** URL in Railway. If it is
left as localhost there, every password-reset link you email to a real user
points at their own machine.

### B4. Verify

```bash
npm run verify:email     # templates render + contrast (passes today, no key needed)
```

Then, with a key present, send one of each to yourself and check on a phone as
well as a desktop — the templates are table-based for Outlook, and that is
exactly the kind of thing that looks fine in one client and broken in another.

- [ ] Welcome email renders, links work, `NEXT_PUBLIC_APP_URL` is correct
- [ ] Password reset renders and the link actually resets
- [ ] Both are legible in dark mode (several clients invert backgrounds)

### B5. Supabase auth emails — a dashboard change, not code (ISSUE-017)

Supabase sends confirmation and reset emails through **its own** SMTP by
default, not through Resend. To route them through Resend:

Supabase → **Project Settings** → *Authentication* → **SMTP Settings**:

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your `re_…` API key |
| Sender email | must match `RESEND_FROM_EMAIL` |

Until this is done, users get Supabase's default template while the app's
branded ones sit unused. That is cosmetic, not broken — but it is why the two
sets of emails look different.

---

## Part C — Close it out

Once both parts pass:

```bash
npm run lint && npm run type-check && npm run build
npm run verify:storage && npm run verify:attachments && npm run verify:email
npm run smoke                    # local
npm run smoke -- --url https://myaichat-production.up.railway.app
```

Then update the wiki in the same sitting, while it is fresh:

- `PROGRESS.md` — Phase 6 from **Partial** to **Done**, and to **Verified**
  only once every box above is ticked. "Done" means built; "Verified" means
  proven.
- `ISSUES.md` — resolve **ISSUE-016** (R2), **ISSUE-017** (Resend/SMTP), and
  the R2/Resend half of **ISSUE-003**.
- `DECISIONS.md` — log the from-address decision and whether the domain was
  verified, because six months from now "why does this send from resend.dev"
  will be a real question.

---

## What is already done, so you do not redo it

| Piece | State |
| --- | --- |
| Presign route with auth, suspension, rate limit, type and size checks | Built, tested (`verify:storage`) |
| Download route with per-user key ownership check | Built, tested |
| AES-signed short-lived URLs (5 min up, 10 min down) | Built |
| Composer UI — picker, drag-drop, paste, previews, remove, disabled state | Built, tested (`verify:attachments`) |
| Client + server sharing ONE accepted-type table | Built — `lib/upload/types.ts` |
| Attachments passed to vision-capable models | Built in `/api/chat` |
| Avatar upload on the profile page | Built |
| React Email templates + contrast checks | Built, tested (`verify:email`) |

The only untested path in the whole phase is the PUT itself, and that is
untestable by definition until A4 is done.
