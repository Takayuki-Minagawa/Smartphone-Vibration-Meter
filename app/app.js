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
    sensorAvailable: false,
    spectrumSelection: { x: true, y: true, z: true, mag: true },
    zoom: { active: false, wrap: null, parent: null, next: null, controls: [] },
    chartTheme: null,
    statusKey: 'statusInit',
    statusParams: null
  };

  var profile = null;

  // DOM refs
  var els = {};

  var i18n = {
    ja: {
      title: '振動計測 - 計測',
      themeLight: 'ライト',
      themeDark: 'ダーク',
      langToEn: 'English',
      langToJa: '日本語',
      statusInit: '初期化中...',
      statusReady: '準備完了 | サンプリング ~{fs} Hz',
      statusViewer: '閲覧モード（インポートのみ）',
      statusRecording: '計測中...',
      statusDone: '完了 | {samples} サンプル',
      statusNoData: 'データがありません',
      statusImported: 'インポート完了',
      statusImportedAt: 'インポート完了（エクスポート日時: {date}）',
      toastCsv: 'CSV を保存/共有しました',
      toastJson: 'JSON を保存/共有しました',
      toastZip: 'ZIP を保存/共有しました',
      toastPackage: 'パッケージを保存/共有しました',
      toastShare: '共有しました',
      toastShareFail: '保存/共有に失敗しました: {error}',
      toastImportOk: 'インポートしました',
      toastImportFail: 'インポートに失敗しました: {error}',
      zoomWaveform: '時間波形',
      zoomSpectrum: 'スペクトル',
      axisTime: '時間 (s)',
      axisAccel: '加速度 (cm/s\u00b2)',
      axisFreq: '周波数 (Hz)',
      axisPower: 'パワー',
      durationManual: '手動',
      durationSec: '{value} 秒',
      placeholderMin: '最小',
      placeholderMax: '最大',
      placeholderStart: '開始',
      placeholderEnd: '終了'
    },
    en: {
      title: 'Vibration Meter - Measurement',
      themeLight: 'Light',
      themeDark: 'Dark',
      langToEn: 'English',
      langToJa: '日本語',
      statusInit: 'Initializing...',
      statusReady: 'Ready | fs: ~{fs} Hz',
      statusViewer: 'Viewer Mode (import only)',
      statusRecording: 'Recording...',
      statusDone: 'Done | {samples} samples',
      statusNoData: 'No data recorded',
      statusImported: 'Imported',
      statusImportedAt: 'Imported (exported: {date})',
      toastCsv: 'CSV saved/shared',
      toastJson: 'JSON saved/shared',
      toastZip: 'ZIP saved/shared',
      toastPackage: 'Package saved/shared',
      toastShare: 'Shared',
      toastShareFail: 'Save/share failed: {error}',
      toastImportOk: 'Data imported successfully',
      toastImportFail: 'Import failed: {error}',
      zoomWaveform: 'Time Waveform',
      zoomSpectrum: 'Spectrum',
      axisTime: 'Time (s)',
      axisAccel: 'Accel (cm/s\u00b2)',
      axisFreq: 'Frequency (Hz)',
      axisPower: 'Power',
      durationManual: 'Manual',
      durationSec: '{value} sec',
      placeholderMin: 'Min',
      placeholderMax: 'Max',
      placeholderStart: 'Start',
      placeholderEnd: 'End'
    }
  };

  function getLang() {
    return document.documentElement.getAttribute('data-help-lang') === 'en' ? 'en' : 'ja';
  }

  function formatText(str, params) {
    if (!params) return str;
    return Object.keys(params).reduce(function (out, key) {
      return out.replace(new RegExp('\\{' + key + '\\}', 'g'), params[key]);
    }, str);
  }

  function t(key, params) {
    var lang = getLang();
    var dict = i18n[lang] || i18n.ja;
    var str = dict[key] || i18n.ja[key] || key;
    return formatText(str, params);
  }

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
    initTheme();
    initHelpLanguage();
    setupCharts();
    bindEvents();
    readSpectrumSelection();
    updateUI();

    // Show profile info / viewer mode message
    if (state.sensorAvailable && profile) {
      setStatus('statusReady', { fs: profile.fsHz.toFixed(0) });
    } else {
      setStatus('statusViewer');
      els.statusDot.classList.remove('ready', 'recording');
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
    els.waveformRange = document.getElementById('waveformRange');
    els.spectrumWrap = document.getElementById('spectrumWrap');
    els.tabWaveform = document.getElementById('tabWaveform');
    els.tabSpectrum = document.getElementById('tabSpectrum');
    els.btnZoom = document.getElementById('btnZoom');
    els.btnCsv = document.getElementById('btnCsv');
    els.btnJson = document.getElementById('btnJson');
    els.btnZip = document.getElementById('btnZip');
    els.btnPackage = document.getElementById('btnPackage');
    els.importInput = document.getElementById('importInput');
    els.importWrap = document.getElementById('importWrap');
    els.toast = document.getElementById('toast');
    els.durationSelect = document.getElementById('durationSelect');
    els.spectrumRange = document.getElementById('spectrumRange');
    els.spectrumNote = document.getElementById('spectrumNote');
    els.spectrumComponents = document.getElementById('spectrumComponents');
    els.freqMin = document.getElementById('freqMin');
    els.freqMax = document.getElementById('freqMax');
    els.btnFreqReset = document.getElementById('btnFreqReset');
    els.timeMin = document.getElementById('timeMin');
    els.timeMax = document.getElementById('timeMax');
    els.btnTimeReset = document.getElementById('btnTimeReset');
    els.specX = document.getElementById('specX');
    els.specY = document.getElementById('specY');
    els.specZ = document.getElementById('specZ');
    els.specMag = document.getElementById('specMag');
    els.btnSpecAll = document.getElementById('btnSpecAll');
    els.btnSpecMag = document.getElementById('btnSpecMag');
    els.btnLangToggle = document.getElementById('btnLangToggle');
    els.btnTheme = document.getElementById('btnTheme');
    els.btnHelp = document.getElementById('btnHelp');
    els.helpOverlay = document.getElementById('helpOverlay');
    els.btnHelpClose = document.getElementById('btnHelpClose');
    els.btnLangJa = document.getElementById('btnLangJa');
    els.btnLangEn = document.getElementById('btnLangEn');
    els.zoomOverlay = document.getElementById('zoomOverlay');
    els.btnZoomClose = document.getElementById('btnZoomClose');
    els.zoomControls = document.getElementById('zoomControls');
    els.zoomChartHost = document.getElementById('zoomChartHost');
    els.zoomTitle = document.getElementById('zoomTitle');
  }

  function initTheme() {
    var saved = localStorage.getItem('vibmeter_theme');
    var prefersLight = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = saved || (prefersLight ? 'light' : 'dark');
    setTheme(theme);
  }

  function initHelpLanguage() {
    var saved = localStorage.getItem('vibmeter_help_lang');
    setHelpLanguage(saved || 'ja');
  }

  function setHelpLanguage(lang) {
    var next = lang === 'en' ? 'en' : 'ja';
    document.documentElement.setAttribute('data-help-lang', next);
    document.documentElement.lang = next;
    localStorage.setItem('vibmeter_help_lang', next);
    updateHelpLangButtons(next);
    updateLangToggleButton(next);
    updateDurationOptions();
    updatePlaceholders();
    updateTitle();
    updateChartLabels();
    refreshStatus();
    updateThemeButton(document.documentElement.getAttribute('data-theme') || 'dark');
    updateZoomTitle();
  }

  function updateHelpLangButtons(lang) {
    if (!els.btnLangJa || !els.btnLangEn) return;
    els.btnLangJa.classList.toggle('is-active', lang === 'ja');
    els.btnLangEn.classList.toggle('is-active', lang === 'en');
  }

  function updateLangToggleButton(lang) {
    if (!els.btnLangToggle) return;
    els.btnLangToggle.textContent = lang === 'ja' ? t('langToEn') : t('langToJa');
  }

  function updateTitle() {
    document.title = t('title');
  }

  function updateDurationOptions() {
    if (!els.durationSelect) return;
    var options = els.durationSelect.options;
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var val = parseInt(opt.value, 10);
      if (val === 0) {
        opt.textContent = t('durationManual');
      } else if (isFinite(val)) {
        opt.textContent = t('durationSec', { value: val });
      }
    }
  }

  function updatePlaceholders() {
    if (els.freqMin) els.freqMin.placeholder = t('placeholderMin');
    if (els.freqMax) els.freqMax.placeholder = t('placeholderMax');
    if (els.timeMin) els.timeMin.placeholder = t('placeholderStart');
    if (els.timeMax) els.timeMax.placeholder = t('placeholderEnd');
  }

  function setStatus(key, params) {
    state.statusKey = key;
    state.statusParams = params || null;
    if (els.statusText) {
      els.statusText.textContent = t(key, params || {});
    }
  }

  function refreshStatus() {
    if (!state.statusKey) return;
    setStatus(state.statusKey, state.statusParams || {});
  }

  function updateZoomTitle() {
    if (!els.zoomTitle || !state.zoom.active) return;
    els.zoomTitle.textContent = state.currentTab === 'spectrum'
      ? t('zoomSpectrum')
      : t('zoomWaveform');
  }

  function updateChartLabels() {
    if (state.waveformChart) {
      state.waveformChart.options.scales.x.title.text = t('axisTime');
      state.waveformChart.options.scales.y.title.text = t('axisAccel');
      state.waveformChart.update('none');
    }
    if (state.spectrumChart) {
      state.spectrumChart.options.scales.x.title.text = t('axisFreq');
      state.spectrumChart.options.scales.y.title.text = t('axisPower');
      state.spectrumChart.update('none');
    }
  }

  function setTheme(theme) {
    var next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('vibmeter_theme', next);
    updateThemeButton(next);
    if (state.waveformChart || state.spectrumChart) {
      applyChartTheme();
    }
  }

  function updateThemeButton(theme) {
    if (!els.btnTheme) return;
    els.btnTheme.textContent = theme === 'dark' ? t('themeLight') : t('themeDark');
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  function getChartTheme() {
    var styles = getComputedStyle(document.documentElement);
    return {
      legend: styles.getPropertyValue('--chart-legend').trim(),
      axis: styles.getPropertyValue('--chart-axis').trim(),
      grid: styles.getPropertyValue('--chart-grid').trim(),
      lineX: styles.getPropertyValue('--line-x').trim(),
      lineY: styles.getPropertyValue('--line-y').trim(),
      lineZ: styles.getPropertyValue('--line-z').trim(),
      lineMag: styles.getPropertyValue('--line-mag').trim(),
      linePower: styles.getPropertyValue('--line-power').trim()
    };
  }

  function setupCharts() {
    var theme = getChartTheme();
    state.chartTheme = theme;
    var commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: theme.legend, font: { size: 10 } }
        }
      },
      scales: {
        x: {
          ticks: { color: theme.axis, font: { size: 9 }, maxTicksLimit: 8 },
          grid: { color: theme.grid }
        },
        y: {
          ticks: { color: theme.axis, font: { size: 9 }, maxTicksLimit: 6 },
          grid: { color: theme.grid }
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
            borderColor: theme.lineX,
            borderWidth: 1,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Y',
            data: [],
            borderColor: theme.lineY,
            borderWidth: 1,
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Z',
            data: [],
            borderColor: theme.lineZ,
            borderWidth: 1,
            pointRadius: 0,
            tension: 0
          },
          {
            label: '|mag|',
            data: [],
            borderColor: theme.lineMag,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0
          }
        ]
      },
      options: Object.assign({}, commonOptions, {
        scales: Object.assign({}, commonOptions.scales, {
          x: Object.assign({}, commonOptions.scales.x, {
            type: 'linear',
            title: { display: true, text: t('axisTime'), color: theme.axis, font: { size: 9 } }
          }),
          y: Object.assign({}, commonOptions.scales.y, {
            title: { display: true, text: t('axisAccel'), color: theme.axis, font: { size: 9 } }
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
          borderColor: theme.linePower,
          backgroundColor: toRgba(theme.linePower, 0.12),
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0.2
        }]
      },
      options: Object.assign({}, commonOptions, {
        scales: Object.assign({}, commonOptions.scales, {
          x: Object.assign({}, commonOptions.scales.x, {
            title: { display: true, text: t('axisFreq'), color: theme.axis, font: { size: 9 } }
          }),
          y: Object.assign({}, commonOptions.scales.y, {
            title: { display: true, text: t('axisPower'), color: theme.axis, font: { size: 9 } }
          })
        })
      })
    });

    // Hide spectrum container again (waveform tab is shown by default)
    els.spectrumWrap.style.display = 'none';
  }

  function toRgba(color, alpha) {
    if (!color) return 'rgba(0,0,0,' + alpha + ')';
    var c = color.trim();
    if (c.indexOf('rgb') === 0) {
      var nums = c.replace(/rgba?\(|\)/g, '').split(',').map(function (v) {
        return parseFloat(v);
      });
      return 'rgba(' + nums[0] + ',' + nums[1] + ',' + nums[2] + ',' + alpha + ')';
    }
    if (c[0] === '#') {
      var hex = c.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      var r = parseInt(hex.slice(0, 2), 16);
      var g = parseInt(hex.slice(2, 4), 16);
      var b = parseInt(hex.slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    return color;
  }

  function applyChartTheme() {
    var theme = getChartTheme();
    state.chartTheme = theme;

    if (state.waveformChart) {
      var wave = state.waveformChart;
      wave.options.plugins.legend.labels.color = theme.legend;
      wave.options.scales.x.ticks.color = theme.axis;
      wave.options.scales.y.ticks.color = theme.axis;
      wave.options.scales.x.grid.color = theme.grid;
      wave.options.scales.y.grid.color = theme.grid;
      wave.options.scales.x.title.color = theme.axis;
      wave.options.scales.y.title.color = theme.axis;
      wave.data.datasets[0].borderColor = theme.lineX;
      wave.data.datasets[1].borderColor = theme.lineY;
      wave.data.datasets[2].borderColor = theme.lineZ;
      wave.data.datasets[3].borderColor = theme.lineMag;
      wave.update('none');
    }

    if (state.spectrumChart) {
      var spec = state.spectrumChart;
      spec.options.plugins.legend.labels.color = theme.legend;
      spec.options.scales.x.ticks.color = theme.axis;
      spec.options.scales.y.ticks.color = theme.axis;
      spec.options.scales.x.grid.color = theme.grid;
      spec.options.scales.y.grid.color = theme.grid;
      spec.options.scales.x.title.color = theme.axis;
      spec.options.scales.y.title.color = theme.axis;

      if (spec.data.datasets && spec.data.datasets.length > 0) {
        for (var i = 0; i < spec.data.datasets.length; i++) {
          var ds = spec.data.datasets[i];
          if (ds.label === 'X') ds.borderColor = theme.lineX;
          if (ds.label === 'Y') ds.borderColor = theme.lineY;
          if (ds.label === 'Z') ds.borderColor = theme.lineZ;
          if (ds.label === '|mag|') {
            ds.borderColor = theme.lineMag;
            ds.backgroundColor = toRgba(theme.lineMag, 0.12);
          }
          if (ds.label === 'Power') {
            ds.borderColor = theme.linePower;
            ds.backgroundColor = toRgba(theme.linePower, 0.12);
          }
        }
      }
      spec.update('none');
    }

    if (state.analysisResult && state.analysisResult.spectrum) {
      updateSpectrumChart(state.analysisResult.spectrum, state.analysisResult.fsHz);
    }
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', startRecording);
    els.btnStop.addEventListener('click', stopRecording);
    els.tabWaveform.addEventListener('click', function () { switchTab('waveform'); });
    els.tabSpectrum.addEventListener('click', function () { switchTab('spectrum'); });
    els.btnZoom.addEventListener('click', openZoom);
    els.btnCsv.addEventListener('click', exportCSV);
    els.btnJson.addEventListener('click', exportJSON);
    els.btnZip.addEventListener('click', exportZIP);
    els.btnPackage.addEventListener('click', exportPackage);
    els.importInput.addEventListener('change', handleImport);
    els.freqMin.addEventListener('input', applyFreqRange);
    els.freqMax.addEventListener('input', applyFreqRange);
    els.btnFreqReset.addEventListener('click', resetFreqRange);
    els.timeMin.addEventListener('input', applyWaveformRange);
    els.timeMax.addEventListener('input', applyWaveformRange);
    els.btnTimeReset.addEventListener('click', resetWaveformRange);
    els.specX.addEventListener('change', handleSpectrumComponentChange);
    els.specY.addEventListener('change', handleSpectrumComponentChange);
    els.specZ.addEventListener('change', handleSpectrumComponentChange);
    els.specMag.addEventListener('change', handleSpectrumComponentChange);
    els.btnSpecAll.addEventListener('click', selectAllSpectrumComponents);
    els.btnSpecMag.addEventListener('click', selectMagOnly);
    els.btnLangToggle.addEventListener('click', function () {
      setHelpLanguage(getLang() === 'ja' ? 'en' : 'ja');
    });
    els.btnTheme.addEventListener('click', toggleTheme);
    els.btnHelp.addEventListener('click', openHelp);
    els.btnHelpClose.addEventListener('click', closeHelp);
    els.btnLangJa.addEventListener('click', function () { setHelpLanguage('ja'); });
    els.btnLangEn.addEventListener('click', function () { setHelpLanguage('en'); });
    els.btnZoomClose.addEventListener('click', closeZoom);
    els.helpOverlay.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute('data-close') === 'help') {
        closeHelp();
      }
    });
    els.zoomOverlay.addEventListener('click', function (e) {
      if (e.target && e.target.getAttribute('data-close') === 'zoom') {
        closeZoom();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (state.zoom.active) closeZoom();
        closeHelp();
      }
    });

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

  function syncOverlayState() {
    var open = false;
    if (els.helpOverlay && els.helpOverlay.classList.contains('is-open')) open = true;
    if (els.zoomOverlay && els.zoomOverlay.classList.contains('is-open')) open = true;
    document.body.classList.toggle('overlay-open', open);
  }

  function openHelp() {
    els.helpOverlay.classList.add('is-open');
    syncOverlayState();
  }

  function closeHelp() {
    els.helpOverlay.classList.remove('is-open');
    syncOverlayState();
  }

  function moveNodeTo(target, node) {
    if (!node || !target) return null;
    var record = { node: node, parent: node.parentNode, next: node.nextSibling };
    target.appendChild(node);
    return record;
  }

  function restoreNode(record) {
    if (!record || !record.node || !record.parent) return;
    if (record.next && record.next.parentNode === record.parent) {
      record.parent.insertBefore(record.node, record.next);
    } else {
      record.parent.appendChild(record.node);
    }
  }

  function openZoom() {
    if (state.zoom.active) return;
    var wrap = state.currentTab === 'spectrum' ? els.spectrumWrap : els.waveformWrap;
    if (!wrap) return;
    state.zoom.active = true;
    state.zoom.wrap = wrap;
    state.zoom.parent = wrap.parentNode;
    state.zoom.next = wrap.nextSibling;
    state.zoom.controls = [];

    els.zoomTitle.textContent = state.currentTab === 'spectrum'
      ? t('zoomSpectrum')
      : t('zoomWaveform');
    els.zoomChartHost.appendChild(wrap);
    if (state.currentTab === 'spectrum') {
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.spectrumNote));
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.spectrumRange));
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.spectrumComponents));
    } else if (state.currentTab === 'waveform') {
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.waveformRange));
    }
    wrap.classList.add('zoom-target');
    els.zoomOverlay.classList.add('is-open');
    syncOverlayState();

    setTimeout(function () {
      if (state.currentTab === 'waveform' && state.waveformChart) state.waveformChart.resize();
      if (state.currentTab === 'spectrum' && state.spectrumChart) state.spectrumChart.resize();
    }, 0);
  }

  function closeZoom() {
    if (!state.zoom.active || !state.zoom.wrap) return;
    var wrap = state.zoom.wrap;
    wrap.classList.remove('zoom-target');
    if (state.zoom.next && state.zoom.next.parentNode === state.zoom.parent) {
      state.zoom.parent.insertBefore(wrap, state.zoom.next);
    } else {
      state.zoom.parent.appendChild(wrap);
    }
    if (state.zoom.controls && state.zoom.controls.length > 0) {
      for (var i = 0; i < state.zoom.controls.length; i++) {
        restoreNode(state.zoom.controls[i]);
      }
    }
    els.zoomOverlay.classList.remove('is-open');
    state.zoom.active = false;
    state.zoom.wrap = null;
    state.zoom.parent = null;
    state.zoom.next = null;
    state.zoom.controls = [];
    syncOverlayState();

    setTimeout(function () {
      if (state.currentTab === 'waveform' && state.waveformChart) state.waveformChart.resize();
      if (state.currentTab === 'spectrum' && state.spectrumChart) state.spectrumChart.resize();
    }, 0);
  }

  function readSpectrumSelection() {
    var selection = {
      x: !!els.specX.checked,
      y: !!els.specY.checked,
      z: !!els.specZ.checked,
      mag: !!els.specMag.checked
    };

    if (!selection.x && !selection.y && !selection.z && !selection.mag) {
      selection.mag = true;
      els.specMag.checked = true;
    }
    state.spectrumSelection = selection;
    return selection;
  }

  function handleSpectrumComponentChange() {
    readSpectrumSelection();
    if (state.analysisResult && state.analysisResult.spectrum) {
      updateSpectrumChart(state.analysisResult.spectrum, state.analysisResult.fsHz);
    }
  }

  function selectAllSpectrumComponents() {
    els.specX.checked = true;
    els.specY.checked = true;
    els.specZ.checked = true;
    els.specMag.checked = true;
    handleSpectrumComponentChange();
  }

  function selectMagOnly() {
    els.specX.checked = false;
    els.specY.checked = false;
    els.specZ.checked = false;
    els.specMag.checked = true;
    handleSpectrumComponentChange();
  }

  function startRecording() {
    state.rawData = [];
    state.analysisResult = null;
    state.recording = true;
    updateUI();

    els.statusDot.classList.remove('ready');
    els.statusDot.classList.add('recording');
    setStatus('statusRecording');

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
      setStatus('statusDone', { samples: state.rawData.length });
    } else {
      setStatus('statusNoData');
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
    var chart = state.waveformChart;
    var minAll = Infinity;
    var maxAll = -Infinity;
    var minFit = Infinity;
    var maxFit = -Infinity;
    var timeMin = null;
    var timeMax = null;

    if (chart && chart.options && chart.options.scales && chart.options.scales.x) {
      var xScale = chart.options.scales.x;
      var xMin = parseFloat(xScale.min);
      var xMax = parseFloat(xScale.max);
      if (isFinite(xMin)) timeMin = xMin;
      if (isFinite(xMax)) timeMax = xMax;
    }

    for (var i = 0; i < dynamic.length; i += step) {
      var d = dynamic[i];
      var tSec = (d.t - t0) / 1000;
      labels.push(tSec);
      dx.push({ x: tSec, y: d.dx });
      dy.push({ x: tSec, y: d.dy });
      dz.push({ x: tSec, y: d.dz });
      mag.push({ x: tSec, y: d.mag });
      minAll = Math.min(minAll, d.dx, d.dy, d.dz, d.mag);
      maxAll = Math.max(maxAll, d.dx, d.dy, d.dz, d.mag);
      var inRange = true;
      if (timeMin !== null && tSec < timeMin) inRange = false;
      if (timeMax !== null && tSec > timeMax) inRange = false;
      if (inRange) {
        minFit = Math.min(minFit, d.dx, d.dy, d.dz, d.mag);
        maxFit = Math.max(maxFit, d.dx, d.dy, d.dz, d.mag);
      }
    }

    chart.data.labels = labels;
    chart.data.datasets[0].data = dx;
    chart.data.datasets[1].data = dy;
    chart.data.datasets[2].data = dz;
    chart.data.datasets[3].data = mag;
    var minVal = isFinite(minFit) ? minFit : minAll;
    var maxVal = isFinite(maxFit) ? maxFit : maxAll;
    if (isFinite(minVal) && isFinite(maxVal)) {
      var range = maxVal - minVal;
      if (!isFinite(range) || range === 0) {
        range = Math.max(0.5, Math.abs(maxVal) * 0.2);
      }
      var pad = range * 0.1;
      chart.options.scales.y.min = minVal - pad;
      chart.options.scales.y.max = maxVal + pad;
    } else {
      delete chart.options.scales.y.min;
      delete chart.options.scales.y.max;
    }
    chart.update('none');
  }

  function applyWaveformRange() {
    if (!state.waveformChart) return;
    var min = parseFloat(els.timeMin.value);
    var max = parseFloat(els.timeMax.value);
    if (!isFinite(min)) min = null;
    if (!isFinite(max)) max = null;
    if (min !== null) min = Math.max(0, min);
    if (max !== null) max = Math.max(0, max);
    if (min !== null && max !== null && min > max) {
      var swap = min;
      min = max;
      max = swap;
    }
    var chart = state.waveformChart;
    if (min === null) {
      delete chart.options.scales.x.min;
    } else {
      chart.options.scales.x.min = min;
    }
    if (max === null) {
      delete chart.options.scales.x.max;
    } else {
      chart.options.scales.x.max = max;
    }
    if (state.analysisResult && state.analysisResult.dynamic) {
      updateWaveformChart(state.analysisResult.dynamic);
    } else if (state.rawData.length > 0) {
      var recent = state.rawData.slice(-200);
      var dynamic = Analysis.removeGravity(recent);
      updateWaveformChart(dynamic);
    } else {
      chart.update('none');
    }
  }

  function resetWaveformRange() {
    els.timeMin.value = '';
    els.timeMax.value = '';
    applyWaveformRange();
  }

  function updateSpectrumChart(spectrum, fs) {
    if (!spectrum || !spectrum.mag || spectrum.mag.freqs.length === 0) {
      var emptyChart = state.spectrumChart;
      emptyChart.data.labels = [];
      emptyChart.data.datasets = [];
      emptyChart.update('none');
      return;
    }

    var theme = state.chartTheme || getChartTheme();
    var maxFreq = fs / 2;
    var labels = [];
    var maxPower = 0;
    var freqs = spectrum.mag.freqs;
    var indices = [];

    // User-specified frequency range for display + Y-axis fitting
    var fitMin = parseFloat(els.freqMin.value);
    var fitMax = parseFloat(els.freqMax.value);
    if (!isFinite(fitMin)) fitMin = 0;
    if (!isFinite(fitMax)) fitMax = maxFreq;
    fitMin = Math.max(0, Math.min(fitMin, maxFreq));
    fitMax = Math.max(0, Math.min(fitMax, maxFreq));
    if (fitMin > fitMax) {
      var swap = fitMin;
      fitMin = fitMax;
      fitMax = swap;
    }

    // Start from i=1 to skip DC component (i=0) which dominates the scale
    for (var i = 1; i < freqs.length; i++) {
      var freq = freqs[i];
      if (freq < fitMin) continue;
      if (freq > fitMax) break;
      labels.push(freq.toFixed(1));
      indices.push(i);
    }

    var selection = readSpectrumSelection();
    var datasets = [];

    function addDataset(key, label, color, fill) {
      var spec = spectrum[key];
      if (!spec || !spec.power || spec.power.length === 0) return;
      var data = new Array(indices.length);
      for (var j = 0; j < indices.length; j++) {
        var idx = indices[j];
        var v = spec.power[idx] || 0;
        data[j] = v;
        if (v > maxPower) maxPower = v;
      }
      datasets.push({
        label: label,
        data: data,
        borderColor: color,
        backgroundColor: fill ? toRgba(color, 0.12) : 'transparent',
        borderWidth: label === '|mag|' ? 1.5 : 1,
        pointRadius: 0,
        fill: !!fill,
        tension: 0.2
      });
    }

    if (selection.x) addDataset('x', 'X', theme.lineX, false);
    if (selection.y) addDataset('y', 'Y', theme.lineY, false);
    if (selection.z) addDataset('z', 'Z', theme.lineZ, false);
    if (selection.mag) addDataset('mag', '|mag|', theme.lineMag, true);

    if (datasets.length === 0) {
      addDataset('mag', '|mag|', theme.lineMag, true);
    }

    var chart = state.spectrumChart;
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    // Fit Y-axis: start at 0, max with 10% headroom based on fit range
    chart.options.scales.y.min = 0;
    if (maxPower > 0) {
      chart.options.scales.y.max = maxPower * 1.1;
    } else {
      delete chart.options.scales.y.max;
    }
    chart.update('none');
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
    if (state.zoom.active) closeZoom();
    state.currentTab = tab;
    els.tabWaveform.classList.toggle('active', tab === 'waveform');
    els.tabSpectrum.classList.toggle('active', tab === 'spectrum');
    els.waveformWrap.style.display = tab === 'waveform' ? 'block' : 'none';
    els.waveformRange.style.display = tab === 'waveform' ? 'block' : 'none';
    els.spectrumWrap.style.display = tab === 'spectrum' ? 'block' : 'none';
    els.spectrumNote.style.display = tab === 'spectrum' ? 'block' : 'none';
    els.spectrumRange.style.display = tab === 'spectrum' ? 'block' : 'none';
    els.spectrumComponents.style.display = tab === 'spectrum' ? 'grid' : 'none';

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
    els.btnPackage.disabled = !hasData;
  }

  // Export handlers
  function handleExport(promise, toastKey) {
    if (!promise || typeof promise.then !== 'function') {
      showToast(t(toastKey));
      return;
    }
    promise.then(function () {
      showToast(t(toastKey));
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      var msg = err && err.message ? err.message : String(err);
      showToast(t('toastShareFail', { error: msg }));
    });
  }

  function exportCSV() {
    if (!state.analysisResult) return;
    handleExport(
      Export.downloadCSV(state.rawData, state.analysisResult.dynamic),
      'toastCsv'
    );
  }

  function exportJSON() {
    if (!state.analysisResult) return;
    handleExport(
      Export.downloadJSON(state.analysisResult, profile),
      'toastJson'
    );
  }

  function exportZIP() {
    if (!state.analysisResult) return;
    handleExport(Export.downloadZIP(
      state.rawData,
      state.analysisResult.dynamic,
      state.analysisResult,
      profile
    ), 'toastZip');
  }

  function exportPackage() {
    if (!state.analysisResult) return;
    handleExport(
      Export.downloadPackage(state.rawData, state.analysisResult, profile),
      'toastPackage'
    );
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

        if (result.exportedAt) {
          var exportedLabel = new Date(result.exportedAt).toLocaleString();
          setStatus('statusImportedAt', { date: exportedLabel });
        } else {
          setStatus('statusImported');
        }
        els.statusDot.classList.remove('recording');
        els.statusDot.classList.add('ready');
        showToast(t('toastImportOk'));
      })
      .catch(function (err) {
        showToast(t('toastImportFail', { error: err.message }));
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
