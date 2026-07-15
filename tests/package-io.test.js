'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Import = require('../app/import.js');
const Export = require('../app/export.js');

function makePackage(overrides) {
  return Object.assign({
    version: '2.0',
    type: 'vibration-meter-package',
    accelUnit: 'cm/s^2',
    rawData: [
      { t: 0, ax: 1, ay: 2, az: 3, hasGravity: true },
      { t: 20, ax: 4, ay: 5, az: 6, hasGravity: false }
    ]
  }, overrides || {});
}

function parseObject(pkg) {
  return Import.parsePackageJSON(JSON.stringify(pkg));
}

function makeAnalysis() {
  return {
    fsHz: 50,
    rms: 12.5,
    peak: 24.5,
    peakToPeak: 20,
    magnitudeRange: 20,
    axisPeakToPeak: { x: 40, y: 10, z: 5 },
    fPeak: 5,
    dominantAxis: { axis: 'x', rms: 11.5 },
    sampling: {
      meanIntervalMs: 20,
      jitterMs: 0.4,
      intervals: new Float64Array([19.5, 20.5]),
      ignored: undefined,
      callback: function () {}
    },
    sampleCount: 2,
    durationMs: 20,
    dynamic: [{ mag: 0 }, { mag: 1 }]
  };
}

test('v2 package export/import round-trip preserves package data and metadata', () => {
  assert.equal(typeof Export.generateCSV, 'function');
  assert.equal(typeof Export.generateAnalysisJSON, 'function');
  assert.equal(typeof Export.generatePackageJSON, 'function');

  const rawData = [
    { t: 1000, ax: 1.25, ay: -2.5, az: 3.75, hasGravity: true },
    { t: 1020, ax: 4.5, ay: 5.25, az: -6.75, hasGravity: false }
  ];
  const analysis = makeAnalysis();
  const profile = { sensorAvailable: true, fsHz: 50 };
  const json = Export.generatePackageJSON(rawData, analysis, profile);
  const pkg = JSON.parse(json);

  assert.equal(pkg.version, '2.0');
  assert.equal(pkg.processingVersion, '2.0');
  assert.equal(pkg.type, 'vibration-meter-package');
  assert.equal(pkg.accelUnit, 'cm/s^2');
  assert.deepEqual(pkg.analysis.dominantAxis, { axis: 'x', rms: 11.5 });
  assert.equal(pkg.analysis.magnitudeRange, 20);
  assert.deepEqual(pkg.analysis.axisPeakToPeak, { x: 40, y: 10, z: 5 });
  assert.equal(pkg.analysis.peakToPeak, 20);
  assert.deepEqual(pkg.analysis.sampling, {
    meanIntervalMs: 20,
    jitterMs: 0.4,
    intervals: [19.5, 20.5]
  });
  assert.equal(pkg.analysis.dynamic, undefined);

  const imported = Import.parsePackageJSON(json);
  assert.deepEqual(imported.rawData, [
    { t: 0, ax: 1.25, ay: -2.5, az: 3.75, hasGravity: true },
    { t: 20, ax: 4.5, ay: 5.25, az: -6.75, hasGravity: false }
  ]);
  assert.deepEqual(imported.profile, profile);

  const csv = Export.generateCSV(rawData, analysis.dynamic);
  assert.match(csv, /^timestamp_ms,ax_cm_s2,ay_cm_s2,az_cm_s2,mag_dynamic_cm_s2\n/);
  assert.equal(csv.split('\n').length, 3);
});

test('analysis export uses v2 metadata and includes JSON-safe analysis fields', () => {
  const payload = JSON.parse(Export.generateAnalysisJSON(makeAnalysis(), null));
  assert.equal(payload.version, '2.0');
  assert.equal(payload.processingVersion, '2.0');
  assert.equal(payload.analysis.dominantAxis.axis, 'x');
  assert.deepEqual(payload.analysis.sampling.intervals, [19.5, 20.5]);
});

test('legacy m/s^2 packages are converted to cm/s^2', () => {
  const legacy = makePackage({
    version: undefined,
    accelUnit: 'm/s^2',
    rawData: [
      { t: 10, ax: 1, ay: -2, az: 0.5 },
      { t: 30, ax: 1.5, ay: -1, az: 0 }
    ]
  });
  delete legacy.version;

  const imported = parseObject(legacy);
  assert.deepEqual(imported.rawData, [
    { t: 10, ax: 100, ay: -200, az: 50, hasGravity: true },
    { t: 30, ax: 150, ay: -100, az: 0, hasGravity: true }
  ]);

  delete legacy.accelUnit;
  assert.equal(parseObject(legacy).rawData[0].ax, 100);
});

test('missing, 1.x, and 2.x versions are accepted; other versions are rejected', () => {
  const supported = [undefined, '1.0', '1.8.3', 1, '2.0', '2.9.1', 2];
  supported.forEach((version) => {
    const pkg = makePackage({ version });
    if (version === undefined) delete pkg.version;
    assert.doesNotThrow(() => parseObject(pkg));
  });

  ['0.9', '3.0', 'v2', '', null, {}, 2.5e2].forEach((version) => {
    assert.throws(
      () => parseObject(makePackage({ version })),
      /Unsupported package version/
    );
  });
});

test('package type and acceleration unit are validated', () => {
  assert.throws(
    () => parseObject(makePackage({ type: 'other-package' })),
    /Invalid vibration package/
  );
  assert.throws(
    () => parseObject(makePackage({ accelUnit: 'g' })),
    /Unsupported acceleration unit/
  );
  assert.throws(
    () => parseObject(makePackage({ accelUnit: null })),
    /Unsupported acceleration unit/
  );

  const missingV2Unit = makePackage({ version: '2.0' });
  delete missingV2Unit.accelUnit;
  assert.throws(
    () => parseObject(missingV2Unit),
    /requires an acceleration unit/
  );

  const missingV1Unit = makePackage({ version: '1.0' });
  delete missingV1Unit.accelUnit;
  assert.equal(parseObject(missingV1Unit).rawData[0].ax, 100);
});

test('rawData must be a non-empty array of finite samples', () => {
  assert.throws(
    () => parseObject(makePackage({ rawData: [] })),
    /no measurement data/
  );
  assert.throws(
    () => parseObject(makePackage({ rawData: null })),
    /no measurement data/
  );

  const nonFiniteJSON = '{"version":"2.0","type":"vibration-meter-package",' +
    '"accelUnit":"cm/s^2","rawData":[{"t":0,"ax":1e400,"ay":0,"az":0}]}';
  assert.throws(
    () => Import.parsePackageJSON(nonFiniteJSON),
    /finite numbers/
  );

  assert.throws(
    () => parseObject(makePackage({
      rawData: [{ t: 0, ax: 0, ay: 0, az: 0, hasGravity: 'yes' }]
    })),
    /Invalid gravity flag/
  );

  assert.throws(
    () => parseObject(makePackage({
      rawData: [{
        t: 0,
        ax: Import.limits.maxAbsAccelerationCmS2 + 1,
        ay: 0,
        az: 0
      }]
    })),
    /out of range/
  );
});

test('timestamps must strictly increase and duration is capped at one hour', () => {
  assert.throws(
    () => parseObject(makePackage({
      rawData: [
        { t: 10, ax: 0, ay: 0, az: 0 },
        { t: 10, ax: 0, ay: 0, az: 0 }
      ]
    })),
    /timestamps must increase/
  );
  assert.throws(
    () => parseObject(makePackage({
      rawData: [
        { t: 10, ax: 0, ay: 0, az: 0 },
        { t: 9, ax: 0, ay: 0, az: 0 }
      ]
    })),
    /timestamps must increase/
  );

  const oneHour = Import.limits.maxDurationMs;
  assert.doesNotThrow(() => parseObject(makePackage({
    rawData: [
      { t: 0, ax: 0, ay: 0, az: 0 },
      { t: oneHour, ax: 0, ay: 0, az: 0 }
    ]
  })));
  assert.throws(
    () => parseObject(makePackage({
      rawData: [
        { t: 0, ax: 0, ay: 0, az: 0 },
        { t: oneHour + 1, ax: 0, ay: 0, az: 0 }
      ]
    })),
    /duration is too long/
  );
});

test('legacy duplicate timestamps are minimally adjusted while v2 remains strict', () => {
  const legacy = makePackage({
    version: '1.0',
    rawData: [
      { t: 10, ax: 1, ay: 0, az: 0 },
      { t: 10, ax: 2, ay: 0, az: 0 },
      { t: 30, ax: 3, ay: 0, az: 0 }
    ]
  });
  const imported = parseObject(legacy);
  assert.equal(imported.timestampAdjustedCount, 1);
  assert.equal(imported.rawData.length, 3);
  assert.ok(imported.rawData[1].t > imported.rawData[0].t);
  assert.ok(imported.rawData[2].t > imported.rawData[1].t);

  assert.throws(
    () => parseObject(makePackage({ rawData: legacy.rawData })),
    /timestamps must increase/
  );
});

test('sample count is capped before individual samples are processed', () => {
  const count = Import.limits.maxSamples + 1;
  const rawData = '[' + new Array(count).fill('null').join(',') + ']';
  const json = '{"version":"2.0","type":"vibration-meter-package",' +
    '"accelUnit":"cm/s^2","rawData":' + rawData + '}';

  assert.throws(
    () => Import.parsePackageJSON(json),
    /too many samples/
  );
});

test('oversized JSON text and files are rejected before parsing or reading', async () => {
  const oversized = ' '.repeat(Import.limits.maxJSONSize + 1);
  assert.throws(
    () => Import.parsePackageJSON(oversized),
    /JSON file is too large/
  );

  // Character count is below the limit, but the UTF-8 representation exceeds
  // 25 MiB and must be rejected as well.
  const oversizedUtf8 = '\u3042'.repeat(Math.floor(Import.limits.maxJSONSize / 3) + 1);
  assert.throws(
    () => Import.parsePackageJSON(oversizedUtf8),
    /JSON file is too large/
  );

  await assert.rejects(
    Import.handleFile({
      name: 'large.json',
      size: Import.limits.maxJSONSize + 1,
      text: async () => '{not read}'
    }),
    /File is too large/
  );
});

test('ZIP JSON expanded-size limits are checked before and during extraction', async () => {
  const previousJSZip = global.JSZip;
  try {
    let extracted = false;
    global.JSZip = {
      loadAsync: async () => ({
        file: (name) => typeof name === 'string' ? {
          _data: { uncompressedSize: Import.limits.maxJSONSize + 1 },
          async: async () => {
            extracted = true;
            return '';
          }
        } : []
      })
    };
    await assert.rejects(Import.parseZIP(new ArrayBuffer(0)), /JSON file is too large/);
    assert.equal(extracted, false);

    let paused = false;
    global.JSZip = {
      loadAsync: async () => ({
        file: (name) => typeof name === 'string' ? {
          _data: {},
          internalStream: () => {
            const handlers = {};
            return {
              on(event, callback) {
                handlers[event] = callback;
                return this;
              },
              pause() {
                paused = true;
                return this;
              },
              resume() {
                handlers.data(new Uint8Array(Import.limits.maxJSONSize + 1));
                if (!paused) handlers.end();
                return this;
              }
            };
          }
        } : []
      })
    };
    await assert.rejects(Import.parseZIP(new ArrayBuffer(0)), /JSON file is too large/);
    assert.equal(paused, true);
  } finally {
    if (previousJSZip === undefined) {
      delete global.JSZip;
    } else {
      global.JSZip = previousJSZip;
    }
  }
});

test('ZIP package text is decoded incrementally before validation', async () => {
  const previousJSZip = global.JSZip;
  const json = JSON.stringify(makePackage());
  const bytes = new TextEncoder().encode(json);
  try {
    global.JSZip = {
      loadAsync: async () => ({
        file: (name) => typeof name === 'string' ? {
          _data: { uncompressedSize: bytes.byteLength },
          internalStream: () => {
            const handlers = {};
            return {
              on(event, callback) {
                handlers[event] = callback;
                return this;
              },
              pause() {
                return this;
              },
              resume() {
                const split = Math.floor(bytes.length / 2);
                handlers.data(bytes.slice(0, split));
                handlers.data(bytes.slice(split));
                handlers.end();
                return this;
              }
            };
          }
        } : []
      })
    };

    const result = await Import.parseZIP(new ArrayBuffer(0));
    assert.equal(result.rawData.length, 2);
    assert.equal(result.rawData[1].t, 20);
  } finally {
    if (previousJSZip === undefined) {
      delete global.JSZip;
    } else {
      global.JSZip = previousJSZip;
    }
  }
});

test('unknown file extensions are rejected', async () => {
  await assert.rejects(
    Import.handleFile({ name: 'measurement.csv', size: 10 }),
    /Unsupported file type/
  );
});
