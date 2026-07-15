/**
 * import.js - Import vibration-package JSON or ZIP and restore data
 */
var Import = (function () {
  var limits = typeof VibMeterLimits !== 'undefined'
    ? VibMeterLimits
    : require('./limits.js');
  var MAX_JSON_SIZE = limits.maxJSONSize;
  var MAX_SAMPLES = limits.maxSamples;
  var MAX_DURATION_MS = limits.maxDurationMs;
  var MAX_ABS_ACCELERATION = limits.maxAbsAccelerationCmS2;

  function assertJSONSize(jsonStr) {
    if (typeof jsonStr !== 'string') {
      throw new Error('Invalid JSON file.');
    }

    // Check characters first so an obviously oversized ZIP entry is rejected
    // without allocating another large buffer for UTF-8 length calculation.
    if (jsonStr.length > MAX_JSON_SIZE) {
      throw new Error('JSON file is too large.');
    }

    var byteLength = jsonStr.length;
    if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
      byteLength = Buffer.byteLength(jsonStr, 'utf8');
    } else if (typeof TextEncoder !== 'undefined') {
      byteLength = new TextEncoder().encode(jsonStr).byteLength;
    }

    if (byteLength > MAX_JSON_SIZE) {
      throw new Error('JSON file is too large.');
    }
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function validateVersion(version) {
    if (version === undefined) return;

    var normalized = typeof version === 'number' ? String(version) : version;
    if (typeof normalized !== 'string' || !/^[12](?:\.\d+)*$/.test(normalized)) {
      throw new Error('Unsupported package version.');
    }
  }

  function getAccelUnit(pkg) {
    var accelUnit = pkg.accelUnit;
    if (accelUnit === undefined && pkg.analysis && typeof pkg.analysis === 'object') {
      accelUnit = pkg.analysis.accelUnit;
    }

    // Packages created before the unit field was introduced used m/s^2. V2
    // made the unit mandatory, so silently guessing there could scale values
    // by 100 in the wrong direction.
    if (accelUnit === undefined) {
      if (pkg.version !== undefined && /^2(?:\.|$)/.test(String(pkg.version))) {
        throw new Error('Version 2 package requires an acceleration unit.');
      }
      accelUnit = 'm/s^2';
    }

    if (accelUnit !== 'cm/s^2' && accelUnit !== 'm/s^2') {
      throw new Error('Unsupported acceleration unit.');
    }
    return accelUnit;
  }

  function supportsLegacyEqualTimestamps(version) {
    return version === undefined || /^1(?:\.|$)/.test(String(version));
  }

  function incrementTimestamp(timestamp) {
    var increment = Math.max(0.001, Math.abs(timestamp) * Number.EPSILON * 2);
    var next = timestamp + increment;
    if (!Number.isFinite(next) || next <= timestamp) {
      throw new Error('Sample timestamp is out of range.');
    }
    return next;
  }

  function validateAndNormalizeRawData(rawData, scale, allowEqualTimestamps) {
    if (!Array.isArray(rawData) || rawData.length === 0) {
      throw new Error('Package has no measurement data.');
    }
    if (rawData.length > MAX_SAMPLES) {
      throw new Error('Package has too many samples.');
    }

    var normalized = new Array(rawData.length);
    var firstTimestamp = null;
    var previousSourceTimestamp = null;
    var previousNormalizedTimestamp = null;
    var timestampAdjustedCount = 0;

    for (var i = 0; i < rawData.length; i++) {
      var sample = rawData[i];
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
        throw new Error('Invalid measurement sample.');
      }

      if (!isFiniteNumber(sample.t) ||
          !isFiniteNumber(sample.ax) ||
          !isFiniteNumber(sample.ay) ||
          !isFiniteNumber(sample.az)) {
        throw new Error('Measurement values must be finite numbers.');
      }

      if (previousSourceTimestamp !== null && sample.t < previousSourceTimestamp) {
        throw new Error('Sample timestamps must increase.');
      }

      var normalizedTimestamp = sample.t;
      if (previousNormalizedTimestamp !== null &&
          normalizedTimestamp <= previousNormalizedTimestamp) {
        if (!allowEqualTimestamps) {
          throw new Error('Sample timestamps must increase.');
        }
        normalizedTimestamp = incrementTimestamp(previousNormalizedTimestamp);
        timestampAdjustedCount++;
      }

      if (sample.hasGravity !== undefined && typeof sample.hasGravity !== 'boolean') {
        throw new Error('Invalid gravity flag.');
      }

      if (firstTimestamp === null) firstTimestamp = sample.t;
      if (sample.t - firstTimestamp > MAX_DURATION_MS) {
        throw new Error('Measurement duration is too long.');
      }

      var ax = sample.ax * scale;
      var ay = sample.ay * scale;
      var az = sample.az * scale;
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
          Math.abs(ax) > MAX_ABS_ACCELERATION ||
          Math.abs(ay) > MAX_ABS_ACCELERATION ||
          Math.abs(az) > MAX_ABS_ACCELERATION) {
        throw new Error('Acceleration value is out of range.');
      }

      normalized[i] = {
        t: normalizedTimestamp,
        ax: ax,
        ay: ay,
        az: az,
        hasGravity: sample.hasGravity === undefined ? true : sample.hasGravity
      };
      previousSourceTimestamp = sample.t;
      previousNormalizedTimestamp = normalizedTimestamp;
    }

    return {
      rawData: normalized,
      timestampAdjustedCount: timestampAdjustedCount
    };
  }

  /**
   * Parse a vibration-package JSON string.
   * Versions with major version 1 or 2 are supported. A missing version is
   * accepted for compatibility with the original package format.
   * @param {string} jsonStr
   * @returns {Object} { rawData, analysis, profile }
   */
  function parsePackageJSON(jsonStr) {
    assertJSONSize(jsonStr);

    var pkg;
    try {
      pkg = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Invalid JSON file.');
    }

    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) ||
        pkg.type !== 'vibration-meter-package') {
      throw new Error('Invalid vibration package.');
    }

    validateVersion(pkg.version);
    var accelUnit = getAccelUnit(pkg);
    var scale = accelUnit === 'm/s^2' ? 100 : 1;
    var normalized = validateAndNormalizeRawData(
      pkg.rawData,
      scale,
      supportsLegacyEqualTimestamps(pkg.version)
    );

    return {
      rawData: normalized.rawData,
      analysis: pkg.analysis || null,
      profile: pkg.deviceProfile || null,
      exportedAt: pkg.exportedAt || null,
      timestampAdjustedCount: normalized.timestampAdjustedCount
    };
  }

  function getZIPEntrySize(entry) {
    if (!entry || !entry._data) return null;
    var size = entry._data.uncompressedSize;
    return isFiniteNumber(size) ? size : null;
  }

  /**
   * Decode a ZIP entry incrementally and stop decompression at the byte limit.
   * JSZip v3 exposes a pausable StreamHelper for exactly this use case.
   */
  function readZIPEntryTextLimited(entry) {
    if (!entry || typeof entry.internalStream !== 'function') {
      return Promise.reject(new Error('ZIP streaming is unavailable.'));
    }
    if (typeof TextDecoder === 'undefined') {
      return Promise.reject(new Error('Text decoding is unavailable.'));
    }

    return new Promise(function (resolve, reject) {
      var decoder = new TextDecoder('utf-8');
      var textParts = [];
      var totalBytes = 0;
      var settled = false;
      var stream;

      function fail(error) {
        if (settled) return;
        settled = true;
        if (stream && typeof stream.pause === 'function') stream.pause();
        reject(error);
      }

      try {
        stream = entry.internalStream('uint8array');
        stream.on('data', function (chunk) {
          if (settled) return;
          var bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          totalBytes += bytes.byteLength;
          if (totalBytes > MAX_JSON_SIZE) {
            fail(new Error('JSON file is too large.'));
            return;
          }
          textParts.push(decoder.decode(bytes, { stream: true }));
        });
        stream.on('error', fail);
        stream.on('end', function () {
          if (settled) return;
          try {
            textParts.push(decoder.decode());
            var text = textParts.join('');
            assertJSONSize(text);
            settled = true;
            resolve(text);
          } catch (error) {
            fail(error);
          }
        });
        stream.resume();
      } catch (error) {
        fail(error);
      }
    });
  }

  /**
   * Parse a ZIP file and extract the vibration_package.json inside.
   * @param {ArrayBuffer} buffer
   * @returns {Promise<Object>}
   */
  function parseZIP(buffer) {
    if (buffer && isFiniteNumber(buffer.byteLength) && buffer.byteLength > MAX_JSON_SIZE) {
      return Promise.reject(new Error('File is too large.'));
    }
    if (typeof JSZip === 'undefined') {
      return Promise.reject(new Error('ZIP support is unavailable.'));
    }

    return JSZip.loadAsync(buffer).then(function (zip) {
      var pkgFile = zip.file('vibration_package.json');
      if (!pkgFile) {
        var jsonFiles = zip.file(/\.json$/i);
        if (jsonFiles.length > 0) {
          pkgFile = jsonFiles[0];
        } else {
          throw new Error('ZIP contains no JSON package.');
        }
      }

      var declaredSize = getZIPEntrySize(pkgFile);
      if (declaredSize !== null && declaredSize > MAX_JSON_SIZE) {
        throw new Error('JSON file is too large.');
      }
      return readZIPEntryTextLimited(pkgFile);
    }).then(function (jsonStr) {
      return parsePackageJSON(jsonStr);
    });
  }

  function readJSONFile(file) {
    if (file && typeof file.text === 'function') {
      return Promise.resolve(file.text()).then(function (text) {
        return parsePackageJSON(text);
      });
    }

    return new Promise(function (resolve, reject) {
      if (typeof FileReader === 'undefined') {
        reject(new Error('File reading is unavailable.'));
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(parsePackageJSON(reader.result));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = function () {
        reject(new Error('Failed to read file.'));
      };
      reader.readAsText(file);
    });
  }

  /**
   * Handle file input (accepts .json or .zip).
   * @param {File} file
   * @returns {Promise<Object>}
   */
  function handleFile(file) {
    if (!file || typeof file.name !== 'string') {
      return Promise.reject(new Error('No file selected.'));
    }
    if (isFiniteNumber(file.size) && file.size > MAX_JSON_SIZE) {
      return Promise.reject(new Error('File is too large.'));
    }

    var name = file.name.toLowerCase();
    if (/\.zip$/.test(name)) {
      if (typeof file.arrayBuffer !== 'function') {
        return Promise.reject(new Error('Failed to read ZIP file.'));
      }
      return file.arrayBuffer().then(function (buf) {
        return parseZIP(buf);
      });
    }
    if (/\.json$/.test(name)) {
      return readJSONFile(file);
    }

    return Promise.reject(new Error('Unsupported file type.'));
  }

  /**
   * Re-run analysis on imported raw data.
   * Analysis is intentionally resolved only when this function is called so
   * this module can be loaded in Node for package-format tests.
   * @param {Array} rawData
   * @returns {Object} full analysis result
   */
  function reanalyze(rawData, options) {
    return Analysis.analyze(rawData, options);
  }

  return {
    parsePackageJSON: parsePackageJSON,
    parseZIP: parseZIP,
    handleFile: handleFile,
    reanalyze: reanalyze,
    limits: {
      maxJSONSize: MAX_JSON_SIZE,
      maxSamples: MAX_SAMPLES,
      maxDurationMs: MAX_DURATION_MS,
      maxAbsAccelerationCmS2: MAX_ABS_ACCELERATION
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Import;
}
