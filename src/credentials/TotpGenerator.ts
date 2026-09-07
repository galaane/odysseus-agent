import crypto from 'node:crypto';

/**
 * Decodes a Base32 encoded string into a Buffer.
 * Supports standard RFC 4648 Base32 alphabet (A-Z, 2-7).
 */
export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/[\s=-]/g, '').toUpperCase();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array(Math.floor((clean.length * 5) / 8));

  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) {
      throw new Error(`Invalid Base32 character encountered: "${clean[i]}"`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }

  return Buffer.from(output.buffer, 0, index);
}

/**
 * Generates a standard RFC 6238 TOTP 6-digit code.
 *
 * @param secret - Base32 encoded secret key (e.g. 16, 26, or 32 characters)
 * @param timestampMs - Unix epoch timestamp in milliseconds (defaults to Date.now())
 * @param digits - Number of output digits (defaults to 6)
 * @param periodSeconds - Time step window in seconds (defaults to 30)
 */
export function generateTotp(
  secret: string,
  timestampMs: number = Date.now(),
  digits: number = 6,
  periodSeconds: number = 30
): string {
  const key = base32Decode(secret);
  const epochSeconds = Math.floor(timestampMs / 1000);
  const counter = Math.floor(epochSeconds / periodSeconds);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const modulo = Math.pow(10, digits);
  return (binaryCode % modulo).toString().padStart(digits, '0');
}

/**
 * Calculates remaining validity seconds for the current TOTP window.
 */
export function getRemainingTotpSeconds(
  periodSeconds: number = 30,
  timestampMs: number = Date.now()
): number {
  const epochSeconds = Math.floor(timestampMs / 1000);
  return periodSeconds - (epochSeconds % periodSeconds);
}

/**
 * Verifies a given TOTP code against a secret key within a given window.
 */
export function verifyTotp(
  code: string,
  secret: string,
  timestampMs: number = Date.now(),
  windowSteps: number = 1,
  periodSeconds: number = 30
): boolean {
  const trimmed = code.trim();
  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const time = timestampMs + offset * periodSeconds * 1000;
    if (generateTotp(secret, time, trimmed.length, periodSeconds) === trimmed) {
      return true;
    }
  }
  return false;
}
