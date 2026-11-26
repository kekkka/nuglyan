const test=require('node:test');
const assert=require('node:assert/strict');
const {create,DEFAULT_KEY}=require('../frontend/session-store.js');
function memoryStorage(){
  const values=new Map();
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};
}
test('stores and restores the rotated Supabase session for this tab',()=>{
  const storage=memoryStorage(),store=create(storage);
  const session={access_token:'access',refresh_token:'refresh',expires_at:1900000000,ignored:'not persisted'};
  assert.equal(store.write(session),true);
  assert.deepEqual(store.read(),{access_token:'access',refresh_token:'refresh',expires_at:1900000000});
  assert.equal(storage.values.has(DEFAULT_KEY),true);
});
test('rejects malformed or incomplete session data and clears it',()=>{
  const storage=memoryStorage(),store=create(storage);
  storage.setItem(DEFAULT_KEY,'{broken');
  assert.equal(store.read(),null);
  assert.equal(storage.values.has(DEFAULT_KEY),false);
  storage.setItem(DEFAULT_KEY,JSON.stringify({access_token:'only-access'}));
  assert.equal(store.read(),null);
  assert.equal(storage.values.has(DEFAULT_KEY),false);
});
test('clears a session on sign out',()=>{
  const storage=memoryStorage(),store=create(storage);
  store.write({access_token:'a',refresh_token:'r',expires_at:1900000000});
  store.clear();
  assert.equal(store.read(),null);
});
test('degrades safely when sessionStorage is unavailable',()=>{
  const store=create(null);
  assert.equal(store.read(),null);
  assert.equal(store.write({access_token:'a',refresh_token:'r',expires_at:1900000000}),false);
  assert.doesNotThrow(()=>store.clear());
});
