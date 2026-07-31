# Contributing

Thanks for looking. This is a single-maintainer project, so the process below is
short — but `main` is protected and the rules are enforced by CI rather than by
trust, so it is worth reading before you push.

## The one thing that will surprise you

**`main` rejects direct pushes.** Including the maintainer's.

```
$ git push origin main
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - 2 of 2 required status checks are expected.
```

That is working correctly, not broken. Every change goes through a pull request
with CI green. See [DEC-016](docs/wiki/DECISIONS.md) for why administrators are
bound by it too.

## Getting set up

```bash
git clone https://github.com/MyChat99/myaichat.git
cd myaichat
npm install
cp .env.example .env.local     # fill in your own Supabase project
npm run dev
```

You need your own Supabase project. Four variables get you booting; the rest are
documented in [.env.example](.env.example) and listed in the
[README](README.md#environment).

## The loop

```bash
git checkout -b <type>/<short-name>       # feat/ fix/ chore/ docs/ ci/

# ... work ...

npm run lint && npm run type-check && npm run format:check && npm run build
git push -u origin <branch>
gh pr create --base main
```

Then wait for CI and merge. Squash merges only — `main` stays one commit per
change.

## What CI checks

Two jobs **block** the merge:

| Job | Runs |
| --- | --- |
| `Lint, type-check, build` | eslint, `tsc --noEmit`, prettier, and a build **with no secrets in the environment** |
| `Tests (credential-free)` | the suites that need no database and no network |

Two more **report without blocking** — dependency advisories and the security
audit. They are advisory because the advisories are transitive under `next` and
cannot clear without downgrading the framework
([ISSUE-006](docs/wiki/ISSUES.md)); a check that can never go green is a check
people stop reading.

**The build runs with an empty environment on purpose.** Env parsing is lazy so
that a build never needs runtime config, and that job is what keeps it true — a
build that needs credentials is a build that breaks on every fresh deploy
([ISSUE-014](docs/wiki/ISSUES.md)).

## Running the full suite

There is no test framework. Every check is a script against the real database,
the real running server, or the real source.

```bash
npm run dev            # six of the suites need a server

npm run verify:authz         # no route or action shipped without an auth gate
npm run verify:api           # every route refuses bad input and other users
npm run verify:security      # throttling, password rules, rate limits, budgets
npm run verify:session       # idle policy, refresh-token behaviour
npm run verify:theme         # WCAG AA contrast, every theme
# …plus schema, rls, seed, storage, gates, appearance, providers, admin,
#   attachments, headers, email, smoke
```

⚠️ **`verify:admin` and `verify:security` mutate shared state.** They break a
provider key or change a system setting and restore it in `finally`. Do not run
them against a database anyone else is using
([ISSUE-015](docs/wiki/ISSUES.md)).

## House rules

**Assert stored state, not response shape.** This is the one that matters. A
blocked write and a crashed write both return zero rows; an unauthenticated POST
once returned `200` with an HTML login page. If your test would pass against a
broken implementation, it is not a test. Several suites carry a comment naming
the specific bug they exist to catch — that is the format to follow.

**Adding a provider touches one file plus one registry line.** If your change
needs an edit to `app/api/chat/route.ts`, the abstraction is leaking, and
`npm run verify:providers` will fail the build on it. See
[lib/providers/README.md](lib/providers/README.md).

**`lib/db/types.ts` is hand-maintained.** `supabase gen types` needs Docker,
which this project deliberately avoids ([DEC-004](docs/wiki/DECISIONS.md)).
Change a migration, update that file in the same commit, or type-check breaks.

**Migrations are additive and committed.** New file, never an edit to an applied
one. Nobody re-runs history.

**Never weaken a rule in [CLAUDE.md](CLAUDE.md) for convenience.** If a rule is
genuinely wrong, change the rule in its own PR with the reasoning, rather than
routing around it in a feature PR.

## Commits

Conventional commits — `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`.

Write the body for whoever reads it in six months without the context. The
convention here is to say **what was wrong and why the fix is shaped this way**,
not to restate the diff:

> `fix(chat): send the model the newest messages, not the oldest`
>
> `ORDER BY ASC with a LIMIT returns the OLDEST forty rows, so once a`
> `conversation passed forty messages the model never saw the question just`
> `asked. Nothing errored — the assistant just appeared to lose the thread,`
> `which reads as a model limitation rather than our bug.`

## The wiki is not optional

`docs/wiki/` is the source of truth for project state, and it is expected to
move with the code:

| File | What goes in it |
| --- | --- |
| [PROGRESS.md](docs/wiki/PROGRESS.md) | Phase status. `Done` means built; `Verified` means every acceptance criterion proved |
| [ISSUES.md](docs/wiki/ISSUES.md) | Bugs, blockers, debt. Newest at the top |
| [DECISIONS.md](docs/wiki/DECISIONS.md) | Anything non-obvious, **with the argument against it stated** |
| [ROADMAP.md](docs/wiki/ROADMAP.md) | Pending and future work |

If a PR fixes a bug, resolve its issue in the same PR. An issue log that lags
reality is worse than none — the next person plans around a blocker that no
longer exists.

## Reporting a security problem

Please do not open a public issue. [SECURITY.md](SECURITY.md) has the contact
route, and documents the known gaps rather than pretending there are none.

## Where to start

- [SHOWCASE.md](docs/SHOWCASE.md) — what this is and how it holds together
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — diagrams, and the request paths
- [PROGRESS.md](docs/wiki/PROGRESS.md) — the resume block at the top is the
  current state in one screen
