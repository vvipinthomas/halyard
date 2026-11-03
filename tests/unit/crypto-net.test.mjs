import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, encrypt, decrypt, passwordProblems, timingSafeEqual, sha256 } from '../../src/lib/crypto.js';
import { checkOutboundUrl } from '../../src/lib/net.js';

const KEY = Buffer.alloc(32, 1).toString('base64');

test('password hashing round-trips and rejects wrong password', async () => {
  const h = await hashPassword('correct-horse-42', undefined, 1000);
  const user = { pw_hash: h.hash, pw_salt: h.salt, pw_iter: h.iterations };
  assert.equal(await verifyPassword('correct-horse-42', user), true);
  assert.equal(await verifyPassword('wrong', user), false);
  assert.notEqual((await hashPassword('x', 'a', 1000)).hash, (await hashPassword('x', 'b', 1000)).hash, 'salt changes hash');
});
test('password policy', () => {
  assert.deepEqual(passwordProblems('correct-horse-42'), []);
  assert.ok(passwordProblems('short1').length);
  assert.ok(passwordProblems('nodigitsherexx').includes('a number'));
});
test('AES-256-GCM encrypt/decrypt with AAD binding', async () => {
  const sealed = await encrypt('sk-secret', KEY, 'org1:openai');
  assert.notEqual(sealed.ciphertext, 'sk-secret');
  assert.equal(await decrypt(sealed, KEY, 'org1:openai'), 'sk-secret');
  await assert.rejects(decrypt(sealed, KEY, 'org2:openai'), 'ciphertext must not be movable across orgs');
  await assert.rejects(encrypt('x', Buffer.alloc(16).toString('base64')), /32 bytes/);
});
test('timing-safe compare and sha256', async () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true); assert.equal(timingSafeEqual('abc', 'abd'), false); assert.equal(timingSafeEqual('a', 'ab'), false);
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('SSRF guard blocks private, metadata and non-HTTPS targets', () => {
  for (const u of ['http://example.com', 'https://127.0.0.1/x', 'https://10.1.2.3', 'https://169.254.169.254/latest', 'https://localhost:3000', 'https://[::1]/', 'https://192.168.0.5', 'https://172.20.1.1', 'https://user:pw@example.com', 'https://2130706433', 'https://metadata.google.internal', 'file:///etc/passwd'])
    assert.equal(checkOutboundUrl(u).ok, false, u);
  assert.equal(checkOutboundUrl('https://mcp.example.com/mcp').ok, true);
  assert.equal(checkOutboundUrl('http://localhost:11434', { allowPrivate: true }).ok, true);
});

test('TOTP matches the RFC 6238 SHA-1 test vectors and rejects replay', async () => {
  const { base32Encode, base32Decode, hotp, totp, verifyTotp } = await import('../../src/lib/totp.js');
  const s = base32Encode(new TextEncoder().encode('12345678901234567890'));
  assert.equal(new TextDecoder().decode(base32Decode(s)), '12345678901234567890');
  for (const [t, want] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']])
    assert.equal(await hotp(s, Math.floor(t / 30), 8), want, `T=${t}`);
  const now = 1111111109000; const code = await totp(s, now);
  const ctr = await verifyTotp(s, code, { now }); assert.ok(ctr);
  assert.equal(await verifyTotp(s, code, { now, lastCounter: ctr }), null, 'replay blocked');
  assert.equal(await verifyTotp(s, 'abc123', { now }), null);
});
