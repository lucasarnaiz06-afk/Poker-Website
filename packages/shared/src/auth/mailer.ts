import { appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

/**
 * Outgoing mail. EMAIL_TRANSPORT=console (default outside production) prints the message, including links,
 * to the server console instead of sending it. EMAIL_TRANSPORT=smtp uses EMAIL_SERVER_* / EMAIL_SERVER.
 */
export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailTransportMode = "console" | "smtp";

export function getEmailTransportMode(): EmailTransportMode {
  const configured = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();

  if (configured === "console" || configured === "smtp") {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "smtp" : "console";
}

function readOptionalPort(rawPort?: string) {
  const port = Number(rawPort);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

function decodeCredential(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Structured EMAIL_SERVER_* config, or a lenient parse of EMAIL_SERVER (handles unencoded "@" in the user). */
export function getSmtpServerConfig(): string | SMTPTransport.Options | undefined {
  if (process.env.EMAIL_SERVER_HOST) {
    const user = process.env.EMAIL_SERVER_USER;
    const pass = process.env.EMAIL_SERVER_PASSWORD;

    return {
      host: process.env.EMAIL_SERVER_HOST,
      port: readOptionalPort(process.env.EMAIL_SERVER_PORT),
      secure: process.env.EMAIL_SERVER_SECURE === "true",
      auth: user && pass ? { user, pass } : undefined,
    };
  }

  const rawServer = process.env.EMAIL_SERVER;

  if (!rawServer) {
    return undefined;
  }

  const match = rawServer.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);

  if (!match || (rawServer.match(/@/g) ?? []).length <= 1) {
    return rawServer;
  }

  const [, protocol, rest] = match as unknown as [string, string, string];
  const authSeparator = rest.lastIndexOf("@");
  const authPart = rest.slice(0, authSeparator);
  const passwordSeparator = authPart.indexOf(":");

  if (passwordSeparator < 0) {
    return rawServer;
  }

  const hostUrl = new URL(`${protocol}://${rest.slice(authSeparator + 1)}`);

  return {
    host: hostUrl.hostname,
    port: readOptionalPort(hostUrl.port),
    secure: protocol.toLowerCase() === "smtps",
    auth: {
      user: decodeCredential(authPart.slice(0, passwordSeparator)),
      pass: decodeCredential(authPart.slice(passwordSeparator + 1)),
    },
  };
}

/** True when email links can be delivered (console mode always works). */
export function isEmailDeliveryConfigured(): boolean {
  if (getEmailTransportMode() === "console") {
    return true;
  }

  return Boolean(process.env.EMAIL_FROM && getSmtpServerConfig());
}

let transporter: nodemailer.Transporter | null = null;

/**
 * Dev outbox: in console mode every message is also appended as one JSON line to this file so local tools
 * (the Playwright e2e suite) can read verification links without access to the server's stdout.
 * MAIL_OUTBOX_FILE overrides the path; "off" disables it. Never used in smtp mode.
 */
export function getDevOutboxFile(): string | null {
  const configured = process.env.MAIL_OUTBOX_FILE?.trim();
  if (configured === "off") return null;
  return configured || join(tmpdir(), "poker-platform-mail-outbox.jsonl");
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (getEmailTransportMode() === "console") {
    console.info(
      [
        "",
        "──────── [mail:console] ────────",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        "",
        message.text,
        "────────────────────────────────",
        "",
      ].join("\n"),
    );
    const outbox = getDevOutboxFile();
    if (outbox) {
      const line = JSON.stringify({ to: message.to, subject: message.subject, text: message.text, sentAt: new Date().toISOString() });
      await appendFile(outbox, `${line}\n`, { mode: 0o600 }).catch(() => undefined);
    }
    return;
  }

  const server = getSmtpServerConfig();

  if (!server || !process.env.EMAIL_FROM) {
    throw new Error("SMTP is not configured (EMAIL_FROM and EMAIL_SERVER_HOST or EMAIL_SERVER).");
  }

  transporter ??= nodemailer.createTransport(server);
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain transactional email with one call-to-action link. */
export function buildLinkEmail(options: {
  to: string;
  subject: string;
  intro: string;
  actionLabel: string;
  url: string;
  footer?: string;
}): MailMessage {
  const footer = options.footer ?? "If you didn't request this, you can ignore this email.";

  return {
    to: options.to,
    subject: options.subject,
    text: `${options.intro}\n\n${options.actionLabel}: ${options.url}\n\n${footer}\n`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
<p>${escapeHtml(options.intro)}</p>
<p><a href="${escapeHtml(options.url)}" style="display:inline-block;padding:10px 16px;background:#10b981;color:#04180f;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(options.actionLabel)}</a></p>
<p style="color:#666;font-size:13px">${escapeHtml(footer)}</p>
</div>`,
  };
}
