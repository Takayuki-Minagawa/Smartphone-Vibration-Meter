/**
 * export.js - CSV/JSON/ZIP download and Web Share API
 */
var Export = (function () {
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
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      accelUnit: 'cm/s^2',
      deviceProfile: profile || null,
      analysis: {
        accelUnit: 'cm/s^2',
        fsHz: analysisResult.fsHz,
        rms: analysisResult.rms,
        peak: analysisResult.peak,
        peakToPeak: analysisResult.peakToPeak,
        fPeak: analysisResult.fPeak,
        sampleCount: analysisResult.sampleCount,
        durationMs: analysisResult.durationMs
      }
    }, null, 2);
  }

  /**
   * Generate package JSON (combined raw + analysis for import)
   */
  function generatePackageJSON(rawData, analysisResult, profile) {
    var t0 = rawData.length > 0 ? rawData[0].t : 0;

    var rawArray = rawData.map(function (r) {
      return {
        t: parseFloat((r.t - t0).toFixed(2)),
        ax: parseFloat(r.ax.toFixed(6)),
        ay: parseFloat(r.ay.toFixed(6)),
        az: parseFloat(r.az.toFixed(6)),
        hasGravity: r.hasGravity
      };
    });

    return JSON.stringify({
      version: '1.0',
      type: 'vibration-meter-package',
      exportedAt: new Date().toISOString(),
      accelUnit: 'cm/s^2',
      deviceProfile: profile || null,
      analysis: {
        accelUnit: 'cm/s^2',
        fsHz: analysisResult.fsHz,
        rms: analysisResult.rms,
        peak: analysisResult.peak,
        peakToPeak: analysisResult.peakToPeak,
        fPeak: analysisResult.fPeak,
        sampleCount: analysisResult.sampleCount,
        durationMs: analysisResult.durationMs
      },
      rawData: rawArray
    }, null, 2);
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
    generatePackageJSON: generatePackageJSON
  };
})();
