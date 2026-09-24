import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getOrCreateMfaSecret } from "@/lib/auth/mfaEnrollment";
import { buildOtpauthUrl, generateQrCodeDataUrl } from "@/lib/auth/totp";
import { MfaSetupForm } from "./MfaSetupForm";

export default async function MfaSetupPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/login?redirect=/auth/mfa-setup");
  }

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");
  if (ctx.mfaEnabled) redirect("/dashboard");

  const secret = await getOrCreateMfaSecret(ctx.id);
  const otpauthUrl = buildOtpauthUrl(ctx.username, secret);
  const qrDataUrl = await generateQrCodeDataUrl(otpauthUrl);

  return (
    <main>
      <h1>Set up two-factor authentication</h1>
      <p>
        {ctx.mfaRequired
          ? `Your role (${ctx.roles.join(", ")}) requires multi-factor authentication before you can continue (docs/SecurityDocument.md §2).`
          : "Add an extra layer of security to your account with an authenticator app."}
      </p>
      <p>Scan this QR code with an authenticator app (e.g. Google Authenticator, 1Password):</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URI, not an optimizable asset */}
      <img src={qrDataUrl} alt="TOTP enrollment QR code" width={200} height={200} />
      <p>
        Can&apos;t scan? Enter this code manually: <code>{secret}</code>
      </p>
      <MfaSetupForm />
    </main>
  );
}
