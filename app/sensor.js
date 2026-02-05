/**
 * sensor.js - Sensor check, permission handling, capability profiling
 */
const Sensor = (function () {
  let profile = null;

  /** Load profile from sessionStorage (set by index.html diagnostics) */
  function loadProfile() {
    const stored = sessionStorage.getItem('vibmeter_profile');
    if (stored) {
      profile = JSON.parse(stored);
    }
    return profile;
  }

  function getProfile() {
    if (!profile) loadProfile();
    return profile;
  }

  /**
   * Start listening to devicemotion events.
   * @param {function} callback - receives {t, ax, ay, az, gx, gy, gz, rx, ry, rz}
   * @returns {function} stop - call to remove listener
   */
  function startListening(callback) {
    const useAccG = profile && profile.hasAccG;
    const scale = 100; // m/s^2 -> cm/s^2

    function handler(e) {
      const now = performance.now();
      let ax = 0, ay = 0, az = 0;

      if (useAccG && e.accelerationIncludingGravity) {
        ax = e.accelerationIncludingGravity.x || 0;
        ay = e.accelerationIncludingGravity.y || 0;
        az = e.accelerationIncludingGravity.z || 0;
      } else if (e.acceleration) {
        ax = e.acceleration.x || 0;
        ay = e.acceleration.y || 0;
        az = e.acceleration.z || 0;
      }

      callback({
        t: now,
        ax: ax * scale,
        ay: ay * scale,
        az: az * scale,
        hasGravity: useAccG
      });
    }

    window.addEventListener('devicemotion', handler);

    return function stop() {
      window.removeEventListener('devicemotion', handler);
    };
  }

  return {
    loadProfile,
    getProfile,
    startListening
  };
})();
