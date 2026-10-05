#!/usr/bin/env node
// Closed-platform account administration. There is intentionally no public registration route.
import { AuthStore } from '../server/auth.js';

const args = process.argv.slice(2);
const cmd = args[0];
const value = (key) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : null; };
const store = new AuthStore({ required: false });

function usage(code = 1) {
  console.error('用法：');
  console.error('  node tools/admin.mjs user create <username> <password> [displayName] [admin]');
  console.error('  node tools/admin.mjs user disable <username>');
  console.error('  node tools/admin.mjs user enable <username>');
  console.error('  node tools/admin.mjs user list');
  process.exitCode = code;
}

try {
  if (cmd !== 'user') { usage(); }
  const action = args[1];
  if (action === 'create') {
    const [username, password, displayName, role] = args.slice(2);
    const user = store.createUser({ username, password, displayName: displayName || username, role });
    console.log(`已创建账号 ${user.username}（${user.displayName}）`);
  } else if (action === 'disable' || action === 'enable') {
    const user = store.setStatus(args[2], action === 'disable' ? 'disabled' : 'active');
    console.log(`${action === 'disable' ? '已禁用' : '已启用'} ${user.username}`);
  } else if (action === 'list') {
    console.log(`账号数：${store.count()}`);
    for (const u of store.users.values()) console.log(`${u.username}\t${u.displayName}\t${u.role}\t${u.status}`);
  } else usage();
} catch (e) {
  console.error(`失败：${e?.message || e}`);
  process.exitCode = 1;
}
