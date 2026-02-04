/**
 * import.js - Import vibration-package JSON or ZIP and restore data
 */
var Import = (function () {
  /**
   * Parse a vibration-package JSON string
   * @param {string} jsonStr
   * @returns {Object} { rawData, analysis, profile }
   */
  function parsePackageJSON(jsonStr) {
    var pkg = JSON.parse(jsonStr);

    if (pkg.type !== 'vibration-meter-package') {
      throw new Error('Invalid file: not a vibration-meter-package');
    }

    // Reconstruct rawData with relative timestamps
    var rawData = (pkg.rawData || []).map(function (r) {
      return {
        t: r.t,
        ax: r.ax,
        ay: r.ay,
        az: r.az,
        hasGravity: r.hasGravity !== false
      };
    });

    return {
      rawData: rawData,
      analysis: pkg.analysis || null,
      profile: pkg.deviceProfile || null,
      exportedAt: pkg.exportedAt || null
    };
  }

  /**
   * Parse a ZIP file and extract the vibration_package.json inside
   * @param {ArrayBuffer} buffer
   * @returns {Promise<Object>}
   */
  function parseZIP(buffer) {
    if (typeof JSZip === 'undefined') {
      return Promise.reject(new Error('JSZip is not loaded'));
    }

    return JSZip.loadAsync(buffer).then(function (zip) {
      // Look for vibration_package.json
      var pkgFile = zip.file('vibration_package.json');
      if (!pkgFile) {
        // Try any .json file
        var jsonFiles = zip.file(/\.json$/);
        if (jsonFiles.length > 0) {
          pkgFile = jsonFiles[0];
        } else {
          throw new Error('No JSON file found in ZIP');
        }
      }

      return pkgFile.async('string');
    }).then(function (jsonStr) {
      return parsePackageJSON(jsonStr);
    });
  }

  /**
   * Handle file input (accepts .json or .zip)
   * @param {File} file
   * @returns {Promise<Object>}
   */
  function handleFile(file) {
    var name = file.name.toLowerCase();

    if (name.endsWith('.zip')) {
      return file.arrayBuffer().then(function (buf) {
        return parseZIP(buf);
      });
    }

    // Assume JSON
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(parsePackageJSON(reader.result));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = function () {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  }

  /**
   * Re-run analysis on imported raw data
   * @param {Array} rawData
   * @returns {Object} full analysis result
   */
  function reanalyze(rawData) {
    return Analysis.analyze(rawData);
  }

  return {
    parsePackageJSON: parsePackageJSON,
    parseZIP: parseZIP,
    handleFile: handleFile,
    reanalyze: reanalyze
  };
})();
