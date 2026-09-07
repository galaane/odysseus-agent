import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright-core';
import {
  base32Decode,
  generateTotp,
  getRemainingTotpSeconds,
  verifyTotp,
} from '../../src/credentials/TotpGenerator.js';
import { CredentialInjector } from '../../src/credentials/CredentialInjector.js';

describe('TotpGenerator Subsystem (RFC 6238)', () => {
  // Standard RFC 6238 / RFC 4226 Test Vector Secret: "12345678901234567890"
  // Base32 representation: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  describe('base32Decode', () => {
    it('should correctly decode RFC 3548 / 4648 test string', () => {
      // "JBSWY3DPEHPK3PXP" is Base32 for "Hello!\xde\xad\xbe\xef"
      const decoded = base32Decode('JBSWY3DPEHPK3PXP');
      expect(decoded.length).toBe(10);
      expect(decoded.toString('utf8', 0, 6)).toBe('Hello!');
    });

    it('should ignore spaces and handle lowercase strings', () => {
      const decodedLower = base32Decode('jbsw y3dp ehpk 3pxp');
      const decodedUpper = base32Decode('JBSWY3DPEHPK3PXP');
      expect(decodedLower).toEqual(decodedUpper);
    });

    it('should throw Error on invalid characters', () => {
      expect(() => base32Decode('INVALID_CHARS!@#')).toThrowError('Invalid Base32 character');
    });
  });

  describe('generateTotp', () => {
    it('should match RFC 6238 standard test vectors at specific timestamps', () => {
      // RFC 6238 test vectors for SHA-1 (T0 = 0, Period = 30)
      // Timestamp: 59s -> Time step: 1 -> Expected: 287082
      const code1 = generateTotp(rfcSecret, 59 * 1000);
      expect(code1).toBe('287082');

      // Timestamp: 1111111109s -> Time step: 37037036 -> Expected: 081804
      const code2 = generateTotp(rfcSecret, 1111111109 * 1000);
      expect(code2).toBe('081804');

      // Timestamp: 1111111111s -> Time step: 37037037 -> Expected: 050471
      const code3 = generateTotp(rfcSecret, 1111111111 * 1000);
      expect(code3).toBe('050471');

      // Timestamp: 1234567890s -> Time step: 41152263 -> Expected: 005924
      const code4 = generateTotp(rfcSecret, 1234567890 * 1000);
      expect(code4).toBe('005924');
    });

    it('should generate valid 6-digit numeric string for user key', () => {
      const userKey = 'ndj4 svqk behu svyr 6jcc yqud weby x5tq';
      const code = generateTotp(userKey);
      expect(code).toMatch(/^\d{6}$/);
    });

    it('should calculate remaining seconds within 1 to 30', () => {
      const remaining = getRemainingTotpSeconds(30, 45 * 1000);
      expect(remaining).toBe(15);
    });
  });

  describe('verifyTotp', () => {
    it('should verify matching code for current timestamp', () => {
      const now = Date.now();
      const code = generateTotp(rfcSecret, now);
      expect(verifyTotp(code, rfcSecret, now)).toBe(true);
    });

    it('should accept code from adjacent window (+-1 step)', () => {
      const now = 1000000;
      const prevStepCode = generateTotp(rfcSecret, now - 30000);
      expect(verifyTotp(prevStepCode, rfcSecret, now, 1)).toBe(true);

      const nextStepCode = generateTotp(rfcSecret, now + 30000);
      expect(verifyTotp(nextStepCode, rfcSecret, now, 1)).toBe(true);
    });

    it('should reject invalid or out-of-window codes', () => {
      const now = 1000000;
      expect(verifyTotp('999999', rfcSecret, now, 1)).toBe(false);
      const farCode = generateTotp(rfcSecret, now - 120000);
      expect(verifyTotp(farCode, rfcSecret, now, 1)).toBe(false);
    });
  });

  describe('CredentialInjector.injectTotp', () => {
    it('should fill generated code into DOM input directly', async () => {
      const mockFill = vi.fn(async () => {});
      const mockPage = {
        locator: vi.fn(() => ({
          first: vi.fn(() => ({
            fill: mockFill,
          })),
        })),
      } as unknown as Page;

      const code = await CredentialInjector.injectTotp(mockPage, '#totpPin', rfcSecret);

      expect(code).toMatch(/^\d{6}$/);
      expect(mockPage.locator).toHaveBeenCalledWith('#totpPin');
      expect(mockFill).toHaveBeenCalledWith(code);
    });
  });
});
