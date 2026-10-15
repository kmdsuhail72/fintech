import nodemailer from 'nodemailer';
import { env } from '../config.js';
import { AuthError } from './errors.js';

export async function sendAuthEmail(to: string, subject: string, url: string): Promise<void> {
  if (!env.SMTP_URL || !env.AUTH_EMAIL_FROM) {
    if (env.NODE_ENV === 'development' && env.DEV_AUTH_TOKEN_OUTPUT) return;
    throw new AuthError(503, 'EMAIL_UNAVAILABLE', 'Authentication email delivery is unavailable');
  }

  const transport = nodemailer.createTransport(env.SMTP_URL);
  try {
    await transport.sendMail({
      from: env.AUTH_EMAIL_FROM,
      to,
      subject,
      text: `${subject}\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
    });
  } catch {
    console.error('Authentication email delivery failed');
    throw new AuthError(503, 'EMAIL_DELIVERY_FAILED', 'Authentication email delivery failed');
  }
}
