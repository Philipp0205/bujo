import { resendMailer, type Mailer } from "../app-kit/mailer.ts";

/** Resend when RESEND_API_KEY and MAIL_FROM are both set. Otherwise undefined: email is off. */
export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (apiKey && from) return resendMailer({ apiKey, from });
  console.warn("email is off (set RESEND_API_KEY and MAIL_FROM): confirm and lost-code links are not sent");
  return undefined;
}
