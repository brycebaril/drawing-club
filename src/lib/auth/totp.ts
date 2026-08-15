import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Life Drawing Society";

function buildTotp(username: string | undefined, secretBase32: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

// docs/SecurityDocument.md §2: TOTP-based MFA for Admin/Controller.
export function generateSecret(): string {
  return new Secret().base32;
}

export function buildOtpauthUrl(username: string, secretBase32: string): string {
  return buildTotp(username, secretBase32).toString();
}

export function generateQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  // window: 1 tolerates the code from the previous/next 30s step (clock drift).
  return buildTotp(undefined, secretBase32).validate({ token: code, window: 1 }) !== null;
}
