# Phase 8 — CI/CD, Railway Deployment & Documentation

## Goal
Merges to main auto-deploy a healthy production app on Railway; the repo is fully documented.

## Tasks
1. GitHub Actions workflow: on PR → lint, type-check, test, build. On merge to main → deploy to Railway. Protect main (PRs + passing checks required).
2. Railway service linked to the GitHub repo; configure ALL env vars from .env.example; production build settings; custom domain notes.
3. `/api/health` endpoint checking app + database connectivity, used by Railway health checks.
4. Apply Supabase migrations against the production project; document the promotion process (dev → prod).
5. R2 bucket CORS locked to the production domain; verify presigned flows in production.
6. Verify Resend domain/DKIM in production; send test emails.
7. Write README.md: overview, architecture diagram (Mermaid), local setup, env var table, migration commands, deployment guide, "how to add a new AI provider" walkthrough.
8. Write SECURITY.md summarizing the security model (key encryption, RLS, rate limits, headers) and a basic incident checklist.
9. Production smoke test: sign up → verify email → chat on both providers → attach a file → change theme → admin rotates a key → analytics update. Fix anything broken.

## Acceptance criteria
- A PR with a failing type-check cannot merge; merge to main deploys automatically
- Health endpoint green on Railway; full smoke test passes in production
- A new developer can go from clone to running app using only the README
