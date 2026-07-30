import { z } from 'zod';

/** Shared input schemas. CLAUDE.md requires Zod validation on every input boundary. */

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer'); // bcrypt truncates past 72

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signUpSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(60).optional().or(z.literal('')),
});

/**
 * Only relative, single-slash paths are accepted, so `?next=` cannot be used
 * as an open redirect to another origin.
 */
export const redirectPathSchema = z
  .string()
  .refine((v) => v.startsWith('/') && !v.startsWith('//'), 'Invalid redirect')
  .catch('/');

export type Credentials = z.infer<typeof credentialsSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
