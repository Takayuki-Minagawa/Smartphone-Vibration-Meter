/**
 * app.js - Main application controller
 * Manages measurement lifecycle, charts, and UI interactions
 */
var App = (function () {
  // State
  var state = {
    recording: false,
    rawData: [],
    analysisResult: null,
    stopSensor: null,
    waveformChart: null,
    spectrumChart: null,
    liveUpdateTimer: null,
    currentTab: 'waveform',
    sensorAvailable: false
  };

  var profile = null;

  // DOM refs
  var els = {};

  function init() {
    // Check consent
    if (localStorage.getItem('vibmeter_consent') !== 'true') {
      window.location.href = '../index.html';
      return;
    }

    // Load sensor profile
    profile = Sensor.loadProfile();
    state.sensorAvailable = profile ? profile.sensorAvailable !== false : false;

    cacheDOMRefs();
    setupCharts();
    bindEvents();
    updateUI();

    // Show profile info / viewer mode message
    if (state.sensorAvailable && profile) {
      els.statusText.textContent =
        'Ready | fs: ~' + profile.fsHz.toFixed(0) + ' Hz';
    } else {
      els.statusText.textContent = 'Viewer Mode (import only)';
      els.statusDot.classList.remove('ready', 'recording');
    }

    // Show/hide share button
    if (!Export.canShareFiles()) {
      els.btnShare.style.display = 'none';
    }
  }

  function cacheDOMRefs() {
    els.btnStart = document.getElementById('btnStart');
    els.btnStop = document.getElementById('btnStop');
    els.statusDot = document.getElementById('statusDot');
    els.statusText = document.getElementById('statusText');
    els.kpiRms = document.getElementById('kpiRms');
    els.kpiPeak = document.getElementById('kpiPeak');
    els.kpiFsHz = document.getElementById('kpiFsHz');
    els.kpiDuration = document.getElementById('kpiDuration');
    els.kpiFpeak = document.getElementById('kpiFpeak');
    els.kpiSamples = document.getElementById('kpiSamples');
    els.waveformCanvas = document.getElementById('waveformChart');
    els.spectrumCanvas = document.getElementById('spectrumChart');
    els.waveformWrap = document.getElementById('waveformWrap');
    els.spectrumWrap = document.getElementById('spectrumWrap');
    els.tabWaveform = document.getElementById('tabWaveform');
    els.tabSpectrum = document.getElementById('tabSpectrum');
    els.btnCsv = document.getElementById('btnCsv');
    els.btnJson = document.getElementById('btnJson');
    els.btnZip = document.getElementById('btnZip');
    els.btnShare = document.getElementById('btnShare');
    els.btnPackage = document.getElementById('btnPackage');
    els.importInput = document.getElementById('importInput');
    els.importWrap = document.getElementById('importWrap');
    els.toast = document.getElementById('toast');
    els.durationSelect = document.getElementById('durationSelect');
    els.spectrumRange = document.getElementById('spectrumRange');
    els.freqMin = document.getElementById('freqMin');
    els.freqMax = document.getElementById('freqMax');
    els.btnFreqReset = document.getElementById('btnFreqReset');
  }

  function setupCharts() {
    var commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#a0aab4', font: { size: 10 } }
        }
      },
      scales: {
        x: {
          ticks: { color: '#6b7b8a', font: { size: 9 }, maxTicksLimit: 8 },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          ticks: { color: '#6b7b8a', font: { size: 9 }, maxTicksLimit: 6 },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    };

    // Waveform chart
    state.waveformChart = new Chart(els.waveformCanvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'X',
            data: [],
            borderColor: '#e63946',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Y',
            data: [],
            borderColor: '#2a9d8f',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Z',
            data: [],
            borderColor: '#e9c46a',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0
          },
          {
            label: '|mag|',
            data: [],
            borderColor: '#00b4d8',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0
          }
        ]
      },
      options: Object.assign({}, commonOptions, {
        scales: Object.assign({}, commonOptions.scales, {
          x: Object.assign({}, commonOptions.scales.x, {
            title: { display: true, text: 'Time (s)', color: '#6b7b8a', font: { size: 9 } }
          }),
          y: Object.assign({}, commonOptions.scales.y, {
            title: { display: true, text: 'Accel (m/s\u00b2)', color: '#6b7b8a', font: { size: 9 } }
          })
        })
      })
    });

    // Temporarily show spectrum container so Chart.js can measure dimensions
    els.spectrumWrap.style.display = 'block';

    // Spectrum chart
    state.spectrumChart = new Chart(els.spectrumCanvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Power',
          data: [],
          borderColor: '#00b4d8',
          backgroundColor: 'rgba(0,180,216,0.1)',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.2
        }]
      },
      options: Object.assign({}, commonOptions, {
        scales: Object.assign({}, commonOptions.scales, {
          x: Object.assign({}, commonOptions.scales.x, {
            title: { display: true, text: 'Frequency (Hz)', color: '#6b7b8a', font: { size: 9 } }
          }),
          y: Object.assign({}, commonOptions.scales.y, {
            title: { display: true, text: 'Power', color: '#6b7b8a', font: { size: 9 } }
          })
        })
      })
    });

    // Hide spectrum container again (waveform tab is shown by default)
    els.spectrumWrap.style.display = 'none';
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', startRecording);
    els.btnStop.addEventListener('click', stopRecording);
    els.tabWaveform.addEventListener('click', function () { switchTab('waveform'); });
    els.tabSpectrum.addEventListener('click', function () { switchTab('spectrum'); });
    els.btnCsv.addEventListener('click', exportCSV);
    els.btnJson.addEventListener('click', exportJSON);
    els.btnZip.addEventListener('click', exportZIP);
    els.btnShare.addEventListener('click', exportShare);
    els.btnPackage.addEventListener('click', exportPackage);
    els.importInput.addEventListener('change', handleImport);
    els.freqMin.addEventListener('input', applyFreqRange);
    els.freqMax.addEventListener('input', applyFreqRange);
    els.btnFreqReset.addEventListener('click', resetFreqRange);

    // Drag and drop
    var wrap = els.importWrap;
    wrap.addEventListener('dragover', function (e) {
      e.preventDefault();
      wrap.classList.add('dragover');
    });
    wrap.addEventListener('dragleave', function () {
      wrap.classList.remove('dragover');
    });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      wrap.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        importFile(e.dataTransfer.files[0]);
      }
    });
  }

  function startRecording() {
    state.rawData = [];
    state.analysisResult = null;
    state.recording = true;
    updateUI();

    els.statusDot.classList.remove('ready');
    els.statusDot.classList.add('recording');
    els.statusText.textContent = 'Recording...';

    state.stopSensor = Sensor.startListening(function (data) {
      state.rawData.push(data);
    });

    // Live update timer
    state.liveUpdateTimer = setInterval(function () {
      if (state.rawData.length > 0) {
        updateLiveKPI();
      }
    }, 500);

    // Auto-stop by duration
    var duration = parseInt(els.durationSelect.value, 10);
    if (duration > 0) {
      setTimeout(function () {
        if (state.recording) stopRecording();
      }, duration * 1000);
    }
  }

  function stopRecording() {
    state.recording = false;

    if (state.stopSensor) {
      state.stopSensor();
      state.stopSensor = null;
    }

    if (state.liveUpdateTimer) {
      clearInterval(state.liveUpdateTimer);
      state.liveUpdateTimer = null;
    }

    els.statusDot.classList.remove('recording');
    els.statusDot.classList.add('ready');

    if (state.rawData.length > 0) {
      state.analysisResult = Analysis.analyze(state.rawData);
      updateKPI(state.analysisResult);
      updateCharts(state.analysisResult);
      els.statusText.textContent =
        'Done | ' + state.rawData.length + ' samples';
    } else {
      els.statusText.textContent = 'No data recorded';
    }

    updateUI();
  }

  function updateLiveKPI() {
    var fs = Analysis.estimateFs(state.rawData);
    var recent = state.rawData.slice(-200);
    var dynamic = Analysis.removeGravity(recent);
    var rms = Analysis.calcRMS(dynamic);
    var peak = Analysis.calcPeak(dynamic);
    var durationS = state.rawData.length > 1
      ? (state.rawData[state.rawData.length - 1].t - state.rawData[0].t) / 1000
      : 0;

    els.kpiRms.textContent = rms.toFixed(3);
    els.kpiPeak.textContent = peak.toFixed(3);
    els.kpiFsHz.textContent = fs.toFixed(0);
    els.kpiDuration.textContent = durationS.toFixed(1);
    els.kpiSamples.textContent = state.rawData.length;
    els.kpiFpeak.textContent = '-';

    // Live waveform update (only when waveform tab is active)
    if (state.currentTab === 'waveform' && dynamic.length > 0) {
      updateWaveformChart(dynamic);
    }
  }

  function updateKPI(result) {
    els.kpiRms.textContent = result.rms.toFixed(4);
    els.kpiPeak.textContent = result.peak.toFixed(4);
    els.kpiFsHz.textContent = result.fsHz.toFixed(1);
    els.kpiFpeak.textContent = result.fPeak > 0 ? result.fPeak.toFixed(1) : '-';
    els.kpiDuration.textContent = (result.durationMs / 1000).toFixed(1);
    els.kpiSamples.textContent = result.sampleCount;
  }

  function updateCharts(result) {
    updateWaveformChart(result.dynamic);
    updateSpectrumChart(result.spectrum, result.fsHz);
  }

  function updateWaveformChart(dynamic) {
    if (!dynamic || dynamic.length === 0) return;

    var t0 = dynamic[0].t;
    // Downsample if too many points
    var step = Math.max(1, Math.floor(dynamic.length / 2000));
    var labels = [];
    var dx = [], dy = [], dz = [], mag = [];

    for (var i = 0; i < dynamic.length; i += step) {
      var d = dynamic[i];
      labels.push(((d.t - t0) / 1000).toFixed(2));
      dx.push(d.dx);
      dy.push(d.dy);
      dz.push(d.dz);
      mag.push(d.mag);
    }

    var chart = state.waveformChart;
    chart.data.labels = labels;
    chart.data.datasets[0].data = dx;
    chart.data.datasets[1].data = dy;
    chart.data.datasets[2].data = dz;
    chart.data.datasets[3].data = mag;
    chart.update('none');
  }

  function updateSpectrumChart(spectrum, fs) {
    if (!spectrum || spectrum.freqs.length === 0) return;

    var maxFreq = fs / 2;
    var labels = [];
    var data = [];
    var maxPower = 0;

    // User-specified frequency range for Y-axis fitting
    var fitMin = parseFloat(els.freqMin.value);
    var fitMax = parseFloat(els.freqMax.value);
    var hasFitRange = isFinite(fitMin) || isFinite(fitMax);
    if (!isFinite(fitMin)) fitMin = 0;
    if (!isFinite(fitMax)) fitMax = maxFreq;

    // Start from i=1 to skip DC component (i=0) which dominates the scale
    for (var i = 1; i < spectrum.freqs.length; i++) {
      if (spectrum.freqs[i] > maxFreq) break;
      var freq = spectrum.freqs[i];
      labels.push(freq.toFixed(1));
      data.push(spectrum.power[i]);

      // Track max power within the fit range only
      if (freq >= fitMin && freq <= fitMax && spectrum.power[i] > maxPower) {
        maxPower = spectrum.power[i];
      }
    }

    var chart = state.spectrumChart;
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    // Fit Y-axis: start at 0, max with 10% headroom based on fit range
    chart.options.scales.y.min = 0;
    if (maxPower > 0) {
      chart.options.scales.y.max = maxPower * 1.1;
    } else {
      delete chart.options.scales.y.max;
    }
    chart.update();
  }

  function applyFreqRange() {
    if (state.analysisResult && state.analysisResult.spectrum) {
      updateSpectrumChart(state.analysisResult.spectrum, state.analysisResult.fsHz);
    }
  }

  function resetFreqRange() {
    els.freqMin.value = '';
    els.freqMax.value = '';
    applyFreqRange();
  }

  function switchTab(tab) {
    state.currentTab = tab;
    els.tabWaveform.classList.toggle('active', tab === 'waveform');
    els.tabSpectrum.classList.toggle('active', tab === 'spectrum');
    els.waveformWrap.style.display = tab === 'waveform' ? 'block' : 'none';
    els.spectrumWrap.style.display = tab === 'spectrum' ? 'block' : 'none';
    els.spectrumRange.style.display = tab === 'spectrum' ? 'block' : 'none';

    // Defer resize to next event loop iteration so the browser
    // has processed the display change and computed layout
    setTimeout(function () {
      if (tab === 'waveform' && state.waveformChart) state.waveformChart.resize();
      if (tab === 'spectrum' && state.spectrumChart) state.spectrumChart.resize();
    }, 0);
  }

  function updateUI() {
    var hasData = state.analysisResult !== null;
    var canMeasure = state.sensorAvailable;

    // Measurement controls: disabled entirely when sensor is unavailable
    els.btnStart.disabled = !canMeasure || state.recording;
    els.btnStop.disabled = !canMeasure || !state.recording;
    els.durationSelect.disabled = !canMeasure || state.recording;

    // Export: available whenever data exists (measured or imported)
    els.btnCsv.disabled = !hasData;
    els.btnJson.disabled = !hasData;
    els.btnZip.disabled = !hasData;
    els.btnShare.disabled = !hasData;
    els.btnPackage.disabled = !hasData;
  }

  // Export handlers
  function exportCSV() {
    if (!state.analysisResult) return;
    Export.downloadCSV(state.rawData, state.analysisResult.dynamic);
    showToast('CSV downloaded');
  }

  function exportJSON() {
    if (!state.analysisResult) return;
    Export.downloadJSON(state.analysisResult, profile);
    showToast('JSON downloaded');
  }

  function exportZIP() {
    if (!state.analysisResult) return;
    Export.downloadZIP(
      state.rawData,
      state.analysisResult.dynamic,
      state.analysisResult,
      profile
    ).then(function () {
      showToast('ZIP downloaded');
    });
  }

  function exportShare() {
    if (!state.analysisResult) return;
    Export.shareFiles(
      state.rawData,
      state.analysisResult.dynamic,
      state.analysisResult,
      profile
    ).then(function () {
      showToast('Shared');
    }).catch(function (err) {
      if (err.name !== 'AbortError') {
        showToast('Share failed: ' + err.message);
      }
    });
  }

  function exportPackage() {
    if (!state.analysisResult) return;
    Export.downloadPackage(state.rawData, state.analysisResult, profile);
    showToast('Package downloaded');
  }

  // Import handler
  function handleImport(e) {
    if (e.target.files && e.target.files.length > 0) {
      importFile(e.target.files[0]);
    }
  }

  function importFile(file) {
    Import.handleFile(file)
      .then(function (result) {
        state.rawData = result.rawData;
        state.analysisResult = Import.reanalyze(result.rawData);
        if (result.profile) profile = result.profile;

        updateKPI(state.analysisResult);
        updateCharts(state.analysisResult);
        updateUI();

        var info = 'Imported';
        if (result.exportedAt) {
          info += ' (exported: ' + new Date(result.exportedAt).toLocaleString() + ')';
        }
        els.statusText.textContent = info;
        els.statusDot.classList.remove('recording');
        els.statusDot.classList.add('ready');
        showToast('Data imported successfully');
      })
      .catch(function (err) {
        showToast('Import failed: ' + err.message);
      });
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(function () {
      els.toast.classList.remove('show');
    }, 2500);
  }

  // Init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { state: state };
})();
