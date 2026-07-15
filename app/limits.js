/**
 * limits.js - Shared safety and analysis limits
 *
 * Keep recording, import validation, sensor normalization, and signal
 * processing on one contract so files exported by this app remain importable.
 */
var VibMeterLimits = Object.freeze({
  maxJSONSize: 25 * 1024 * 1024,
  maxSamples: 120000,
  maxDurationMs: 60 * 60 * 1000,
  // Deliberately far above a phone accelerometer's physical range while still
  // preventing hostile values from overflowing squared/FFT calculations.
  maxAbsAccelerationCmS2: 10000000,
  minSpectrumSamples: 16,
  minSpectrumFsHz: 10,
  minSpectrumDurationMs: 2000,
  maxSpectrumResolutionHz: 0.5,
  minPeakHz: 0.5
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VibMeterLimits;
}
