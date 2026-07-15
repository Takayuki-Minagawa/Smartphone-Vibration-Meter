'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Sensor = require('../app/sensor.js');
const Limits = require('../app/limits.js');

test('readMotionEvent prefers complete linear acceleration', () => {
  const sample = Sensor.readMotionEvent({
    timeStamp: 123.5,
    acceleration: { x: 1, y: -2, z: 0.5 },
    accelerationIncludingGravity: { x: 10, y: 11, z: 12 }
  });

  assert.deepEqual(sample, {
    t: 123.5,
    ax: 100,
    ay: -200,
    az: 50,
    hasGravity: false,
    source: 'linear'
  });
});

test('readMotionEvent falls back to complete acceleration including gravity', () => {
  const sample = Sensor.readMotionEvent({
    timeStamp: 10,
    acceleration: { x: 1, y: null, z: 3 },
    accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 }
  });

  assert.equal(sample.hasGravity, true);
  assert.equal(sample.source, 'including-gravity');
  assert.equal(sample.az, 981);
});

test('readMotionEvent drops incomplete and non-finite samples', () => {
  assert.equal(Sensor.readMotionEvent({
    timeStamp: 0,
    acceleration: { x: 1, y: 2, z: Number.NaN }
  }), null);
  assert.equal(Sensor.readMotionEvent({ timeStamp: 0 }), null);
  assert.deepEqual(Sensor.readMotionEvent({
    timeStamp: 1,
    acceleration: { x: 0, y: 0, z: 0 }
  }), {
    t: 1,
    ax: 0,
    ay: 0,
    az: 0,
    hasGravity: false,
    source: 'linear'
  });
  assert.equal(Sensor.readMotionEvent({
    timeStamp: 0,
    acceleration: {
      x: Limits.maxAbsAccelerationCmS2 / 100 + 1,
      y: 0,
      z: 0
    }
  }), null);
});

test('decodeProfile safely normalizes stale capability data', () => {
  assert.equal(Sensor.decodeProfile(null), null);
  assert.deepEqual(Sensor.decodeProfile({
    sensorAvailable: true,
    hasAcc: true,
    hasAccG: false,
    fsHz: '50',
    eventCount: -1
  }), {
    sensorAvailable: true,
    needsPermission: false,
    hasAccG: false,
    hasAcc: true,
    hasRotationRate: false,
    fsHz: 0,
    eventCount: 0
  });

  assert.equal(Sensor.decodeProfile({
    sensorAvailable: true,
    hasAcc: false,
    hasAccG: false
  }).sensorAvailable, false);
});

test('startListening forwards valid samples and removes its listener', () => {
  const originalWindow = global.window;
  let listener = null;
  let removed = null;
  global.window = {
    addEventListener(type, callback) {
      assert.equal(type, 'devicemotion');
      listener = callback;
    },
    removeEventListener(type, callback) {
      assert.equal(type, 'devicemotion');
      removed = callback;
    }
  };

  try {
    const samples = [];
    const stop = Sensor.startListening((sample) => samples.push(sample));
    listener({
      timeStamp: 5,
      acceleration: { x: 0.1, y: 0.2, z: 0.3 }
    });
    listener({
      timeStamp: 6,
      acceleration: { x: 0.1, y: null, z: 0.3 }
    });
    listener({
      timeStamp: 5,
      acceleration: { x: 0.4, y: 0.5, z: 0.6 }
    });
    stop();

    assert.equal(samples.length, 2);
    assert.equal(samples[0].source, 'linear');
    assert.ok(samples[1].t > samples[0].t);
    assert.equal(removed, listener);
  } finally {
    global.window = originalWindow;
  }
});
