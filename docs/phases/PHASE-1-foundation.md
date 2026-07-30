# Phase 1 — Project Scaffold, Auth, Database Schema & RLS

## Goal
A running Next.js app where users can sign up, log in, and see an empty authenticated shell. Complete database schema with RLS in place.

## Prerequisites
- Supabase project created; `SUPABASE_URL`, anon key, service-role key available
- Node 18+ installed; empty GitHub repo cloned locally

## Tasks
1. Scaffold Next.js 14+ (App Router) with TypeScript strict mode, Tailwind CSS, ESLint, Prettier. Install shadcn/ui, Framer Motion, Lucide, Zod, sonner.
2. Create directory layout: /app, /components, /lib/db, /lib/security, /lib/providers, /lib/r2, /emails.
3. Set up Supabase CLI in the repo. Write SQL migrations for ALL tables in the master spec: profiles, providers, models, conversations, messages, user_preferences, usage_logs, audit_logs, system_settings — with indexes.
4. Write RLS policies for every table: users see only their own conversations/messages/preferences; providers/models readable (non-secret columns) by authenticated users, writable by admin only; audit_logs and usage_logs admin-read, system-write.
5. Implement Supabase Auth: email/password sign-up, login, logout, session handling via middleware. A trigger creates a `profiles` row (role = 'user') on sign-up.
6. Protected route group for the app shell; redirect unauthenticated users to /login. Placeholder pages: /(chat root) and /admin (admin role check, can be an empty page for now).
7. Create `.env.example` listing every env var the project will need (Supabase, R2, Resend, encryption master key, app URL) with comments.
8. Seed script: creates an admin user and default system_settings rows.

## Acceptance criteria
- `npm run dev` works; sign up → email/password login → authenticated shell
- `supabase db reset` applies all migrations cleanly
- RLS verified: user A cannot query user B's rows (write a small test or document manual verification)
- Non-admin visiting /admin is redirected
- lint + type-check + build all pass

## Out of scope
No chat functionality, no LLM calls, no theming, no email sending yet.
