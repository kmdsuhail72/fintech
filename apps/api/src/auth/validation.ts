import { z } from 'zod';

const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const password = z
  .string()
  .min(12)
  .max(128)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Password must be at most 72 UTF-8 bytes',
  );

export const registerSchema = z
  .object({
    email,
    password,
    displayName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z
      .string()
      .min(1)
      .max(128)
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') <= 72,
        'Password must be at most 72 UTF-8 bytes',
      ),
  })
  .strict();

export const emailSchema = z.object({ email }).strict();
export const tokenSchema = z.object({ token: z.string().min(32).max(512) }).strict();
export const resetPasswordSchema = tokenSchema.extend({ password }).strict();

export const clientTypeSchema = z.enum(['web', 'mobile']);
