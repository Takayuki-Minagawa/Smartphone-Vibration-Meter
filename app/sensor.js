/**
 * sensor.js - Sensor check, permission handling, capability profiling
 */
const Sensor = (function () {
  let profile = null;
  const limits = typeof VibMeterLimits !== 'undefined'
    ? VibMeterLimits
    : require('./limits.js');

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function decodeProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const hasAccG = value.hasAccG === true;
    const hasAcc = value.hasAcc === true;
    const sensorAvailable = value.sensorAvailable === true && (hasAccG || hasAcc);
    const fsHz = isFiniteNumber(value.fsHz) && value.fsHz >= 0 ? value.fsHz : 0;
    const eventCount = isFiniteNumber(value.eventCount) && value.eventCount >= 0
      ? Math.floor(value.eventCount)
      : 0;

    return {
      sensorAvailable,
      needsPermission: value.needsPermission === true,
      hasAccG,
      hasAcc,
      hasRotationRate: value.hasRotationRate === true,
      fsHz,
      eventCount
    };
  }

  /** Load profile from sessionStorage (set by index.html diagnostics) */
  function loadProfile() {
    profile = null;
    try {
      const stored = sessionStorage.getItem('vibmeter_profile');
      if (stored) {
        profile = decodeProfile(JSON.parse(stored));
      }
    } catch (error) {
      // Storage can be unavailable or contain stale/corrupt data. Viewer mode is
      // safer than aborting application initialization.
      profile = null;
    }
    return profile;
  }

  function getProfile() {
    if (!profile) loadProfile();
    return profile;
  }

  function hasCompleteVector(vector) {
    return !!vector &&
      isFiniteNumber(vector.x) &&
      isFiniteNumber(vector.y) &&
      isFiniteNumber(vector.z);
  }

  function monotonicNow() {
    if (typeof performance !== 'undefined' &&
        performance && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  /** Convert one DeviceMotionEvent into the application's sample contract. */
  function readMotionEvent(event) {
    if (!event) return null;

    // Prefer linear acceleration when the browser provides all three axes. This
    // avoids filtering gravity a second time and improves low-frequency accuracy.
    let vector = null;
    let hasGravity = false;
    let source = '';
    if (hasCompleteVector(event.acceleration)) {
      vector = event.acceleration;
      source = 'linear';
    } else if (hasCompleteVector(event.accelerationIncludingGravity)) {
      vector = event.accelerationIncludingGravity;
      hasGravity = true;
      source = 'including-gravity';
    } else {
      return null;
    }

    const scale = 100; // m/s^2 -> cm/s^2
    const ax = vector.x * scale;
    const ay = vector.y * scale;
    const az = vector.z * scale;
    if (!isFiniteNumber(ax) || !isFiniteNumber(ay) || !isFiniteNumber(az) ||
        Math.abs(ax) > limits.maxAbsAccelerationCmS2 ||
        Math.abs(ay) > limits.maxAbsAccelerationCmS2 ||
        Math.abs(az) > limits.maxAbsAccelerationCmS2) {
      return null;
    }
    const eventTimestamp = isFiniteNumber(event.timeStamp) && event.timeStamp >= 0
      ? event.timeStamp
      : monotonicNow();

    return {
      t: eventTimestamp,
      ax,
      ay,
      az,
      hasGravity,
      source
    };
  }

  /**
   * Start listening to devicemotion events.
   * @param {function} callback - receives {t, ax, ay, az, hasGravity, source}
   * @returns {function} stop - call to remove listener
   */
  function startListening(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Sensor callback must be a function');
    }

    let lastTimestamp = null;
    let lastReceiptTimestamp = null;

    function handler(e) {
      const receiptTimestamp = monotonicNow();
      const sample = readMotionEvent(e);
      if (!sample) return;

      // Some privacy-hardened or older engines expose coarse, repeated, or
      // occasionally regressing Event.timeStamp values. Preserve the event
      // clock when valid; otherwise advance it by the observed receipt time so
      // every exported package satisfies the strict timestamp contract.
      if (lastTimestamp !== null && sample.t <= lastTimestamp) {
        let elapsed = receiptTimestamp - lastReceiptTimestamp;
        if (!isFiniteNumber(elapsed) || elapsed <= 0) elapsed = 0.001;
        sample.t = lastTimestamp + elapsed;
        if (!isFiniteNumber(sample.t) || sample.t <= lastTimestamp) return;
      }

      lastTimestamp = sample.t;
      lastReceiptTimestamp = receiptTimestamp;
      callback(sample);
    }

    window.addEventListener('devicemotion', handler);

    return function stop() {
      window.removeEventListener('devicemotion', handler);
    };
  }

  return {
    loadProfile,
    getProfile,
    startListening,
    decodeProfile,
    readMotionEvent
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Sensor;
}
