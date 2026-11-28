import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";

/** Email transaksional minimal. Mock by default: tidak mengirim apa pun tanpa SMTP. */
export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; detail: string }> {
  if (!process.env.SMTP_HOST) {
    logger.info("mail.mock", { to: input.to, subject: input.subject });
    return { sent: false, detail: "SMTP tidak dikonfigurasi; email hanya dicatat (mock)." };
  }

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "medi-bot@klinik.example",
      to: input.to,
      subject: input.subject,
      text: input.text
    });
    return { sent: true, detail: "Email terkirim." };
  } catch (error) {
    logger.error("mail.failed", { error: (error as Error).message.slice(0, 300) });
    return { sent: false, detail: "Gagal mengirim email." };
  }
}
