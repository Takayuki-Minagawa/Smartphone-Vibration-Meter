/**
 * analysis.js - Signal processing: gravity removal, RMS, peak, FFT spectrum
 */
const Analysis = (function () {
  /**
   * Remove gravity from accelerationIncludingGravity using exponential low-pass filter.
   * @param {Array} rawData - [{t, ax, ay, az, hasGravity}]
   * @param {number} alpha - filter coefficient (0-1), smaller = smoother, default 0.1
   * @returns {Array} [{t, dx, dy, dz, mag}] dynamic acceleration + magnitude
   */
  function removeGravity(rawData, alpha) {
    if (!rawData.length) return [];
    alpha = alpha || 0.1;

    const result = [];
    let gx = rawData[0].ax;
    let gy = rawData[0].ay;
    let gz = rawData[0].az;

    for (let i = 0; i < rawData.length; i++) {
      const d = rawData[i];

      if (d.hasGravity) {
        // Low-pass filter to estimate gravity
        gx = alpha * d.ax + (1 - alpha) * gx;
        gy = alpha * d.ay + (1 - alpha) * gy;
        gz = alpha * d.az + (1 - alpha) * gz;

        const dx = d.ax - gx;
        const dy = d.ay - gy;
        const dz = d.az - gz;
        const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);

        result.push({ t: d.t, dx, dy, dz, mag });
      } else {
        // Already linear acceleration (no gravity)
        const mag = Math.sqrt(d.ax * d.ax + d.ay * d.ay + d.az * d.az);
        result.push({ t: d.t, dx: d.ax, dy: d.ay, dz: d.az, mag });
      }
    }

    return result;
  }

  /**
   * Calculate RMS of magnitude array
   */
  function calcRMS(dynamicData) {
    if (!dynamicData.length) return 0;
    let sum = 0;
    for (let i = 0; i < dynamicData.length; i++) {
      sum += dynamicData[i].mag * dynamicData[i].mag;
    }
    return Math.sqrt(sum / dynamicData.length);
  }

  /**
   * Calculate peak (max absolute magnitude)
   */
  function calcPeak(dynamicData) {
    if (!dynamicData.length) return 0;
    let max = 0;
    for (let i = 0; i < dynamicData.length; i++) {
      if (dynamicData[i].mag > max) max = dynamicData[i].mag;
    }
    return max;
  }

  /**
   * Calculate peak-to-peak
   */
  function calcPeakToPeak(dynamicData) {
    if (!dynamicData.length) return 0;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < dynamicData.length; i++) {
      const v = dynamicData[i].mag;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min;
  }

  /**
   * Estimate sampling frequency from timestamps
   */
  function estimateFs(rawData) {
    if (rawData.length < 2) return 0;
    const intervals = [];
    for (let i = 1; i < rawData.length; i++) {
      intervals.push(rawData[i].t - rawData[i - 1].t);
    }
    const avg = intervals.reduce(function (a, b) { return a + b; }, 0) / intervals.length;
    return avg > 0 ? 1000 / avg : 0;
  }

  /**
   * Radix-2 Cooley-Tukey FFT (in-place)
   * @param {Float64Array} re - real part
   * @param {Float64Array} im - imaginary part
   */
  function fft(re, im) {
    var n = re.length;
    if (n <= 1) return;

    // Bit-reversal permutation
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        var tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }

    // FFT butterfly
    for (var len = 2; len <= n; len *= 2) {
      var ang = -2 * Math.PI / len;
      var wRe = Math.cos(ang);
      var wIm = Math.sin(ang);
      for (var i = 0; i < n; i += len) {
        var curRe = 1, curIm = 0;
        for (var j = 0; j < len / 2; j++) {
          var uRe = re[i + j], uIm = im[i + j];
          var vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
          var vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
          re[i + j] = uRe + vRe;
          im[i + j] = uIm + vIm;
          re[i + j + len / 2] = uRe - vRe;
          im[i + j + len / 2] = uIm - vIm;
          var newCurRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = newCurRe;
        }
      }
    }
  }

  /**
   * Hanning window
   */
  function hanningWindow(n) {
    var w = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    }
    return w;
  }

  /**
   * Compute power spectrum
   * @param {Array} dynamicData - [{t, dx, dy, dz, mag}]
   * @param {number} fs - sampling frequency
   * @returns {{freqs: Float64Array, power: Float64Array, fPeak: number}}
   */
  function computeSpectrum(dynamicData, fs) {
    if (dynamicData.length < 4) {
      return { freqs: new Float64Array(0), power: new Float64Array(0), fPeak: 0 };
    }

    // Zero-pad to next power of 2
    var rawLen = dynamicData.length;
    var n = 1;
    while (n < rawLen) n *= 2;

    var re = new Float64Array(n);
    var im = new Float64Array(n);
    var win = hanningWindow(rawLen);

    // Apply window and fill real part
    for (var i = 0; i < rawLen; i++) {
      re[i] = dynamicData[i].mag * win[i];
    }
    // Remaining are zero (zero-padded)

    fft(re, im);

    // Compute single-sided power spectrum
    var halfN = Math.floor(n / 2);
    var freqs = new Float64Array(halfN);
    var power = new Float64Array(halfN);
    var maxPower = 0;
    var fPeak = 0;

    for (var i = 0; i < halfN; i++) {
      freqs[i] = i * fs / n;
      power[i] = (re[i] * re[i] + im[i] * im[i]) / n;

      // Skip DC component (i=0) for peak detection
      if (i > 0 && power[i] > maxPower) {
        maxPower = power[i];
        fPeak = freqs[i];
      }
    }

    return { freqs: freqs, power: power, fPeak: fPeak };
  }

  /**
   * Run full analysis pipeline
   * @param {Array} rawData - [{t, ax, ay, az, hasGravity}]
   * @returns {Object} analysis results
   */
  function analyze(rawData) {
    var fs = estimateFs(rawData);
    var dynamic = removeGravity(rawData);
    var rms = calcRMS(dynamic);
    var peak = calcPeak(dynamic);
    var peakToPeak = calcPeakToPeak(dynamic);

    var spectrum = { freqs: new Float64Array(0), power: new Float64Array(0), fPeak: 0 };
    if (fs >= 10 && dynamic.length >= 16) {
      spectrum = computeSpectrum(dynamic, fs);
    }

    return {
      fsHz: fs,
      rms: rms,
      peak: peak,
      peakToPeak: peakToPeak,
      fPeak: spectrum.fPeak,
      dynamic: dynamic,
      spectrum: spectrum,
      sampleCount: rawData.length,
      durationMs: rawData.length > 1 ? rawData[rawData.length - 1].t - rawData[0].t : 0
    };
  }

  return {
    removeGravity: removeGravity,
    calcRMS: calcRMS,
    calcPeak: calcPeak,
    calcPeakToPeak: calcPeakToPeak,
    estimateFs: estimateFs,
    computeSpectrum: computeSpectrum,
    analyze: analyze
  };
})();
