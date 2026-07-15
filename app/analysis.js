/**
 * analysis.js - Sampling quality and vibration signal processing
 */
const Analysis = (function () {
  var limits = typeof VibMeterLimits !== 'undefined'
    ? VibMeterLimits
    : require('./limits.js');
  var DEFAULT_GRAVITY_CUTOFF_HZ = 0.3;
  var MIN_SPECTRUM_SAMPLES = limits.minSpectrumSamples;
  var MIN_SPECTRUM_FS_HZ = limits.minSpectrumFsHz;
  var MIN_SPECTRUM_DURATION_MS = limits.minSpectrumDurationMs;
  var MAX_SPECTRUM_RESOLUTION_HZ = limits.maxSpectrumResolutionHz;
  var MIN_PEAK_HZ = limits.minPeakHz;
  var MAX_ABS_ACCELERATION = limits.maxAbsAccelerationCmS2;

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function vectorMagnitude(x, y, z) {
    var scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
    if (scale === 0) return 0;
    return scale * Math.sqrt(
      (x / scale) * (x / scale) +
      (y / scale) * (y / scale) +
      (z / scale) * (z / scale)
    );
  }

  function assertValidRawSample(sample) {
    if (!sample || !isFiniteNumber(sample.t) ||
        !isFiniteNumber(sample.ax) || !isFiniteNumber(sample.ay) ||
        !isFiniteNumber(sample.az) ||
        Math.abs(sample.ax) > MAX_ABS_ACCELERATION ||
        Math.abs(sample.ay) > MAX_ABS_ACCELERATION ||
        Math.abs(sample.az) > MAX_ABS_ACCELERATION) {
      throw new Error('Invalid acceleration sample.');
    }
  }

  function median(values) {
    if (!values || values.length === 0) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function emptySpectrum(quantity) {
    return {
      freqs: new Float64Array(0),
      power: new Float64Array(0),
      fPeak: 0,
      binWidthHz: 0,
      quantity: quantity || 'powerSpectralDensity'
    };
  }

  /**
   * Describe the timing quality of a sampled record.
   * Sampling frequency is based on the median positive interval so that an
   * isolated browser scheduling pause does not shift the whole frequency axis.
   */
  function analyzeSampling(rawData) {
    rawData = Array.isArray(rawData) ? rawData : [];
    var sampleCount = rawData.length;
    var intervals = [];
    var invalidIntervals = 0;
    var allZeroSignal = sampleCount > 0;

    for (var sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      var sample = rawData[sampleIndex];
      if (sample && (sample.ax !== 0 || sample.ay !== 0 || sample.az !== 0)) {
        allZeroSignal = false;
        break;
      }
    }

    for (var i = 1; i < sampleCount; i++) {
      var previousT = rawData[i - 1] && rawData[i - 1].t;
      var currentT = rawData[i] && rawData[i].t;
      var dt = currentT - previousT;
      if (isFiniteNumber(previousT) && isFiniteNumber(currentT) && dt > 0) {
        intervals.push(dt);
      } else {
        invalidIntervals++;
      }
    }

    var medianDt = median(intervals);
    var fsHz = medianDt > 0 ? 1000 / medianDt : 0;
    var deviations = [];
    var maxGapMs = 0;
    var estimatedDropped = 0;

    for (var j = 0; j < intervals.length; j++) {
      if (intervals[j] > maxGapMs) maxGapMs = intervals[j];
      if (medianDt > 0) {
        estimatedDropped += Math.max(0, Math.round(intervals[j] / medianDt) - 1);
        // Keep missing-sample gaps out of the jitter statistic. They are
        // reported separately through maxGap and estimatedDropped.
        if (intervals[j] <= medianDt * 1.5) {
          deviations.push(intervals[j] - medianDt);
        }
      }
    }

    var jitterSquareSum = 0;
    for (var deviationIndex = 0; deviationIndex < deviations.length; deviationIndex++) {
      jitterSquareSum += deviations[deviationIndex] * deviations[deviationIndex];
    }
    var jitterMs = deviations.length > 0
      ? Math.sqrt(jitterSquareSum / deviations.length)
      : 0;
    var jitterPercent = medianDt > 0 ? 100 * jitterMs / medianDt : 0;
    var maxGapRatio = medianDt > 0 ? maxGapMs / medianDt : 0;
    var expectedSamples = sampleCount + estimatedDropped;
    var completenessPercent = expectedSamples > 0
      ? 100 * sampleCount / expectedSamples
      : 0;

    var firstT = sampleCount > 0 && rawData[0] ? rawData[0].t : 0;
    var lastT = sampleCount > 0 && rawData[sampleCount - 1]
      ? rawData[sampleCount - 1].t
      : 0;
    var durationMs = isFiniteNumber(firstT) && isFiniteNumber(lastT) && lastT > firstT
      ? lastT - firstT
      : 0;
    var nyquistHz = fsHz > 0 ? fsHz / 2 : 0;
    var resampledCount = medianDt > 0 && durationMs > 0
      ? Math.floor(durationMs / medianDt + 1e-9) + 1
      : 0;
    var frequencyResolutionHz = fsHz > 0 && resampledCount > 0
      ? fsHz / resampledCount
      : 0;

    var enoughSamples = sampleCount >= MIN_SPECTRUM_SAMPLES &&
      intervals.length >= MIN_SPECTRUM_SAMPLES - 1 &&
      fsHz >= MIN_SPECTRUM_FS_HZ &&
      durationMs >= MIN_SPECTRUM_DURATION_MS &&
      frequencyResolutionHz > 0 &&
      frequencyResolutionHz <= MAX_SPECTRUM_RESOLUTION_HZ;
    var level = 'insufficient';
    if (enoughSamples) {
      if (invalidIntervals === 0 && jitterPercent <= 2 && maxGapRatio <= 1.5 &&
          completenessPercent >= 98) {
        level = 'good';
      } else if (invalidIntervals === 0 && jitterPercent <= 10 && maxGapRatio <= 3 &&
                 completenessPercent >= 90) {
        level = 'fair';
      } else {
        level = 'poor';
      }
    }

    // An all-zero linear-acceleration record can mean a genuinely stationary
    // device or a browser that exposes a placeholder vector. Keep the samples,
    // but do not present a frequency result without evidence of a signal.
    if (allZeroSignal && enoughSamples) level = 'poor';

    var spectrumUsable = !allZeroSignal && (level === 'good' || level === 'fair');

    return {
      medianDtMs: medianDt,
      fsHz: fsHz,
      jitterMs: jitterMs,
      jitterPercent: jitterPercent,
      maxGapMs: maxGapMs,
      maxGapRatio: maxGapRatio,
      estimatedDropped: estimatedDropped,
      completenessPercent: completenessPercent,
      nyquistHz: nyquistHz,
      frequencyResolutionHz: frequencyResolutionHz,
      level: level,
      spectrumUsable: spectrumUsable,
      sampleCount: sampleCount,
      durationMs: durationMs,
      invalidIntervals: invalidIntervals,
      allZeroSignal: allZeroSignal
    };
  }

  /**
   * Remove gravity from accelerationIncludingGravity.
   *
   * The default low-pass coefficient is derived from each timestamp interval
   * and a physical cutoff frequency (0.3 Hz). Passing a number retains the old
   * API and uses that number as a fixed alpha.
   *
   * @param {Array} rawData - [{t, ax, ay, az, hasGravity}]
   * @param {number|Object} options - legacy alpha, or {cutoffHz}
   * @returns {Array} [{t, dx, dy, dz, mag}]
   */
  function removeGravity(rawData, options) {
    if (!rawData || !rawData.length) return [];

    var fixedAlpha = null;
    var cutoffHz = DEFAULT_GRAVITY_CUTOFF_HZ;
    if (typeof options === 'number' && isFinite(options)) {
      fixedAlpha = clamp(options, 0, 1);
    } else if (options && isFiniteNumber(options.cutoffHz)) {
      cutoffHz = Math.max(0, options.cutoffHz);
    }

    var sampling = analyzeSampling(rawData);
    var fallbackDtSeconds = sampling.medianDtMs > 0
      ? sampling.medianDtMs / 1000
      : 1 / 50;
    var result = [];
    var gx = 0;
    var gy = 0;
    var gz = 0;
    var gravityInitialized = false;
    var previousT = null;
    var previousHasGravity = null;
    var previousAx = 0;
    var previousAy = 0;
    var previousAz = 0;
    var previousDx = 0;
    var previousDy = 0;
    var previousDz = 0;

    for (var i = 0; i < rawData.length; i++) {
      var d = rawData[i];
      assertValidRawSample(d);
      var dx = undefined;
      var dy = undefined;
      var dz = undefined;

      if (d.hasGravity) {
        var resumingFromLinear = previousHasGravity === false &&
          isFiniteNumber(previousT);
        if (!gravityInitialized || resumingFromLinear) {
          if (previousHasGravity === false) {
            var bridgeDx = previousDx;
            var bridgeDy = previousDy;
            var bridgeDz = previousDz;
            var bridgeDtSeconds = isFiniteNumber(previousT) && d.t > previousT
              ? (d.t - previousT) / 1000
              : fallbackDtSeconds;
            if (bridgeDtSeconds > fallbackDtSeconds * 3) {
              // Do not carry a stale linear value across a genuine event gap.
              bridgeDx = 0;
              bridgeDy = 0;
              bridgeDz = 0;
            }
            // Re-anchor gravity from the last known linear acceleration. This
            // bridges intermittent acceleration/includingGravity sources
            // without treating their different baselines as a vibration spike.
            gx = d.ax - bridgeDx;
            gy = d.ay - bridgeDy;
            gz = d.az - bridgeDz;
            dx = bridgeDx;
            dy = bridgeDy;
            dz = bridgeDz;
          } else {
            gx = d.ax;
            gy = d.ay;
            gz = d.az;
          }
          gravityInitialized = true;
        } else {
          var dtSeconds = fallbackDtSeconds;
          if (isFiniteNumber(previousT) && isFiniteNumber(d.t) && d.t > previousT) {
            dtSeconds = (d.t - previousT) / 1000;
          }
          if (fixedAlpha !== null) {
            gx = fixedAlpha * d.ax + (1 - fixedAlpha) * gx;
            gy = fixedAlpha * d.ay + (1 - fixedAlpha) * gy;
            gz = fixedAlpha * d.az + (1 - fixedAlpha) * gz;
          } else if (cutoffHz === 0) {
            dx = previousDx + d.ax - previousAx;
            dy = previousDy + d.ay - previousAy;
            dz = previousDz + d.az - previousAz;
            gx = d.ax - dx;
            gy = d.ay - dy;
            gz = d.az - dz;
          } else {
            // Bilinear-transform high-pass. Both coefficients depend on the
            // actual interval, keeping the cutoff stable across event rates.
            var tau = 1 / (2 * Math.PI * cutoffHz);
            var denominator = 2 * tau + dtSeconds;
            var feedback = (2 * tau - dtSeconds) / denominator;
            var feedforward = 2 * tau / denominator;
            dx = feedback * previousDx + feedforward * (d.ax - previousAx);
            dy = feedback * previousDy + feedforward * (d.ay - previousAy);
            dz = feedback * previousDz + feedforward * (d.az - previousAz);
            gx = d.ax - dx;
            gy = d.ay - dy;
            gz = d.az - dz;
          }
        }

        if (dx === undefined) dx = d.ax - gx;
        if (dy === undefined) dy = d.ay - gy;
        if (dz === undefined) dz = d.az - gz;
      } else {
        // DeviceMotionEvent.acceleration is already gravity-free.
        dx = d.ax;
        dy = d.ay;
        dz = d.az;
      }

      // Maintain one continuous state timeline regardless of which browser
      // vector was available for this event. For linear samples, reconstruct an
      // equivalent including-gravity input from the current gravity estimate.
      if (d.hasGravity) {
        previousAx = d.ax;
        previousAy = d.ay;
        previousAz = d.az;
      } else if (gravityInitialized) {
        previousAx = gx + dx;
        previousAy = gy + dy;
        previousAz = gz + dz;
      } else {
        previousAx = dx;
        previousAy = dy;
        previousAz = dz;
      }
      previousDx = dx;
      previousDy = dy;
      previousDz = dz;
      previousT = d.t;
      previousHasGravity = d.hasGravity === true;

      var mag = vectorMagnitude(dx, dy, dz);
      result.push({ t: d.t, dx: dx, dy: dy, dz: dz, mag: mag });
    }

    return result;
  }

  /**
   * Linearly interpolate dynamic acceleration onto an equally spaced grid.
   * The input is not mutated.
   */
  function resampleDynamic(dynamicData, fsHz) {
    if (!Array.isArray(dynamicData) || dynamicData.length === 0 ||
        !isFiniteNumber(fsHz) || fsHz <= 0) {
      return [];
    }

    var points = [];
    for (var i = 0; i < dynamicData.length; i++) {
      var d = dynamicData[i];
      if (!d || !isFiniteNumber(d.t) || !isFiniteNumber(d.dx) ||
          !isFiniteNumber(d.dy) || !isFiniteNumber(d.dz)) {
        continue;
      }
      points.push({ t: d.t, dx: d.dx, dy: d.dy, dz: d.dz });
    }
    points.sort(function (a, b) { return a.t - b.t; });

    var unique = [];
    for (var j = 0; j < points.length; j++) {
      if (unique.length && points[j].t === unique[unique.length - 1].t) {
        unique[unique.length - 1] = points[j];
      } else {
        unique.push(points[j]);
      }
    }
    if (unique.length < 2) return [];

    var stepMs = 1000 / fsHz;
    var firstT = unique[0].t;
    var lastT = unique[unique.length - 1].t;
    var count = Math.floor((lastT - firstT) / stepMs + 1e-9) + 1;
    if (count < 2 || count > 1000000) return [];

    var result = [];
    var right = 1;
    for (var k = 0; k < count; k++) {
      var targetT = firstT + k * stepMs;
      while (right < unique.length - 1 && unique[right].t < targetT) right++;
      var leftPoint = unique[right - 1];
      var rightPoint = unique[right];
      var span = rightPoint.t - leftPoint.t;
      var ratio = span > 0 ? (targetT - leftPoint.t) / span : 0;
      ratio = clamp(ratio, 0, 1);
      var dx = leftPoint.dx + ratio * (rightPoint.dx - leftPoint.dx);
      var dy = leftPoint.dy + ratio * (rightPoint.dy - leftPoint.dy);
      var dz = leftPoint.dz + ratio * (rightPoint.dz - leftPoint.dz);
      result.push({
        t: targetT,
        dx: dx,
        dy: dy,
        dz: dz,
        mag: vectorMagnitude(dx, dy, dz)
      });
    }
    return result;
  }

  /** Calculate resultant-vector RMS. */
  function calcRMS(dynamicData) {
    if (!dynamicData || !dynamicData.length) return 0;
    var sum = 0;
    for (var i = 0; i < dynamicData.length; i++) {
      sum += dynamicData[i].mag * dynamicData[i].mag;
    }
    return Math.sqrt(sum / dynamicData.length);
  }

  /** Calculate maximum resultant acceleration. */
  function calcPeak(dynamicData) {
    if (!dynamicData || !dynamicData.length) return 0;
    var max = 0;
    for (var i = 0; i < dynamicData.length; i++) {
      if (dynamicData[i].mag > max) max = dynamicData[i].mag;
    }
    return max;
  }

  /** Retained for export compatibility: range of the resultant magnitude. */
  function calcPeakToPeak(dynamicData) {
    if (!dynamicData || !dynamicData.length) return 0;
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < dynamicData.length; i++) {
      var value = dynamicData[i].mag;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return max - min;
  }

  /** Calculate conventional signed peak-to-peak values for each axis. */
  function calcAxisPeakToPeak(dynamicData) {
    var result = { x: 0, y: 0, z: 0 };
    if (!dynamicData || !dynamicData.length) return result;
    var min = { x: Infinity, y: Infinity, z: Infinity };
    var max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (var i = 0; i < dynamicData.length; i++) {
      var sample = dynamicData[i];
      if (sample.dx < min.x) min.x = sample.dx;
      if (sample.dx > max.x) max.x = sample.dx;
      if (sample.dy < min.y) min.y = sample.dy;
      if (sample.dy > max.y) max.y = sample.dy;
      if (sample.dz < min.z) min.z = sample.dz;
      if (sample.dz > max.z) max.z = sample.dz;
    }
    result.x = max.x - min.x;
    result.y = max.y - min.y;
    result.z = max.z - min.z;
    return result;
  }

  /** Estimate sampling frequency using the robust median interval. */
  function estimateFs(rawData) {
    return analyzeSampling(rawData).fsHz;
  }

  /** Radix-2 Cooley-Tukey FFT (in-place). */
  function fft(re, im) {
    var n = re.length;
    if (n <= 1) return;

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

    for (var len = 2; len <= n; len *= 2) {
      var angle = -2 * Math.PI / len;
      var wRe = Math.cos(angle);
      var wIm = Math.sin(angle);
      for (var offset = 0; offset < n; offset += len) {
        var currentRe = 1;
        var currentIm = 0;
        for (var index = 0; index < len / 2; index++) {
          var evenRe = re[offset + index];
          var evenIm = im[offset + index];
          var oddRe = re[offset + index + len / 2] * currentRe -
            im[offset + index + len / 2] * currentIm;
          var oddIm = re[offset + index + len / 2] * currentIm +
            im[offset + index + len / 2] * currentRe;
          re[offset + index] = evenRe + oddRe;
          im[offset + index] = evenIm + oddIm;
          re[offset + index + len / 2] = evenRe - oddRe;
          im[offset + index + len / 2] = evenIm - oddIm;
          var nextRe = currentRe * wRe - currentIm * wIm;
          currentIm = currentRe * wIm + currentIm * wRe;
          currentRe = nextRe;
        }
      }
    }
  }

  function hanningWindow(n) {
    var window = new Float64Array(n);
    if (n === 1) {
      window[0] = 1;
      return window;
    }
    for (var i = 0; i < n; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    }
    return window;
  }

  function peakIndex(freqs, power, minPeakHz) {
    var maxPower = 0;
    var result = -1;
    for (var i = 1; i < power.length; i++) {
      if (freqs[i] >= minPeakHz && power[i] > maxPower) {
        maxPower = power[i];
        result = i;
      }
    }
    return result;
  }

  /**
   * Compute a detrended, Hann-windowed, single-sided power spectral density.
   * power is retained as the data property for existing chart consumers.
   */
  function computeSpectrumSeries(series, fs) {
    if (!series || series.length < 4 || !isFiniteNumber(fs) || fs <= 0) {
      return emptySpectrum('powerSpectralDensity');
    }

    var rawLen = series.length;
    var mean = 0;
    for (var i = 0; i < rawLen; i++) {
      if (!isFiniteNumber(series[i])) return emptySpectrum('powerSpectralDensity');
      mean += series[i];
    }
    mean /= rawLen;

    var nfft = 1;
    while (nfft < rawLen) nfft *= 2;
    var re = new Float64Array(nfft);
    var im = new Float64Array(nfft);
    var window = hanningWindow(rawLen);
    var windowPower = 0;

    for (var j = 0; j < rawLen; j++) {
      var w = window[j];
      re[j] = (series[j] - mean) * w;
      windowPower += w * w;
    }
    if (windowPower <= 0) return emptySpectrum('powerSpectralDensity');

    fft(re, im);

    var lastIndex = Math.floor(nfft / 2);
    var length = lastIndex + 1;
    var freqs = new Float64Array(length);
    var power = new Float64Array(length);
    var binWidthHz = fs / nfft;
    var normalization = fs * windowPower;

    for (var k = 0; k < length; k++) {
      freqs[k] = k * binWidthHz;
      var value = (re[k] * re[k] + im[k] * im[k]) / normalization;
      if (k > 0 && k < lastIndex) value *= 2;
      power[k] = value;
    }

    var selectedPeak = peakIndex(freqs, power, MIN_PEAK_HZ);
    return {
      freqs: freqs,
      power: power,
      fPeak: selectedPeak >= 0 ? freqs[selectedPeak] : 0,
      binWidthHz: binWidthHz,
      quantity: 'powerSpectralDensity',
      nfft: nfft,
      sampleCount: rawLen
    };
  }

  function combineVectorSpectrum(x, y, z) {
    if (!x || !y || !z || !x.power.length ||
        x.power.length !== y.power.length || x.power.length !== z.power.length) {
      var empty = emptySpectrum('powerSpectralDensity');
      empty.dominantAxis = null;
      return empty;
    }

    var length = x.power.length;
    var power = new Float64Array(length);
    for (var i = 0; i < length; i++) {
      power[i] = x.power[i] + y.power[i] + z.power[i];
    }
    var selectedPeak = peakIndex(x.freqs, power, MIN_PEAK_HZ);
    var dominantAxis = null;
    if (selectedPeak >= 0) {
      dominantAxis = 'x';
      var largest = x.power[selectedPeak];
      if (y.power[selectedPeak] > largest) {
        dominantAxis = 'y';
        largest = y.power[selectedPeak];
      }
      if (z.power[selectedPeak] > largest) dominantAxis = 'z';
    }

    return {
      freqs: x.freqs,
      power: power,
      fPeak: selectedPeak >= 0 ? x.freqs[selectedPeak] : 0,
      binWidthHz: x.binWidthHz,
      quantity: 'powerSpectralDensity',
      nfft: x.nfft,
      sampleCount: x.sampleCount,
      dominantAxis: dominantAxis
    };
  }

  /**
   * Integrate PSD bins into one-third-octave bands and return band RMS.
   * The legacy power property now contains RMS values for chart compatibility.
   */
  function computeThirdOctaveFromPower(freqs, power, minHz, maxHz) {
    if (!freqs || freqs.length < 2 || !power || power.length !== freqs.length) {
      return {
        freqs: new Float64Array(0),
        power: new Float64Array(0),
        rms: new Float64Array(0),
        bandRms: new Float64Array(0),
        meanSquare: new Float64Array(0),
        quantity: 'bandRms',
        binWidthHz: 0
      };
    }

    var binWidthHz = freqs[1] - freqs[0];
    if (!isFiniteNumber(binWidthHz) || binWidthHz <= 0) {
      return {
        freqs: new Float64Array(0),
        power: new Float64Array(0),
        rms: new Float64Array(0),
        bandRms: new Float64Array(0),
        meanSquare: new Float64Array(0),
        quantity: 'bandRms',
        binWidthHz: 0
      };
    }

    var ratio = Math.pow(2, 1 / 3);
    var edgeFactor = Math.pow(2, 1 / 6);
    var min = isFiniteNumber(minHz) ? Math.max(0, minHz) : binWidthHz;
    var max = isFiniteNumber(maxHz) ? maxHz : freqs[freqs.length - 1];
    if (max <= 0) {
      return {
        freqs: new Float64Array(0),
        power: new Float64Array(0),
        rms: new Float64Array(0),
        bandRms: new Float64Array(0),
        meanSquare: new Float64Array(0),
        quantity: 'bandRms',
        binWidthHz: binWidthHz
      };
    }

    if (min <= 0) min = binWidthHz;
    var center = 1;
    while (center >= min * ratio) center /= ratio;
    while (center < min) center *= ratio;

    var centers = [];
    var bandRms = [];
    var bandMeanSquare = [];
    var binIndex = 1;
    while (center <= max) {
      var lower = center / edgeFactor;
      var upper = center * edgeFactor;
      var meanSquare = 0;
      while (binIndex < freqs.length && freqs[binIndex] < lower) binIndex++;
      while (binIndex < freqs.length &&
             freqs[binIndex] < upper && freqs[binIndex] <= max) {
        meanSquare += Math.max(0, power[binIndex]) * binWidthHz;
        binIndex++;
      }
      centers.push(center);
      bandMeanSquare.push(meanSquare);
      bandRms.push(Math.sqrt(meanSquare));
      center *= ratio;
    }

    var rmsArray = new Float64Array(bandRms);
    return {
      freqs: new Float64Array(centers),
      power: rmsArray,
      rms: rmsArray,
      bandRms: rmsArray,
      meanSquare: new Float64Array(bandMeanSquare),
      quantity: 'bandRms',
      binWidthHz: binWidthHz
    };
  }

  function computeThirdOctaveSpectrum(spectrum, fs) {
    var reference = spectrum && (spectrum.vector || spectrum.mag);
    if (!reference || !reference.freqs || reference.freqs.length === 0) {
      return {
        mag: computeThirdOctaveFromPower(null, null, 0, 0),
        x: computeThirdOctaveFromPower(null, null, 0, 0),
        y: computeThirdOctaveFromPower(null, null, 0, 0),
        z: computeThirdOctaveFromPower(null, null, 0, 0),
        vector: computeThirdOctaveFromPower(null, null, 0, 0)
      };
    }
    var maxHz = fs > 0 ? fs / 2 : reference.freqs[reference.freqs.length - 1];
    var minHz = MIN_PEAK_HZ;

    function integrate(series) {
      if (!series || !series.freqs || !series.power) {
        return computeThirdOctaveFromPower(null, null, 0, 0);
      }
      return computeThirdOctaveFromPower(series.freqs, series.power, minHz, maxHz);
    }

    return {
      mag: integrate(spectrum.mag),
      x: integrate(spectrum.x),
      y: integrate(spectrum.y),
      z: integrate(spectrum.z),
      vector: integrate(reference)
    };
  }

  /** Compute the compatibility magnitude PSD. */
  function computeSpectrum(dynamicData, fs) {
    var series = new Array(dynamicData.length);
    for (var i = 0; i < dynamicData.length; i++) series[i] = dynamicData[i].mag;
    return computeSpectrumSeries(series, fs);
  }

  /** Run the complete analysis pipeline. */
  function analyze(rawData, options) {
    rawData = Array.isArray(rawData) ? rawData : [];
    options = options || {};
    var sampling = analyzeSampling(rawData);
    var timestampAdjustedCount = isFiniteNumber(options.timestampAdjustedCount)
      ? Math.max(0, Math.floor(options.timestampAdjustedCount))
      : 0;
    if (timestampAdjustedCount > 0) {
      sampling.timestampAdjustedCount = timestampAdjustedCount;
      sampling.level = 'poor';
      sampling.spectrumUsable = false;
    }
    var fs = sampling.fsHz;
    var dynamic = removeGravity(rawData);
    var resampled = [];
    // Time-domain metrics describe the samples that were actually observed and
    // exported. Interpolation is used only for FFT, otherwise a sharp peak can
    // be attenuated or a long gap can be filled with artificial samples.
    var metricData = dynamic;
    var rms = calcRMS(metricData);
    var peak = calcPeak(metricData);
    var magnitudeRange = calcPeakToPeak(metricData);
    var axisPeakToPeak = calcAxisPeakToPeak(metricData);

    var spectrum = {
      mag: emptySpectrum('powerSpectralDensity'),
      x: emptySpectrum('powerSpectralDensity'),
      y: emptySpectrum('powerSpectralDensity'),
      z: emptySpectrum('powerSpectralDensity'),
      vector: emptySpectrum('powerSpectralDensity')
    };
    spectrum.vector.dominantAxis = null;
    var spectrumThird = computeThirdOctaveSpectrum(null, fs);

    if (sampling.spectrumUsable) {
      resampled = resampleDynamic(dynamic, fs);
    }
    if (resampled.length >= MIN_SPECTRUM_SAMPLES) {
      var magSeries = new Array(resampled.length);
      var xSeries = new Array(resampled.length);
      var ySeries = new Array(resampled.length);
      var zSeries = new Array(resampled.length);
      for (var i = 0; i < resampled.length; i++) {
        var d = resampled[i];
        magSeries[i] = d.mag;
        xSeries[i] = d.dx;
        ySeries[i] = d.dy;
        zSeries[i] = d.dz;
      }
      spectrum.mag = computeSpectrumSeries(magSeries, fs);
      spectrum.x = computeSpectrumSeries(xSeries, fs);
      spectrum.y = computeSpectrumSeries(ySeries, fs);
      spectrum.z = computeSpectrumSeries(zSeries, fs);
      spectrum.vector = combineVectorSpectrum(spectrum.x, spectrum.y, spectrum.z);
      spectrumThird = computeThirdOctaveSpectrum(spectrum, fs);
    }

    return {
      fsHz: fs,
      rms: rms,
      peak: peak,
      // Deprecated compatibility alias. Version 2 exports use magnitudeRange.
      peakToPeak: magnitudeRange,
      magnitudeRange: magnitudeRange,
      axisPeakToPeak: axisPeakToPeak,
      fPeak: spectrum.vector.fPeak,
      dominantAxis: spectrum.vector.dominantAxis,
      dynamic: dynamic,
      spectrum: spectrum,
      spectrumThird: spectrumThird,
      sampling: sampling,
      resampledSampleCount: resampled.length,
      sampleCount: rawData.length,
      durationMs: sampling.durationMs
    };
  }

  return {
    analyzeSampling: analyzeSampling,
    removeGravity: removeGravity,
    resampleDynamic: resampleDynamic,
    calcRMS: calcRMS,
    calcPeak: calcPeak,
    calcPeakToPeak: calcPeakToPeak,
    calcAxisPeakToPeak: calcAxisPeakToPeak,
    estimateFs: estimateFs,
    computeSpectrum: computeSpectrum,
    computeSpectrumSeries: computeSpectrumSeries,
    computeThirdOctaveFromPower: computeThirdOctaveFromPower,
    computeThirdOctaveSpectrum: computeThirdOctaveSpectrum,
    analyze: analyze
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Analysis;
}
