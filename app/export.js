/**
 * export.js - CSV/JSON/ZIP download and Web Share API
 */
var Export = (function () {
  var FORMAT_VERSION = '2.0';
  var ACCEL_UNIT = 'cm/s^2';

  /**
   * Copy only JSON-serializable data. Unsupported values and cyclic links are
   * omitted; typed arrays are represented as ordinary arrays.
   */
  function toSerializable(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (value === undefined || typeof value === 'function' ||
        typeof value === 'symbol' || typeof value === 'bigint') {
      return undefined;
    }
    if (typeof value !== 'object') return undefined;

    var ancestors = seen || [];
    if (ancestors.indexOf(value) !== -1) return undefined;
    ancestors.push(value);

    var output;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
      output = [];
      for (var i = 0; i < value.length; i++) {
        var typedValue = toSerializable(value[i], ancestors);
        output.push(typedValue === undefined ? null : typedValue);
      }
    } else if (Array.isArray(value)) {
      output = [];
      for (var j = 0; j < value.length; j++) {
        var arrayValue = toSerializable(value[j], ancestors);
        output.push(arrayValue === undefined ? null : arrayValue);
      }
    } else {
      output = {};
      Object.keys(value).forEach(function (key) {
        var objectValue = toSerializable(value[key], ancestors);
        if (objectValue !== undefined) output[key] = objectValue;
      });
    }

    ancestors.pop();
    return output;
  }

  function serializableOrNull(value) {
    var serialized = toSerializable(value, []);
    return serialized === undefined ? null : serialized;
  }

  /** Build the compact, JSON-safe analysis section shared by all exports. */
  function buildAnalysisSummary(analysisResult) {
    var result = analysisResult || {};
    var magnitudeRange = result.magnitudeRange === undefined
      ? result.peakToPeak
      : result.magnitudeRange;
    return {
      accelUnit: ACCEL_UNIT,
      fsHz: result.fsHz,
      rms: result.rms,
      peak: result.peak,
      // Deprecated compatibility alias. Despite the historical name, this is
      // the range of the non-negative resultant magnitude, not signed P-P.
      peakToPeak: magnitudeRange,
      magnitudeRange: magnitudeRange,
      axisPeakToPeak: serializableOrNull(result.axisPeakToPeak),
      fPeak: result.fPeak,
      dominantAxis: serializableOrNull(result.dominantAxis),
      sampling: serializableOrNull(result.sampling),
      sampleCount: result.sampleCount,
      durationMs: result.durationMs
    };
  }

  /** Build common export metadata without reading clocks or browser globals. */
  function buildExportPayload(analysisResult, profile, exportedAt) {
    return {
      version: FORMAT_VERSION,
      processingVersion: FORMAT_VERSION,
      exportedAt: exportedAt,
      accelUnit: ACCEL_UNIT,
      deviceProfile: serializableOrNull(profile),
      analysis: buildAnalysisSummary(analysisResult)
    };
  }

  function buildRawArray(rawData) {
    var t0 = rawData.length > 0 ? rawData[0].t : 0;
    return rawData.map(function (r) {
      return {
        t: r.t - t0,
        ax: parseFloat(r.ax.toFixed(6)),
        ay: parseFloat(r.ay.toFixed(6)),
        az: parseFloat(r.az.toFixed(6)),
        hasGravity: typeof r.hasGravity === 'boolean' ? r.hasGravity : true
      };
    });
  }

  /**
   * Generate CSV string from raw data
   */
  function generateCSV(rawData, dynamicData) {
    var lines = ['timestamp_ms,ax_cm_s2,ay_cm_s2,az_cm_s2,mag_dynamic_cm_s2'];
    var t0 = rawData.length > 0 ? rawData[0].t : 0;

    for (var i = 0; i < rawData.length; i++) {
      var r = rawData[i];
      var mag = dynamicData && dynamicData[i] ? dynamicData[i].mag : 0;
      lines.push([
        (r.t - t0).toFixed(2),
        r.ax.toFixed(6),
        r.ay.toFixed(6),
        r.az.toFixed(6),
        mag.toFixed(6)
      ].join(','));
    }

    return lines.join('\n');
  }

  /**
   * Generate analysis JSON
   */
  function generateAnalysisJSON(analysisResult, profile) {
    var payload = buildExportPayload(
      analysisResult,
      profile,
      new Date().toISOString()
    );
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Generate package JSON (combined raw + analysis for import)
   */
  function generatePackageJSON(rawData, analysisResult, profile) {
    var payload = buildExportPayload(
      analysisResult,
      profile,
      new Date().toISOString()
    );
    payload.type = 'vibration-meter-package';
    payload.rawData = buildRawArray(rawData);
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Trigger file download
   */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /**
   * Share with Web Share API when available; otherwise download.
   * Returns a Promise resolved on completion. Rejects on AbortError only.
   */
  function shareOrDownload(contentOrBlob, filename, mimeType) {
    var blob = contentOrBlob instanceof Blob
      ? contentOrBlob
      : new Blob([contentOrBlob], { type: mimeType || 'application/octet-stream' });

    var file = null;
    if (typeof File !== 'undefined') {
      try {
        file = new File([blob], filename, {
          type: mimeType || blob.type || 'application/octet-stream'
        });
      } catch (e) {
        file = null;
      }
    }

    if (file && navigator.share) {
      var canShare = true;
      if (navigator.canShare) {
        try {
          canShare = navigator.canShare({ files: [file] });
        } catch (e) {
          canShare = false;
        }
      }

      if (canShare) {
        return navigator.share({
          title: 'Vibration Measurement Data',
          text: 'Vibration Meter measurement result',
          files: [file]
        }).catch(function (err) {
          if (err && err.name === 'AbortError') {
            throw err;
          }
          downloadBlob(blob, filename);
        });
      }
    }

    downloadBlob(blob, filename);
    return Promise.resolve();
  }

  /**
   * Download CSV
   */
  function downloadCSV(rawData, dynamicData) {
    var csv = generateCSV(rawData, dynamicData);
    var ts = formatTimestamp();
    return shareOrDownload(csv, 'vibration_raw_' + ts + '.csv', 'text/csv');
  }

  /**
   * Download analysis JSON
   */
  function downloadJSON(analysisResult, profile) {
    var json = generateAnalysisJSON(analysisResult, profile);
    var ts = formatTimestamp();
    return shareOrDownload(json, 'vibration_analysis_' + ts + '.json', 'application/json');
  }

  /**
   * Download package JSON (for import/restore)
   */
  function downloadPackage(rawData, analysisResult, profile) {
    var json = generatePackageJSON(rawData, analysisResult, profile);
    var ts = formatTimestamp();
    return shareOrDownload(json, 'vibration_package_' + ts + '.json', 'application/json');
  }

  /**
   * Download ZIP (raw.csv + analysis.json) using JSZip
   */
  function downloadZIP(rawData, dynamicData, analysisResult, profile) {
    if (typeof JSZip === 'undefined') {
      // Fallback: download package JSON
      return downloadPackage(rawData, analysisResult, profile);
    }

    var zip = new JSZip();
    var ts = formatTimestamp();
    zip.file('raw.csv', generateCSV(rawData, dynamicData));
    zip.file('analysis.json', generateAnalysisJSON(analysisResult, profile));
    zip.file('vibration_package.json', generatePackageJSON(rawData, analysisResult, profile));

    return zip.generateAsync({ type: 'blob' }).then(function (blob) {
      return shareOrDownload(blob, 'vibration_export_' + ts + '.zip', 'application/zip');
    });
  }

  function formatTimestamp() {
    var d = new Date();
    return d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) + '_' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds());
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  return {
    downloadCSV: downloadCSV,
    downloadJSON: downloadJSON,
    downloadPackage: downloadPackage,
    downloadZIP: downloadZIP,
    generateCSV: generateCSV,
    generateAnalysisJSON: generateAnalysisJSON,
    generatePackageJSON: generatePackageJSON,
    buildAnalysisSummary: buildAnalysisSummary,
    buildExportPayload: buildExportPayload
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Export;
}
