'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Analysis = require('../app/analysis.js');
const Limits = require('../app/limits.js');

function approximately(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message || `${actual} is not within ${tolerance} of ${expected}`
  );
}

function makeUniformSine({ fs = 50, seconds = 10, frequency = 5, amplitude = 100 } = {}) {
  const count = Math.round(fs * seconds);
  return Array.from({ length: count }, (_, i) => {
    const t = i * 1000 / fs;
    return {
      t,
      ax: amplitude * Math.sin(2 * Math.PI * frequency * t / 1000),
      ay: 0,
      az: 0,
      hasGravity: false
    };
  });
}

test('analyzeSampling reports a stable 50 Hz record as good', () => {
  const raw = makeUniformSine({ fs: 50, seconds: 10 });
  const quality = Analysis.analyzeSampling(raw);

  approximately(quality.medianDtMs, 20, 1e-9);
  approximately(quality.fsHz, 50, 1e-9);
  approximately(quality.jitterMs, 0, 1e-9);
  approximately(quality.jitterPercent, 0, 1e-9);
  approximately(quality.maxGapRatio, 1, 1e-9);
  assert.equal(quality.estimatedDropped, 0);
  approximately(quality.completenessPercent, 100, 1e-9);
  approximately(quality.nyquistHz, 25, 1e-9);
  approximately(quality.frequencyResolutionHz, 0.1, 1e-12);
  assert.equal(quality.level, 'good');
  assert.equal(quality.spectrumUsable, true);
});

test('analyzeSampling detects jitter and dropped samples', () => {
  const raw = [];
  let t = 0;
  for (let i = 0; i < 300; i++) {
    if (i > 0) {
      t += i % 2 ? 18 : 22;
      if (i === 150) t += 40;
    }
    raw.push({ t, ax: 0, ay: 0, az: 0, hasGravity: false });
  }

  const quality = Analysis.analyzeSampling(raw);
  assert.ok(quality.jitterMs > 0);
  assert.ok(quality.jitterPercent > 0);
  assert.ok(quality.maxGapMs >= 62);
  assert.ok(quality.maxGapRatio > 3);
  assert.ok(quality.estimatedDropped >= 2);
  assert.ok(quality.completenessPercent < 100);
  assert.equal(quality.level, 'poor');
});

test('5 Hz single-axis vibration uses the vector PSD without frequency doubling', () => {
  const result = Analysis.analyze(makeUniformSine({
    fs: 100,
    seconds: 10,
    frequency: 5,
    amplitude: 100
  }));

  approximately(result.fPeak, 5, result.spectrum.vector.binWidthHz);
  assert.equal(result.dominantAxis, 'x');
  assert.equal(result.spectrum.vector.quantity, 'powerSpectralDensity');
  assert.equal(result.spectrumThird.vector.quantity, 'bandRms');
  assert.ok(result.spectrumThird.vector.freqs.length > 0);
  assert.ok(result.spectrum.mag.fPeak > 9.5 && result.spectrum.mag.fPeak < 10.5);
});

test('vector PSD is invariant to an orthogonal axis rotation', () => {
  const original = makeUniformSine({ fs: 100, seconds: 10, frequency: 5, amplitude: 100 });
  const angle = Math.PI / 3;
  const rotated = original.map((sample) => ({
    t: sample.t,
    ax: sample.ax * Math.cos(angle),
    ay: sample.ax * Math.sin(angle),
    az: 0,
    hasGravity: false
  }));

  const originalResult = Analysis.analyze(original);
  const rotatedResult = Analysis.analyze(rotated);
  approximately(rotatedResult.fPeak, originalResult.fPeak, 1e-12);
  for (let i = 0; i < originalResult.spectrum.vector.power.length; i++) {
    approximately(
      rotatedResult.spectrum.vector.power[i],
      originalResult.spectrum.vector.power[i],
      Math.max(1e-12, originalResult.spectrum.vector.power[i] * 1e-10)
    );
  }
});

test('irregular samples are resampled before spectral analysis', () => {
  const pattern = [-2, 1, 2, -1];
  const raw = [];
  let t = 0;
  for (let i = 0; i < 500; i++) {
    if (i > 0) t += 20 + pattern[i % pattern.length];
    raw.push({
      t,
      ax: 80 * Math.sin(2 * Math.PI * 5 * t / 1000),
      ay: 0,
      az: 0,
      hasGravity: false
    });
  }

  const result = Analysis.analyze(raw);
  assert.equal(result.sampling.spectrumUsable, true);
  assert.ok(result.resampledSampleCount > 450);
  approximately(result.fPeak, 5, 0.15);
  assert.equal(result.dominantAxis, 'x');
});

test('time-domain metrics preserve observed peaks instead of interpolated values', () => {
  const times = [0, 20, 32, 52, 72];
  const raw = times.map((t, index) => ({
    t,
    ax: index === 2 ? 100 : 0,
    ay: 0,
    az: 0,
    hasGravity: false
  }));

  const result = Analysis.analyze(raw);
  approximately(result.peak, 100, 1e-12);
  approximately(result.rms, 100 / Math.sqrt(raw.length), 1e-12);
});

test('poor timing quality suppresses the spectrum instead of showing conflicting results', () => {
  const raw = [];
  let t = 0;
  for (let i = 0; i < 300; i++) {
    if (i > 0) t += i % 2 ? 17 : 23;
    raw.push({
      t,
      ax: 100 * Math.sin(2 * Math.PI * 5 * t / 1000),
      ay: 0,
      az: 0,
      hasGravity: false
    });
  }

  const result = Analysis.analyze(raw);
  assert.equal(result.sampling.level, 'poor');
  assert.equal(result.sampling.spectrumUsable, false);
  assert.equal(result.spectrum.vector.freqs.length, 0);
  assert.equal(result.fPeak, 0);
});

test('a record shorter than the minimum resolvable duration suppresses the spectrum', () => {
  const result = Analysis.analyze(makeUniformSine({
    fs: 100,
    seconds: 0.16,
    frequency: 10,
    amplitude: 100
  }));

  assert.equal(result.sampleCount, 16);
  assert.equal(result.sampling.level, 'insufficient');
  assert.equal(result.sampling.spectrumUsable, false);
  assert.equal(result.fPeak, 0);
  assert.equal(result.spectrum.vector.freqs.length, 0);
});

test('axis peak-to-peak keeps the conventional signed definition', () => {
  const result = Analysis.analyze(makeUniformSine({
    fs: 100,
    seconds: 2,
    frequency: 5,
    amplitude: 100
  }));

  approximately(result.axisPeakToPeak.x, 200, 1e-9);
  approximately(result.axisPeakToPeak.y, 0, 1e-12);
  approximately(result.magnitudeRange, 100, 1e-9);
});

test('single-sided PSD approximately satisfies Parseval for a sine wave', () => {
  const fs = 100;
  const amplitude = 50;
  const series = Array.from({ length: 1024 }, (_, i) =>
    12 + amplitude * Math.sin(2 * Math.PI * 5 * i / fs)
  );
  const spectrum = Analysis.computeSpectrumSeries(series, fs);
  const integratedMeanSquare = Array.from(spectrum.power)
    .reduce((sum, value) => sum + value * spectrum.binWidthHz, 0);
  const expectedMeanSquare = amplitude * amplitude / 2;

  assert.equal(spectrum.quantity, 'powerSpectralDensity');
  approximately(integratedMeanSquare, expectedMeanSquare, expectedMeanSquare * 0.02);
});

test('PSD has no factor-of-two discontinuity at the 1024/1025 zero-padding boundary', () => {
  const fs = 100;
  function spectrumForLength(length) {
    const series = Array.from({ length }, (_, i) =>
      100 * Math.sin(2 * Math.PI * 5 * i / fs)
    );
    return Analysis.computeSpectrumSeries(series, fs);
  }

  const before = spectrumForLength(1024);
  const after = spectrumForLength(1025);
  const beforePeak = Math.max(...before.power);
  const afterPeak = Math.max(...after.power);
  const peakRatio = afterPeak / beforePeak;
  const beforeIntegral = Array.from(before.power)
    .reduce((sum, value) => sum + value * before.binWidthHz, 0);
  const afterIntegral = Array.from(after.power)
    .reduce((sum, value) => sum + value * after.binWidthHz, 0);

  assert.ok(peakRatio > 0.85 && peakRatio < 1.15, `unexpected peak ratio ${peakRatio}`);
  approximately(afterIntegral / beforeIntegral, 1, 0.02);
});

test('time-based gravity removal has a consistent response across sample rates', () => {
  const rmsValues = [25, 50, 100].map((fs) => {
    const raw = [];
    const count = fs * 30;
    for (let i = 0; i < count; i++) {
      const t = i * 1000 / fs;
      raw.push({
        t,
        ax: 100 * Math.sin(2 * Math.PI * t / 1000),
        ay: 0,
        az: 981,
        hasGravity: true
      });
    }
    const dynamic = Analysis.removeGravity(raw);
    return Analysis.calcRMS(dynamic.slice(fs * 5));
  });

  const min = Math.min(...rmsValues);
  const max = Math.max(...rmsValues);
  assert.ok(min > 65, `unexpected attenuation: ${rmsValues.join(', ')}`);
  assert.ok(max / min < 1.02, `sample-rate-dependent response: ${rmsValues.join(', ')}`);
});

test('one-third-octave output integrates PSD into band RMS', () => {
  const fs = 100;
  const amplitude = 20;
  const series = Array.from({ length: 2048 }, (_, i) =>
    amplitude * Math.sin(2 * Math.PI * 5 * i / fs)
  );
  const spectrum = Analysis.computeSpectrumSeries(series, fs);
  const octave = Analysis.computeThirdOctaveFromPower(
    spectrum.freqs,
    spectrum.power,
    0.5,
    fs / 2
  );
  let closest = 0;
  for (let i = 1; i < octave.freqs.length; i++) {
    if (Math.abs(octave.freqs[i] - 5) < Math.abs(octave.freqs[closest] - 5)) closest = i;
  }

  assert.equal(octave.quantity, 'bandRms');
  assert.equal(octave.power, octave.rms);
  approximately(octave.rms[closest], amplitude / Math.sqrt(2), 0.5);
});

test('one-third-octave conversion accepts the legacy spectrum shape without vector', () => {
  const fs = 100;
  const series = Array.from({ length: 256 }, (_, i) =>
    10 * Math.sin(2 * Math.PI * 5 * i / fs)
  );
  const component = Analysis.computeSpectrumSeries(series, fs);
  const zero = Analysis.computeSpectrumSeries(new Array(256).fill(0), fs);
  const legacy = { mag: component, x: component, y: zero, z: zero };

  const result = Analysis.computeThirdOctaveSpectrum(legacy, fs);
  assert.ok(result.vector.freqs.length > 0);
  assert.deepEqual(Array.from(result.vector.power), Array.from(result.mag.power));
});

test('analysis rejects acceleration outside the shared safe numeric range', () => {
  const raw = makeUniformSine({ fs: 50, seconds: 3 });
  raw[10].ax = Limits.maxAbsAccelerationCmS2 + 1;
  assert.throws(() => Analysis.analyze(raw), /Invalid acceleration sample/);
});
