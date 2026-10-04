'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Analysis = require('../app/analysis.js');
const Limits = require('../app/limits.js');
const appSource = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatch(type, details = {}) {
      const event = { type, target: this, preventDefault() {}, ...details };
      for (const callback of listeners.get(type) || []) callback(event);
    }
  };
}

function element(attributes = '') {
  const attrs = new Map();
  const classes = new Set();
  return {
    ...eventTarget(),
    checked: /\bchecked\b/.test(attributes),
    disabled: /\bdisabled\b/.test(attributes),
    hidden: /\bhidden\b/.test(attributes),
    textContent: '',
    value: attributes.match(/\bvalue="([^"]*)"/)?.[1] || '',
    dataset: {},
    style: {},
    options: [],
    classList: {
      add(...items) { items.forEach(item => classes.add(item)); },
      remove(...items) { items.forEach(item => classes.delete(item)); },
      contains(item) { return classes.has(item); },
      toggle(item, enabled) {
        const shouldAdd = enabled === undefined ? !classes.has(item) : enabled;
        if (shouldAdd) classes.add(item);
        else classes.delete(item);
        return shouldAdd;
      }
    },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    removeAttribute(name) { attrs.delete(name); }
  };
}

function createHarness(options = {}) {
  const elements = new Map();
  for (const match of appHtml.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    elements.set(match[1], element(match[0]));
  }
  const get = id => {
    assert.ok(elements.has(id), `The application HTML must define #${id}`);
    return elements.get(id);
  };
  get('durationSelect').value = options.duration || '0';
  get('durationSelect').options = ['0', '10', '30', '60'].map(value => ({ value }));
  if (options.keepScreenAwake === false) get('keepScreenAwake').checked = false;

  const document = {
    ...eventTarget(),
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    documentElement: element(),
    getElementById: get,
    querySelector: () => element()
  };
  const window = {
    ...eventTarget(),
    location: { href: 'https://example.test/app/' },
    matchMedia: () => ({ matches: false })
  };
  const storage = new Map([
    ['vibmeter_consent', 'true'],
    ['vibmeter_consent_version', '2026-07'],
    ...(options.storage || [])
  ]);
  const timers = new Map();
  let nextTimer = 0;
  function addTimer(callback, delay, repeating) {
    const id = ++nextTimer;
    timers.set(id, { callback, delay, repeating });
    return id;
  }
  const sensor = { callbacks: [], stopCount: 0, fail: false };
  const wake = { startCount: 0, stopCount: 0, visibilityCount: 0 };
  const exports = [];
  let analyzeCount = 0;
  const context = vm.createContext({
    document,
    window,
    navigator: {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    getComputedStyle: () => ({ getPropertyValue: () => '#112233' }),
    setTimeout: (callback, delay) => addTimer(callback, delay, false),
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => addTimer(callback, delay, true),
    clearInterval: id => timers.delete(id),
    VibMeterLimits: { ...Limits, ...options.limits },
    Sensor: {
      loadProfile: () => ({ sensorAvailable: true, fsHz: 50 }),
      startListening(callback) {
        if (sensor.fail) throw new Error('Sensor unavailable');
        sensor.callbacks.push(callback);
        return () => { sensor.stopCount += 1; };
      }
    },
    RecordingWakeLock: {
      create({ onChange }) {
        wake.onChange = onChange;
        return {
          start() {
            wake.startCount += 1;
            onChange('requesting');
          },
          stop() {
            wake.stopCount += 1;
            onChange('idle');
          },
          handleVisibilityChange() { wake.visibilityCount += 1; },
          getStatus() { return 'idle'; }
        };
      }
    },
    Analysis: {
      ...Analysis,
      analyze(raw) {
        analyzeCount += 1;
        if (options.analysisError) throw new Error('Analysis unavailable');
        return Analysis.analyze(raw);
      }
    },
    Chart: class {
      constructor(canvas, config) {
        this.data = config.data;
        this.options = config.options;
      }
      update() {
        if (options.chartError && this.data.datasets.some(dataset => dataset.data.length > 0)) {
          throw new Error('Chart rendering unavailable');
        }
      }
      resize() {}
    },
    Export: {
      downloadCSV(...args) { exports.push({ type: 'csv', args }); },
      downloadPackage(...args) { exports.push({ type: 'package', args }); }
    }
  });
  vm.runInContext(appSource, context, { filename: 'app/app.js' });
  return {
    state: context.App.state,
    elements: get,
    document,
    window,
    sensor,
    wake,
    storage,
    timers,
    exports,
    analysisCount: () => analyzeCount,
    click(id) {
      assert.equal(get(id).disabled, false, `#${id} must be enabled`);
      get(id).dispatch('click');
    },
    runTimer(id) {
      const timer = timers.get(id);
      assert.ok(timer, `Timer ${id} must exist`);
      if (!timer.repeating) timers.delete(id);
      timer.callback();
    },
    record(count = 256) {
      const callback = sensor.callbacks.at(-1);
      assert.ok(callback, 'Recording must register a sensor callback');
      for (let i = 0; i < count; i += 1) {
        callback({
          t: i * 20,
          ax: Math.sin(i * 0.2) * 10,
          ay: 0,
          az: 0,
          hasGravity: false,
          source: 'linear'
        });
      }
    }
  };
}

function assertStopped(app, liveTimer, stopTimer) {
  assert.equal(app.state.recording, false);
  assert.equal(app.state.stopSensor, null);
  assert.equal(app.state.liveUpdateTimer, null);
  assert.equal(app.state.autoStopTimer, null);
  assert.equal(app.timers.has(liveTimer), false);
  assert.equal(app.timers.has(stopTimer), false);
  assert.equal(app.elements('btnStart').disabled, false);
  assert.equal(app.elements('btnStop').disabled, true);
  assert.equal(app.elements('importInput').disabled, false);
}

test('manual stop cleans up resources and makes the completed recording exportable', () => {
  const app = createHarness();
  app.click('btnStart');
  assert.equal(app.state.recording, true);
  assert.equal(app.elements('btnStart').disabled, true);
  assert.equal(app.elements('importInput').disabled, true);
  assert.equal(app.elements('btnPackage').disabled, true);
  const { liveUpdateTimer, autoStopTimer } = app.state;
  const wakeStopsBefore = app.wake.stopCount;
  app.record();
  app.runTimer(liveUpdateTimer);
  assert.equal(app.elements('kpiSamples').textContent, 256);
  app.click('btnStop');
  assertStopped(app, liveUpdateTimer, autoStopTimer);
  assert.equal(app.sensor.stopCount, 1);
  assert.equal(app.wake.stopCount, wakeStopsBefore + 1);
  assert.equal(app.state.statusKey, 'statusDone');
  assert.equal(app.state.analysisResult.sampleCount, 256);
  assert.equal(app.state.analysisResult.sampling.backgrounded, false);
  app.click('btnPackage');
  assert.equal(app.exports[0].args[0].length, 256);
  assert.equal(app.exports[0].args[1], app.state.analysisResult);
});

test('requested duration, sample limit, and duration safety limit use the same cleanup', async t => {
  const cases = [
    { name: 'requested duration', options: { duration: '10' }, trigger(app) {
      app.record(3);
      assert.equal(app.timers.get(app.state.autoStopTimer).delay, 10000);
      app.runTimer(app.state.autoStopTimer);
    } },
    { name: 'sample limit', options: { limits: { maxSamples: 3 } }, trigger(app) {
      app.record(5);
      assert.equal(app.state.rawData.length, 3);
    } },
    { name: 'duration safety timer', options: {}, trigger(app) {
      app.record(3);
      assert.equal(app.timers.get(app.state.autoStopTimer).delay, Limits.maxDurationMs);
      app.runTimer(app.state.autoStopTimer);
    } },
    { name: 'duration safety sample', options: { limits: { maxDurationMs: 30 } }, trigger(app) {
      app.record(5);
      assert.equal(app.state.rawData.length, 2);
    } }
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const app = createHarness(scenario.options);
      app.click('btnStart');
      const { liveUpdateTimer, autoStopTimer } = app.state;
      const wakeStopsBefore = app.wake.stopCount;
      scenario.trigger(app);
      assertStopped(app, liveUpdateTimer, autoStopTimer);
      assert.equal(app.sensor.stopCount, 1);
      assert.equal(app.analysisCount(), 1);
      assert.equal(app.elements('btnCsv').disabled, false);
      assert.equal(app.wake.stopCount, wakeStopsBefore + 1);
    });
  }
});

test('back-forward restoration analyzes partial recording once without restarting sensors', () => {
  const app = createHarness();
  app.click('btnStart');
  app.record();
  const { liveUpdateTimer, autoStopTimer } = app.state;
  const staleCallback = app.sensor.callbacks[0];
  const staleAutoStop = app.timers.get(autoStopTimer).callback;
  app.window.dispatch('pagehide', { persisted: true });
  assertStopped(app, liveUpdateTimer, autoStopTimer);
  assert.equal(app.sensor.stopCount, 1);
  assert.equal(app.analysisCount(), 0);
  staleCallback({ t: 6000, ax: 1, ay: 2, az: 3 });
  staleAutoStop();
  assert.equal(app.state.rawData.length, 256);

  app.window.dispatch('pageshow', { persisted: true });
  assert.equal(app.state.statusKey, 'statusInterruptedSaved');
  assert.equal(app.state.recording, false);
  assert.equal(app.sensor.callbacks.length, 1);
  assert.equal(app.wake.startCount, 1);
  assert.equal(app.analysisCount(), 1);
  assert.equal(app.state.analysisResult.sampling.backgrounded, true);
  assert.equal(app.state.analysisResult.sampling.level, 'fair');
  assert.match(app.elements('qualityMessage').textContent, /バックグラウンド/);
  app.click('btnPackage');
  assert.equal(app.exports[0].args[0].length, 256);
  assert.equal(app.exports[0].args[1].sampling.backgrounded, true);
  app.window.dispatch('pageshow', { persisted: true });
  assert.equal(app.analysisCount(), 1);
  assert.equal(app.sensor.callbacks.length, 1);
});

test('restoring an empty interrupted recording leaves controls usable and exports disabled', () => {
  const app = createHarness();
  app.click('btnStart');
  const { liveUpdateTimer, autoStopTimer } = app.state;
  app.window.dispatch('pagehide', { persisted: true });
  app.window.dispatch('pageshow', { persisted: true });
  assertStopped(app, liveUpdateTimer, autoStopTimer);
  assert.equal(app.state.analysisResult, null);
  assert.equal(app.analysisCount(), 0);
  assert.equal(app.elements('btnPackage').disabled, true);
  assert.equal(app.elements('qualityPanel').hidden, true);
  app.click('btnStart');
  assert.equal(app.state.recording, true);
  assert.equal(app.sensor.callbacks.length, 2);
});

test('a failed sensor restart preserves the earlier measurement and export', () => {
  const app = createHarness();
  app.click('btnStart');
  app.record();
  app.click('btnStop');
  const earlierData = app.state.rawData;
  const earlierAnalysis = app.state.analysisResult;
  const wakeStarts = app.wake.startCount;
  app.sensor.fail = true;
  app.click('btnStart');
  assertStopped(app);
  assert.equal(app.state.statusKey, 'statusSensorError');
  assert.equal(app.state.rawData, earlierData);
  assert.equal(app.state.analysisResult, earlierAnalysis);
  assert.equal(app.wake.startCount, wakeStarts);
  app.click('btnCsv');
  assert.equal(app.exports[0].args[0], earlierData);
});

test('callbacks and auto-stop timers from an earlier session cannot modify a new recording', () => {
  const app = createHarness();
  app.click('btnStart');
  const oldSensorCallback = app.sensor.callbacks[0];
  const oldAutoStop = app.timers.get(app.state.autoStopTimer).callback;
  app.record(3);
  app.click('btnStop');
  app.click('btnStart');
  oldSensorCallback({ t: 1000, ax: 1, ay: 2, az: 3 });
  oldAutoStop();
  assert.equal(app.state.recording, true);
  assert.equal(app.state.rawData.length, 0);
  app.record(4);
  app.click('btnStop');
  assert.equal(app.state.analysisResult.sampleCount, 4);
  assert.equal(app.sensor.stopCount, 2);
});

test('analysis failure still releases recording resources and permits a new recording', () => {
  const app = createHarness({ analysisError: true });
  app.click('btnStart');
  app.record(3);
  const { liveUpdateTimer, autoStopTimer } = app.state;
  app.click('btnStop');
  assertStopped(app, liveUpdateTimer, autoStopTimer);
  assert.equal(app.state.statusKey, 'statusAnalysisError');
  assert.equal(app.elements('btnCsv').disabled, true);
  app.click('btnStart');
  assert.equal(app.state.recording, true);
});

test('chart failures preserve successfully analyzed recordings for export', async t => {
  for (const interrupted of [false, true]) {
    await t.test(interrupted ? 'back-forward restoration' : 'manual stop', () => {
      const app = createHarness({ chartError: true });
      app.click('btnStart');
      app.record();
      const { liveUpdateTimer, autoStopTimer } = app.state;
      if (interrupted) {
        app.window.dispatch('pagehide', { persisted: true });
        app.window.dispatch('pageshow', { persisted: true });
      } else {
        app.click('btnStop');
      }
      assertStopped(app, liveUpdateTimer, autoStopTimer);
      assert.equal(app.state.statusKey, 'statusRecordedDisplayError');
      assert.equal(app.analysisCount(), 1);
      assert.equal(app.state.analysisResult.sampleCount, 256);
      assert.equal(app.state.analysisResult.sampling.backgrounded, interrupted);
      app.click('btnPackage');
      assert.equal(app.exports[0].args[0].length, 256);
      assert.equal(app.exports[0].args[1], app.state.analysisResult);
    });
  }
});

test('wake lock preference and language update during recording without restarting the sensor', () => {
  const app = createHarness();
  assert.equal(app.wake.startCount, 0);
  assert.equal(app.elements('keepScreenAwake').checked, true);
  app.click('btnStart');
  assert.equal(app.wake.startCount, 1);
  assert.equal(app.state.wakeLockStatus, 'requesting');
  app.wake.onChange('active');
  assert.equal(app.elements('wakeLockStatus').textContent, '画面の自動消灯を防止しています。');
  app.click('btnLangToggle');
  assert.equal(app.elements('wakeLockStatus').textContent, 'Keeping the screen awake.');
  assert.equal(app.elements('waveformSummary').textContent, 'A chart summary appears after measurement or import.');

  const setting = app.elements('keepScreenAwake');
  const stopCount = app.wake.stopCount;
  setting.checked = false;
  setting.dispatch('change');
  assert.equal(app.wake.stopCount, stopCount + 1);
  assert.equal(app.elements('wakeLockStatus').textContent, 'Keeping the screen awake is turned off.');
  assert.equal(app.state.recording, true);
  setting.checked = true;
  setting.dispatch('change');
  assert.equal(app.wake.startCount, 2);
  assert.equal(app.sensor.callbacks.length, 1);

  app.document.hidden = true;
  app.document.visibilityState = 'hidden';
  app.document.dispatch('visibilitychange');
  assert.equal(app.wake.visibilityCount, 1);
  assert.equal(app.state.backgroundedDuringRecording, true);
  app.document.hidden = false;
  app.document.visibilityState = 'visible';
  app.document.dispatch('visibilitychange');
  assert.equal(app.wake.visibilityCount, 2);
  app.record();
  app.click('btnStop');
  assert.equal(app.state.analysisResult.sampling.backgrounded, true);
  assert.equal(app.state.analysisResult.sampling.level, 'fair');
  assert.equal(app.wake.stopCount, stopCount + 2);
  assert.equal(app.wake.startCount, 2);
});

test('opting out of screen wake lock still permits normal measurement and export', () => {
  const app = createHarness({ keepScreenAwake: false });
  app.click('btnStart');
  assert.equal(app.wake.startCount, 0);
  app.record(3);
  app.click('btnStop');
  app.click('btnCsv');
  assert.equal(app.exports[0].args[0].length, 3);
  const setting = app.elements('keepScreenAwake');
  setting.checked = true;
  setting.dispatch('change');
  assert.equal(app.wake.startCount, 0, 'Changing the setting while idle must not acquire a lock');
});

test('unavailable or unsupported screen wake lock does not prevent recording or export', () => {
  for (const status of ['unavailable', 'unsupported']) {
    const app = createHarness();
    app.click('btnStart');
    app.wake.onChange(status);
    assert.equal(app.state.recording, true);
    assert.equal(app.state.wakeLockStatus, status);
    app.record(3);
    app.click('btnStop');
    assert.equal(app.state.statusKey, 'statusDone');
    app.click('btnPackage');
    assert.equal(app.exports[0].args[0].length, 3);
  }
});

test('navigation without back-forward caching cleans up without doing analysis', () => {
  const app = createHarness();
  app.click('btnStart');
  app.record(3);
  const { liveUpdateTimer, autoStopTimer } = app.state;
  const wakeStops = app.wake.stopCount;
  app.window.dispatch('pagehide', { persisted: false });
  assert.equal(app.state.recording, false);
  assert.equal(app.state.stopSensor, null);
  assert.equal(app.timers.has(liveUpdateTimer), false);
  assert.equal(app.timers.has(autoStopTimer), false);
  assert.equal(app.sensor.stopCount, 1);
  assert.equal(app.wake.stopCount, wakeStops + 1);
  assert.equal(app.analysisCount(), 0);
});
