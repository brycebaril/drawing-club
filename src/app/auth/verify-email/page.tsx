const MESSAGES: Record<string, string> = {
  verified: "Your email is verified. You can now book sessions and buy tickets.",
  "already-used": "This verification link has already been used.",
  expired: "This verification link has expired. Request a new one from your account settings.",
  invalid: "This verification link is invalid.",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const message = MESSAGES[status ?? ""] ?? MESSAGES.invalid;

  return (
    <main>
      <h1>Email verification</h1>
      <p>{message}</p>
      <p>
        <a href="/dashboard">Go to dashboard</a>
      </p>
    </main>
  );
}
