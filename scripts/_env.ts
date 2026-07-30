import { config } from 'dotenv';

/** Scripts run outside Next.js, so .env.local is not loaded for them automatically. */
config({ path: '.env.local', quiet: true });

export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Set it in .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

export const SUPABASE_URL = () => required('NEXT_PUBLIC_SUPABASE_URL');
export const PUBLISHABLE_KEY = () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const SECRET_KEY = () => required('SUPABASE_SERVICE_ROLE_KEY');
