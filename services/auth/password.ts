import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt parameters (memory-hard KDF, built into Node — no native deps).
const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Hash a password as `scrypt$N$r$p$salt$hash` (all hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${dk.toString("hex")}`;
}

/** Constant-time verify against a stored `scrypt$...` string. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex!, "hex");
  const dk = scryptSync(password, Buffer.from(saltHex!, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}
