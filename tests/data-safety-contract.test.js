const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync(require.resolve('../frontend/app.js'),'utf8');
const server=fs.readFileSync(require.resolve('../frontend/server.js'),'utf8');
const index=fs.readFileSync(require.resolve('../frontend/index.html'),'utf8');
test('editor autosaves text inputs and change-only controls',()=>{
  assert.match(app,/addEventListener\('input'/);
  assert.match(app,/addEventListener\('change'/);
  assert.match(app,/event\.target\.tagName==='SELECT'\|\|event\.target\.type==='checkbox'/);
});
test('server restores authenticated admin session before first render',()=>{
  assert.match(server,/async function restoreAdminSession/);
  assert.match(server,/await restoreAdminSession\(\);ready=true;render\(\)/);
  assert.match(server,/sessionStore\.clear\(\)/);
});
test('before-unload guard and hidden-tab flush protect pending edits',()=>{
  assert.match(server,/addEventListener\('beforeunload'/);
  assert.match(server,/visibilitychange/);
  assert.match(server,/draftQueue\.flushAll\(\)/);
});
test('browser loads persistence helpers before app and server',()=>{
  const draft=index.indexOf('draft-queue.js');
  const session=index.indexOf('session-store.js');
  const appIndex=index.indexOf('app.js');
  const serverIndex=index.indexOf('server.js');
  assert.ok(draft>=0&&draft<session&&session<appIndex&&appIndex<serverIndex);
});
