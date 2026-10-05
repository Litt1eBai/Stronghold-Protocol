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
