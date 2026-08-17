import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Email delivery abstraction (docs/ArchitectureDocument.md §3, §5). Falls
 * back to a console-logged dev email whenever AWS_REGION/SES_FROM_EMAIL
 * aren't set — deliberately not an eager throw like src/lib/stripe/client.ts's
 * key check, since sendEmail fires on nearly every ordinary local dev action
 * (registration, cancellation, gifting), unlike Stripe which most local
 * browsing never touches. Staging/prod always have both vars set via
 * Secrets Manager, so the fallback never masks a real misconfiguration there.
 *
 * SES starts every new AWS account in a sending sandbox — it can only
 * deliver to individually pre-verified recipient addresses until AWS
 * approves a production-access request (an external, multi-day review).
 * That's an account-level constraint no code here can work around.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

const sesClient = process.env.AWS_REGION ? new SESv2Client({ region: process.env.AWS_REGION }) : null;

function logDevEmail(message: EmailMessage): void {
  console.log(
    [
      "---- dev email ----",
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "",
      message.body,
      "--------------------",
    ].join("\n"),
  );
}

/**
 * Never throws — every call site except src/lib/ops/payouts.ts (which
 * already wraps it defensively, per-recipient) calls this unguarded,
 * assuming delivery can't fail. A real SES error (throttling, an
 * unverified sandbox recipient, a network blip) is logged via
 * console.error (CloudWatch picks it up automatically in production, per
 * ArchitectureDocument §12's observability baseline) rather than blocking
 * or rolling back whatever operation triggered the email.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const fromEmail = process.env.SES_FROM_EMAIL;
  if (!sesClient || !fromEmail) {
    logDevEmail(message);
    return;
  }

  try {
    await sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: fromEmail,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: { Text: { Data: message.body } },
          },
        },
      }),
    );
  } catch (error) {
    console.error(`Failed to send email to ${message.to}:`, error);
  }
}
