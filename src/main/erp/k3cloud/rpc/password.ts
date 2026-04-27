/**
 * BOS password obfuscation + RSA encryption (used in Login flow).
 *
 * Reverse-engineered from `Kingdee.BOS.dll`:
 *   - ConfidentialDataSecurityUtil.CipherText(string)         (line 68547)
 *   - ConfidentialDataSecurityUtil.DoProclaimText(string)     (line 68576)
 *   - ConfidentialDataSecurityUtil.CipherText(string, string) (line 68599)
 *   - KDRSAUtli.EncryptForJava                                 (line 57501)
 *   - KDRSAUtli.RSAEncrypt(.., fOAEP: false)                   (line 57494)
 *
 * The obfuscation layer (single-arg `CipherText`) is NOT cryptographic —
 * it's a simple byte-nibble shuffle applied to the password to keep ASCII
 * passwords from showing up as plain text in network captures / logs.
 *
 * The encryption layer (double-arg `CipherText` + `KDRSAUtli`) is real
 * RSA with PKCS#1 v1.5 padding, X.509 SubjectPublicKeyInfo public keys
 * (a.k.a. "Java" public keys in Kingdee terminology, distinct from
 * .NET's `<RSAKeyValue>` XML format).
 */

import { publicEncrypt, constants } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Obfuscate plaintext (1 BE-UTF-16 char input → 2 BE-UTF-16 chars output).
 *
 * Algorithm (from CipherText single-arg, Kingdee.BOS.decompiled.cs:68547):
 *   For each input char, take its 2 BE-UTF-16 bytes (b1, b2):
 *     output char 1 = (0x4E, b2_hi | b1_hi >> 4)
 *     output char 2 = (0x4F, b2_lo | b1_lo << 4)
 *
 * Example: '*' (U+002A) → 0x00,0x2A → 0x4E,0x20,0x4F,0x0A → "丠伊"
 *
 * Output chars are always in CJK range (U+4E00..U+4FFF) so they read as
 * Chinese ideographs in any text viewer.
 */
export function obfuscatePassword(plaintext: string): string {
  if (!plaintext) return plaintext;
  // Encode as BE-UTF-16 (each char = 2 bytes, big-endian).
  const inBytes = Buffer.from(plaintext, 'utf16le');
  // Buffer.from(s, 'utf16le') gives little-endian; swap to BE.
  const beBytes = Buffer.alloc(inBytes.length);
  for (let i = 0; i < inBytes.length; i += 2) {
    beBytes[i] = inBytes[i + 1];
    beBytes[i + 1] = inBytes[i];
  }
  const num = beBytes.length;
  const out = Buffer.alloc(num * 2);
  for (let i = 0; i < num; i += 2) {
    const b = beBytes[i];
    const num2 = (b & 0xf0) >> 4; // hi nibble of b1, shifted to low 4 bits
    const num3 = (b & 0x0f) << 4; // lo nibble of b1, shifted to high 4 bits
    const b2 = beBytes[i + 1];
    const num4 = (b2 & 0xf0) | num2;
    const num5 = (b2 & 0x0f) | num3;
    out[i * 2] = 0x4e;
    out[i * 2 + 1] = num4;
    out[(i + 1) * 2] = 0x4f;
    out[(i + 1) * 2 + 1] = num5;
  }
  // BE → LE swap so Buffer.toString('utf16le') reads it as the right chars.
  const leOut = Buffer.alloc(out.length);
  for (let i = 0; i < out.length; i += 2) {
    leOut[i] = out[i + 1];
    leOut[i + 1] = out[i];
  }
  return leOut.toString('utf16le');
}

/**
 * Reverse of obfuscatePassword (`DoProclaimText`, line 68576).
 * Used to deobfuscate the public key returned by `GetPublicKeyInfo`
 * before passing it into the RSA primitive.
 */
export function deobfuscatePassword(cipherText: string): string {
  if (!cipherText) return cipherText;
  const inBytes = Buffer.from(cipherText, 'utf16le');
  const beBytes = Buffer.alloc(inBytes.length);
  for (let i = 0; i < inBytes.length; i += 2) {
    beBytes[i] = inBytes[i + 1];
    beBytes[i + 1] = inBytes[i];
  }
  const num = beBytes.length;
  const out = Buffer.alloc(num / 2);
  for (let i = 0; i < num; i += 4) {
    const b = beBytes[i + 1]; // (0x4E, num4)
    const b2 = beBytes[i + 3]; // (0x4F, num5)
    const num2 = (b & 0x0f) << 4;
    const num3 = b & 0xf0;
    const num4 = b2 & 0x0f;
    const num5 = (b2 & 0xf0) >> 4;
    out[i / 2] = num2 | num5;
    out[i / 2 + 1] = num3 | num4;
  }
  const leOut = Buffer.alloc(out.length);
  for (let i = 0; i < out.length; i += 2) {
    leOut[i] = out[i + 1];
    leOut[i + 1] = out[i];
  }
  return leOut.toString('utf16le');
}

/**
 * RSA-encrypt a string with a Java-style (X.509 SubjectPublicKeyInfo)
 * public key. Padding: PKCS#1 v1.5 (matches `RSAEncrypt(.., fOAEP: false)`).
 *
 * `publicKeyBase64` is the base64-encoded DER bytes of the SPKI structure,
 * as returned by `GetAuthPublicKey` (or after deobfuscation of
 * `GetPublicKeyInfo`).
 */
export function rsaEncryptForJava(plaintext: string, publicKeyBase64: string): string {
  // PEM-wrap so node:crypto can parse it.
  const pem =
    '-----BEGIN PUBLIC KEY-----\n' +
    (publicKeyBase64.match(/.{1,64}/g) ?? [publicKeyBase64]).join('\n') +
    '\n-----END PUBLIC KEY-----\n';
  const encrypted = publicEncrypt(
    {
      key: pem,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(plaintext, 'utf8'),
  );
  return encrypted.toString('base64');
}

/**
 * Compose obfuscation + RSA the way `ConfidentialDataSecurityUtil.CipherText(plain, pubkeyInfo)`
 * does (line 68599):
 *   1. publickey is obfuscated → deobfuscate first
 *   2. RSA-encrypt plaintext with the now-cleartext key
 *
 * If `obfuscatedPublicKey` is empty (server didn't return one), fall back
 * to single-arg obfuscation (NOT real encryption — matches BOS Designer
 * behavior when the server has password-encryption disabled, e.g. our
 * `frmCloudLogin` capture where REQ #10 returned empty).
 */
export function cipherPasswordForLogin(plaintext: string, obfuscatedPublicKey: string): string {
  if (!obfuscatedPublicKey) {
    return obfuscatePassword(plaintext);
  }
  const cleartextKey = deobfuscatePassword(obfuscatedPublicKey);
  return rsaEncryptForJava(plaintext, cleartextKey);
}
