import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthStore } from '../server/auth.js';

test('QQ file hot reload supports append, removal, replacement and fail-closed recovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-qq-reload-'));
  const qqFile = path.join(dir, 'allowed-qq.txt');
  try {
    const auth = new AuthStore({ file: path.join(dir, 'accounts.json'), secret: 'test-secret', required: true,
      registration: 'on', allowedQqFile: qqFile });
    assert.equal(auth.registrationEnabled(), false);
    fs.writeFileSync(qqFile, '\ufeff# friends 99999999\r\n12345678 # Alice\r\n\r\n');
    assert.equal(auth.registrationEnabled(), true);
    assert.equal(auth.qqAllowed('99999999'), false);
    const user = auth.registerUser({ username: 'alice', password: 'x', qq: '12345678' });
    fs.appendFileSync(qqFile, '87654321\n');
    assert.equal(auth.qqAllowed('87654321'), true);
    fs.writeFileSync(`${qqFile}.new`, '87654321\n');
    fs.renameSync(`${qqFile}.new`, qqFile);
    assert.equal(auth.qqAllowed('12345678'), false);
    assert.equal(auth.verify(auth.issue(user)).id, user.id);
    fs.writeFileSync(qqFile, '["87654321",');
    assert.equal(auth.registrationEnabled(), false);
    fs.writeFileSync(qqFile, '{"qq":["87654321"]}');
    assert.equal(auth.qqAllowed('87654321'), true);
    fs.unlinkSync(qqFile);
    assert.equal(auth.qqAllowed('87654321'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

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
