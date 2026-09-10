import nodemailer from "nodemailer";
import { Resend } from "resend";
import { config } from "../config.js";

export type OutgoingEmail = {
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachment?: { filename: string; content: Buffer };
};

export class ProviderFailure extends Error {
  constructor(public readonly kind: "transient" | "permanent" | "ambiguous", message: string) {
    super(message);
  }
}

export interface EmailProvider {
  readonly name: "smtp" | "resend";
  send(message: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

class SmtpProvider implements EmailProvider {
  readonly name = "smtp" as const;
  private readonly transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER && config.SMTP_PASSWORD ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000
  });

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    try {
      const result = await this.transport.sendMail({
        from: config.EMAIL_FROM,
        to: message.to,
        replyTo: config.MONITORED_REPLY_TO,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: { "X-Veridian-Job": message.idempotencyKey },
        attachments: message.attachment ? [{ filename: message.attachment.filename, content: message.attachment.content, contentType: "application/pdf" }] : undefined
      });
      return { providerMessageId: result.messageId };
    } catch (error) {
      const item = error as { responseCode?: number; code?: string; message?: string };
      if (item.responseCode && item.responseCode >= 500) throw new ProviderFailure("permanent", item.message ?? "SMTP rejected message");
      if (["ETIMEDOUT", "ECONNRESET", "ESOCKET"].includes(item.code ?? "")) throw new ProviderFailure("ambiguous", item.message ?? "SMTP result unknown");
      throw new ProviderFailure("transient", item.message ?? "SMTP temporarily unavailable");
    }
  }
}

class ResendProvider implements EmailProvider {
  readonly name = "resend" as const;
  private readonly client = new Resend(config.RESEND_API_KEY);

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const { data, error } = await this.client.emails.send({
      from: config.EMAIL_FROM,
      to: [message.to],
      replyTo: config.MONITORED_REPLY_TO,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.attachment ? { attachments: [{ filename: message.attachment.filename, content: message.attachment.content }] } : {})
    }, { idempotencyKey: message.idempotencyKey });
    if (error) {
      const status = "statusCode" in error ? Number(error.statusCode) : 500;
      throw new ProviderFailure(status >= 400 && status < 500 && status !== 429 ? "permanent" : "transient", error.message);
    }
    if (!data?.id) throw new ProviderFailure("ambiguous", "Resend returned no message identifier");
    return { providerMessageId: data.id };
  }
}

export function createEmailProvider(): EmailProvider {
  return config.EMAIL_PROVIDER === "resend" ? new ResendProvider() : new SmtpProvider();
}
