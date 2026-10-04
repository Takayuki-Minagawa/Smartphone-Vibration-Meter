'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RecordingWakeLock = require('../app/wake-lock.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function sentinel() {
  const lock = new EventTarget();
  lock.released = false;
  lock.releaseCalls = 0;
  lock.release = function () {
    lock.releaseCalls += 1;
    lock.released = true;
    lock.dispatchEvent(new Event('release'));
    return Promise.resolve();
  };
  lock.systemRelease = function () {
    lock.released = true;
    lock.dispatchEvent(new Event('release'));
  };
  return lock;
}

function harness(request) {
  const document = { visibilityState: 'visible' };
  const changes = [];
  const requests = [];
  const controller = RecordingWakeLock.create({
    document,
    navigator: {
      wakeLock: {
        request(type) {
          requests.push(type);
          return request(requests.length);
        }
      }
    },
    onChange: status => changes.push(status)
  });
  return { controller, document, changes, requests };
}

test('wake lock is acquired once per visible recording and released on stop', async () => {
  const lock = sentinel();
  const h = harness(() => Promise.resolve(lock));
  assert.equal(h.controller.getStatus(), 'idle');
  await h.controller.start();
  await h.controller.start();
  assert.deepEqual(h.requests, ['screen']);
  assert.equal(h.controller.getStatus(), 'active');
  await h.controller.stop();
  await h.controller.stop();
  assert.equal(lock.releaseCalls, 1);
  assert.deepEqual(h.changes, ['requesting', 'active', 'idle']);
});

test('unsupported wake locks and denied requests do not reject recording operations', async () => {
  for (const navigator of [undefined, {}, { wakeLock: {} }]) {
    const controller = RecordingWakeLock.create({
      navigator,
      document: { visibilityState: 'visible' }
    });
    await controller.start();
    assert.equal(controller.getStatus(), 'unsupported');
    await controller.stop();
    assert.equal(controller.getStatus(), 'idle');
  }

  for (const request of [
    () => { throw new Error('denied synchronously'); },
    () => Promise.reject(new Error('denied asynchronously'))
  ]) {
    const h = harness(request);
    await h.controller.start();
    assert.equal(h.controller.getStatus(), 'unavailable');
    await h.controller.stop();
    assert.equal(h.controller.getStatus(), 'idle');
  }
});

test('simultaneous start and visible events share the pending request', async () => {
  const grant = deferred();
  const h = harness(() => grant.promise);
  const first = h.controller.start();
  const second = h.controller.start();
  const visible = h.controller.handleVisibilityChange();
  assert.equal(h.requests.length, 1);
  grant.resolve(sentinel());
  await Promise.all([first, second, visible]);
  assert.equal(h.controller.getStatus(), 'active');
  await h.controller.stop();
});

test('a grant received after stop is immediately released without changing idle status', async () => {
  const grant = deferred();
  const lock = sentinel();
  const h = harness(() => grant.promise);
  const pending = h.controller.start();
  await h.controller.stop();
  grant.resolve(lock);
  await pending;
  assert.equal(lock.releaseCalls, 1);
  assert.equal(h.controller.getStatus(), 'idle');
  assert.deepEqual(h.changes, ['requesting', 'idle']);
});

test('a previous recording grant cannot replace or release the next recording lock', async () => {
  const oldGrant = deferred();
  const oldLock = sentinel();
  const newLock = sentinel();
  const h = harness(number => number === 1 ? oldGrant.promise : Promise.resolve(newLock));
  const previous = h.controller.start();
  await h.controller.stop();
  await h.controller.start();
  oldGrant.resolve(oldLock);
  await previous;
  assert.equal(oldLock.releaseCalls, 1);
  assert.equal(newLock.releaseCalls, 0);
  assert.equal(h.controller.getStatus(), 'active');
  await h.controller.stop();
  assert.equal(newLock.releaseCalls, 1);
});

test('a late failure cannot change the next recording status or pending request', async () => {
  const oldGrant = deferred();
  const newGrant = deferred();
  const h = harness(number => number === 1 ? oldGrant.promise : newGrant.promise);
  const previous = h.controller.start();
  await h.controller.stop();
  const current = h.controller.start();
  oldGrant.reject(new Error('old denial'));
  await previous;
  assert.equal(h.controller.getStatus(), 'requesting');
  const duplicate = h.controller.handleVisibilityChange();
  assert.equal(h.requests.length, 2);
  newGrant.resolve(sentinel());
  await Promise.all([current, duplicate]);
  assert.equal(h.controller.getStatus(), 'active');
  await h.controller.stop();
});

test('hidden recordings release their lock and reacquire only when visible and still recording', async () => {
  const firstLock = sentinel();
  const secondLock = sentinel();
  const h = harness(number => Promise.resolve(number === 1 ? firstLock : secondLock));
  await h.controller.start();
  h.document.visibilityState = 'hidden';
  await h.controller.handleVisibilityChange();
  assert.equal(firstLock.releaseCalls, 1);
  assert.equal(h.controller.getStatus(), 'released');
  h.document.visibilityState = 'visible';
  await h.controller.handleVisibilityChange();
  assert.equal(h.requests.length, 2);
  assert.equal(h.controller.getStatus(), 'active');
  await h.controller.stop();
  await h.controller.handleVisibilityChange();
  assert.equal(h.requests.length, 2);
});

test('pending grants from before a hidden/visible cycle cannot replace its new lock', async () => {
  const firstGrant = deferred();
  const oldLock = sentinel();
  const newLock = sentinel();
  const h = harness(number => number === 1 ? firstGrant.promise : Promise.resolve(newLock));
  const previous = h.controller.start();
  h.document.visibilityState = 'hidden';
  await h.controller.handleVisibilityChange();
  h.document.visibilityState = 'visible';
  await h.controller.handleVisibilityChange();
  firstGrant.resolve(oldLock);
  await previous;
  assert.equal(oldLock.releaseCalls, 1);
  assert.equal(newLock.releaseCalls, 0);
  assert.equal(h.controller.getStatus(), 'active');
  await h.controller.stop();
});

test('starting hidden defers requesting until visible', async () => {
  const h = harness(() => Promise.resolve(sentinel()));
  h.document.visibilityState = 'hidden';
  await h.controller.start();
  assert.equal(h.requests.length, 0);
  assert.equal(h.controller.getStatus(), 'released');
  h.document.visibilityState = 'visible';
  await h.controller.handleVisibilityChange();
  assert.equal(h.requests.length, 1);
  await h.controller.stop();
});

test('system release reports the loss without automatically retrying', async () => {
  const lock = sentinel();
  const h = harness(() => Promise.resolve(lock));
  await h.controller.start();
  lock.systemRelease();
  await Promise.resolve();
  assert.equal(h.controller.getStatus(), 'released');
  assert.equal(h.requests.length, 1);
  await h.controller.stop();
  assert.equal(lock.releaseCalls, 0);
});

test('a delayed release event from an old lock cannot overwrite a newer active status', async () => {
  const oldLock = sentinel();
  oldLock.release = function () {
    oldLock.releaseCalls += 1;
    oldLock.released = true;
    return Promise.resolve();
  };
  const newLock = sentinel();
  const h = harness(number => Promise.resolve(number === 1 ? oldLock : newLock));
  await h.controller.start();
  await h.controller.stop();
  await h.controller.start();
  oldLock.dispatchEvent(new Event('release'));
  assert.equal(h.controller.getStatus(), 'active');
  assert.equal(newLock.releaseCalls, 0);
  await h.controller.stop();
});

test('release failures are contained during ordinary and stale-request cleanup', async () => {
  for (const release of [
    () => { throw new Error('release failed synchronously'); },
    () => Promise.reject(new Error('release failed asynchronously'))
  ]) {
    const lock = sentinel();
    lock.release = release;
    const h = harness(() => Promise.resolve(lock));
    await h.controller.start();
    await h.controller.stop();
    assert.equal(h.controller.getStatus(), 'idle');

    const grant = deferred();
    const stale = harness(() => grant.promise);
    const pending = stale.controller.start();
    await stale.controller.stop();
    grant.resolve(lock);
    await pending;
    assert.equal(stale.controller.getStatus(), 'idle');
  }
});

test('a granted sentinel already released by the platform is not reported as active', async () => {
  const lock = sentinel();
  lock.released = true;
  const h = harness(() => Promise.resolve(lock));
  await h.controller.start();
  assert.equal(h.controller.getStatus(), 'released');
  await h.controller.stop();
  assert.equal(lock.releaseCalls, 0);
});

test('a visible event can reacquire when the old release event has not been dispatched yet', async () => {
  const oldLock = sentinel();
  const newLock = sentinel();
  const h = harness(number => Promise.resolve(number === 1 ? oldLock : newLock));
  await h.controller.start();
  oldLock.released = true;
  await h.controller.handleVisibilityChange();
  oldLock.dispatchEvent(new Event('release'));
  assert.equal(h.requests.length, 2);
  assert.equal(h.controller.getStatus(), 'active');
  assert.equal(newLock.releaseCalls, 0);
  await h.controller.stop();
});

test('status observer errors do not leak wake locks or reject lifecycle operations', async () => {
  const lock = sentinel();
  const controller = RecordingWakeLock.create({
    navigator: { wakeLock: { request: () => Promise.resolve(lock) } },
    document: { visibilityState: 'visible' },
    onChange: () => { throw new Error('display failed'); }
  });
  await controller.start();
  assert.equal(controller.getStatus(), 'active');
  await controller.stop();
  assert.equal(lock.releaseCalls, 1);
  assert.equal(controller.getStatus(), 'idle');
});
