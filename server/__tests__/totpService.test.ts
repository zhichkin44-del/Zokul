import * as totp from '../src/services/totpService';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B: ASCII secret "12345678901234567890", SHA-1.
  const rfcSecret = totp.base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC test vectors (last 6 digits)', () => {
    expect(totp.codeAt(rfcSecret, Math.floor(59 / 30))).toBe('287082');
    expect(totp.codeAt(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totp.codeAt(rfcSecret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totp.codeAt(rfcSecret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
    expect(totp.base32Decode(totp.base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('accepts the current code with ±1 step of clock drift, and nothing else', () => {
    const secret = totp.newSecret();
    const now = 1_800_000_000_000;
    const step = totp.currentStep(now);
    expect(totp.verifyCode(secret, totp.codeAt(secret, step), now)).toBe(step);
    expect(totp.verifyCode(secret, totp.codeAt(secret, step - 1), now)).toBe(step - 1);
    expect(totp.verifyCode(secret, totp.codeAt(secret, step + 2), now)).toBeNull();
    expect(totp.verifyCode(secret, '12345', now)).toBeNull();
    expect(totp.verifyCode(secret, 'abcdef', now)).toBeNull();
  });

  it('stores secrets encrypted and detects tampering', () => {
    const secret = totp.newSecret();
    const stored = totp.encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(totp.decryptSecret(stored)).toBe(secret);
    const [iv, tag, data] = stored.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => totp.decryptSecret([iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('makes distinct recovery codes and hashes them case-insensitively', () => {
    const codes = totp.newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/));
    expect(totp.hashRecovery(codes[0].toUpperCase())).toBe(totp.hashRecovery(codes[0]));
  });
});
