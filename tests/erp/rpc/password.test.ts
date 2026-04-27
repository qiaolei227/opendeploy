import { describe, expect, it } from 'vitest';
import {
  obfuscatePassword,
  deobfuscatePassword,
  cipherPasswordForLogin,
} from '../../../src/main/erp/k3cloud/rpc/password';

describe('rpc/password', () => {
  describe('obfuscatePassword (single-arg CipherText)', () => {
    it('encodes "*" to "丠伊" — matches the captured frmCloudLogin payload', () => {
      // Captured 2026-04-27 REQ #11 ValidateLoginInfo:
      //   "Password":"丠伊丠伊丠伊丠伊丠伊丠伊"  (= obfuscated "******")
      expect(obfuscatePassword('*')).toBe('丠伊');
      expect(obfuscatePassword('******')).toBe('丠伊丠伊丠伊丠伊丠伊丠伊');
    });

    it('encodes empty / nullish input as itself', () => {
      expect(obfuscatePassword('')).toBe('');
    });

    it('encodes ASCII alphanumerics deterministically', () => {
      const out = obfuscatePassword('A');
      // 'A' = U+0041 → 0x00, 0x41 → output 0x4E,0x40,0x4F,0x01
      // BE bytes [0x4E,0x40,0x4F,0x01] decoded as BE-UTF-16:
      //   first 2 bytes = U+4E40, second 2 bytes = U+4F01
      expect(out).toBe('乀企');
      expect(out.length).toBe(2);
    });

    it('output length is always 2x input length (each char becomes 2 chars)', () => {
      expect(obfuscatePassword('').length).toBe(0);
      expect(obfuscatePassword('a').length).toBe(2);
      expect(obfuscatePassword('hello').length).toBe(10);
      expect(obfuscatePassword('密码123!').length).toBe(12);
    });
  });

  describe('deobfuscatePassword', () => {
    it('inverts obfuscatePassword for round-trip', () => {
      const samples = ['', '*', '******', 'p@ssw0rd', '密码', 'A1b2C3', 'demo123!'];
      for (const s of samples) {
        expect(deobfuscatePassword(obfuscatePassword(s))).toBe(s);
      }
    });

    it('decodes "丠伊" back to "*"', () => {
      expect(deobfuscatePassword('丠伊')).toBe('*');
      expect(deobfuscatePassword('丠伊丠伊丠伊丠伊丠伊丠伊')).toBe('******');
    });
  });

  describe('cipherPasswordForLogin', () => {
    it('falls back to obfuscation when public key is empty (server pwd-encryption disabled)', () => {
      // Matches BOS Designer behavior captured in REQ #10 — GetPublicKeyInfo
      // returned empty, so frmCloudLogin's UserServiceProxy.ValidateUser took
      // the single-arg CipherText path.
      expect(cipherPasswordForLogin('******', '')).toBe('丠伊丠伊丠伊丠伊丠伊丠伊');
    });
  });
});
