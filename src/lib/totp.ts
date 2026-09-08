import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { vaultDecrypt, vaultEncrypt } from "./crypto";

const ISSUER = "Homelab Panel";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function encryptTotpSecret(secret: string): string {
  return vaultEncrypt(secret);
}

export function decryptTotpSecret(encrypted: string): string {
  return vaultDecrypt(encrypted);
}

export async function buildOtpAuthQrDataUrl(username: string, secretBase32: string): Promise<string> {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return QRCode.toDataURL(totp.toString());
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  // allow 1 step of clock drift each way
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
