import { requireUser } from '@/lib/security/auth';

export default async function ChatPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">
        Welcome{user.displayName ? `, ${user.displayName}` : ''}
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        You are signed in. The chat interface arrives in Phase 2 — this shell exists so Phase 1 can
        prove auth, the schema, and RLS end to end.
      </p>
    </div>
  );
}
