const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../frontend/draft-queue.js');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('debounces repeated edits and saves the latest record',async()=>{
  const saved=[];
  const queue=create({save:async record=>saved.push(record.value),delay:8});
  const record={id:'a',value:1};
  queue.queue(record);
  record.value=2;
  queue.queue(record);
  await wait(30);
  assert.deepEqual(saved,[2]);
  assert.equal(queue.hasUnsaved(),false);
});

test('flush saves immediately and clears the dirty state',async()=>{
  const saved=[];
  const queue=create({save:async record=>saved.push(record.value),delay:1000});
  const record={id:'b',value:'full author note'};
  queue.queue(record);
  await queue.flush(record);
  assert.deepEqual(saved,['full author note']);
  assert.equal(queue.hasUnsaved(),false);
});

test('retries transient failures automatically',async()=>{
  let attempts=0;
  const queue=create({save:async()=>{attempts++;if(attempts===1)throw Error('temporary network error');},delay:5,retryBase:5,maxRetries:2});
  queue.queue({id:'c'});
  await wait(60);
  assert.equal(attempts,2);
  assert.equal(queue.hasUnsaved(),false);
});

test('does not retry version conflicts and keeps data marked unsaved',async()=>{
  let attempts=0;
  const conflict=Object.assign(Error('version conflict'),{status:409,code:'version_conflict'});
  const queue=create({save:async()=>{attempts++;throw conflict;},shouldRetry:error=>error.status!==409,delay:5,retryBase:5});
  const record={id:'d',value:'do not lose me'};
  queue.queue(record);
  await wait(35);
  assert.equal(attempts,1);
  assert.equal(queue.hasUnsaved(),true);
});

test('preserves edits made while an earlier save is in flight',async()=>{
  let releaseFirst,startedFirst;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
  const started=new Promise(resolve=>{startedFirst=resolve;});
  const saved=[];
  const queue=create({save:async record=>{
    const value=record.value;
    saved.push(value);
    if(saved.length===1){startedFirst();await firstGate;}
  },delay:8});
  const record={id:'e',value:'first'};
  queue.queue(record);
  const firstFlush=queue.flush(record);
  await started;
  record.value='second';
  queue.queue(record);
  releaseFirst();
  await firstFlush;
  await wait(35);
  assert.deepEqual(saved,['first','second']);
  assert.equal(queue.hasUnsaved(),false);
});

test('flushAll waits for every pending record',async()=>{
  const saved=[];
  const queue=create({save:async record=>saved.push(record.id),delay:1000});
  const first={id:'f'},second={id:'g'};
  queue.queue(first);queue.queue(second);
  await queue.flushAll();
  assert.deepEqual(saved.sort(),['f','g']);
  assert.equal(queue.hasUnsaved(),false);
});
