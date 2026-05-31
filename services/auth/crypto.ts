import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// AES-256-GCM at-rest encryption for stored OAuth tokens. The 32-byte key is
// derived from TOKEN_ENC_KEY via SHA-256, so any passphrase works as input.
function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Encrypt plaintext -> base64(iv | authTag | ciphertext). */
export function encryptToken(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Reverse of encryptToken. Throws on tamper (GCM auth failure). */
export function decryptToken(payload: string, secret: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** SHA-256 hex — used to store refresh tokens without keeping the raw value. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Generic aliases: the same AES-256-GCM primitive encrypts the sensitive tier
// (episode bodies, raw artifacts) at rest, not just OAuth tokens.
export const encryptText = encryptToken;
export const decryptText = decryptToken;
