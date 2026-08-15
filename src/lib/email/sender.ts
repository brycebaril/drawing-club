/**
 * Email delivery abstraction (docs/ArchitectureDocument.md §3, §5). The only
 * implementation for now logs to the console — a real SES-backed
 * implementation gets swapped in here once AWS infra is provisioned, without
 * touching any call site.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
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
