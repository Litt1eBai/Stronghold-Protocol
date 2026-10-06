import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AuthStore } from '../server/auth.js';

test('closed account store creates, verifies, signs and disables users', () => {
  const file = `/tmp/stronghold-auth-${process.pid}-${Date.now()}.json`;
  try {
    const auth = new AuthStore({ file, secret: 'test-secret', required: true });
    const user = auth.createUser({ username: 'alice', password: 'password-123', displayName: 'Alice' });
    assert.equal(auth.verifyCredentials('alice', 'bad'), null);
    assert.equal(auth.verifyCredentials('alice', 'password-123').id, user.id);
    const token = auth.issue(user);
    assert.equal(auth.verify(token).username, 'alice');
    auth.setStatus('alice', 'disabled');
    assert.equal(auth.verify(token), null);
  } finally { try { fs.unlinkSync(file); } catch {} }
});

test('QQ allowlisted registration creates one account and issues a JWT', () => {
  const file = `/tmp/stronghold-auth-register-${process.pid}-${Date.now()}.json`;
  try {
    const qqFile = `${file}.qq`;
    fs.writeFileSync(qqFile, JSON.stringify(['12345678', '87654321']));
    const auth = new AuthStore({ file, secret: 'test-secret', required: true, registration: 'on', allowedQqFile: qqFile });
    assert.equal(auth.registrationEnabled(), true);
    const user = auth.registerUser({ username: 'alice', password: 'x', displayName: 'Alice', qq: '12345678' });
    const token = auth.issue(user);
    assert.match(token, /^[^.]+\.[^.]+\.[^.]+$/);
    assert.equal(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).typ, 'JWT');
    assert.equal(auth.verify(token).username, 'alice');
    assert.throws(() => auth.registerUser({ username: 'bob', password: 'x', qq: '12345678' }), /qq already registered/);
    assert.throws(() => auth.registerUser({ username: 'bob', password: 'x', qq: '99999999' }), /qq is not allowed/);
  } finally { try { fs.unlinkSync(file); } catch {} try { fs.unlinkSync(`${file}.qq`); } catch {} }
});
