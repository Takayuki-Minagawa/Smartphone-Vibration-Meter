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
    autoStopTimer: null,
    toastTimer: null,
    recordingSessionId: 0,
    importRequestId: 0,
    importing: false,
    backgroundedDuringRecording: false,
    datasetProfile: null,
    currentTab: 'waveform',
    sensorAvailable: false,
    spectrumSelection: { x: true, y: true, z: true, mag: true },
    spectrumMode: 'fft',
    zoom: { active: false, wrap: null, parent: null, next: null, controls: [] },
    helpReturnFocus: null,
    zoomReturnFocus: null,
    chartTheme: null,
    statusKey: 'statusInit',
    statusParams: null
  };

  var limits = typeof VibMeterLimits !== 'undefined'
    ? VibMeterLimits
    : require('./limits.js');
  var runtimeProfile = null;
  var MAX_RECORDING_SAMPLES = limits.maxSamples;
  var MAX_RECORDING_DURATION_MS = limits.maxDurationMs;
  var CONSENT_VERSION = '2026-07';

  // DOM refs
  var els = {};

  var i18n = {
    ja: {
      title: '振動計測 - 計測',
      themeLight: 'ライト',
      themeDark: 'ダーク',
      themeToLightAria: 'ライトテーマへ切り替える',
      themeToDarkAria: 'ダークテーマへ切り替える',
      langToEn: 'English',
      langToJa: '日本語',
      langToggleAria: '英語表示へ切り替える',
      statusInit: '初期化中...',
      statusReady: '準備完了 | サンプリング ~{fs} Hz',
      statusViewer: '閲覧モード（インポートのみ）',
      statusRecording: '計測中...',
      statusAnalyzing: '解析中...',
      statusImporting: 'インポート中...',
      statusDone: '完了 | {samples} サンプル',
      statusNoData: 'データがありません',
      statusInterrupted: '画面遷移により計測を中断しました',
      statusSensorError: 'センサー開始に失敗しました',
      statusAnalysisError: '解析に失敗しました',
      statusImported: 'インポート完了',
      statusImportedAt: 'インポート完了（エクスポート日時: {date}）',
      toastCsv: 'CSV を保存/共有しました',
      toastJson: 'JSON を保存/共有しました',
      toastZip: 'ZIP を保存/共有しました',
      toastPackage: '再取込用JSONを保存/共有しました',
      toastShare: '共有しました',
      toastShareFail: '保存/共有に失敗しました: {error}',
      toastImportOk: 'インポートしました',
      toastImportFail: 'インポートに失敗しました: {error}',
      toastImportBusy: '計測中またはインポート中は読み込めません',
      toastSampleLimit: '安全上限 {samples} サンプルで自動停止しました',
      toastDurationLimit: '安全上限 1 時間で自動停止しました',
      toastImportDisplayFail: 'データは読み込みましたが表示更新に失敗しました: {error}',
      statusImportedDisplayError: 'インポート済み（表示更新に失敗）',
      zoomWaveform: '時間波形',
      zoomSpectrum: 'スペクトル',
      axisTime: '時間 (s)',
      axisAccel: '加速度 (cm/s\u00b2)',
      axisFreq: '周波数 (Hz)',
      axisPower: 'PSD ((cm/s²)²/Hz)',
      axisBandRms: '帯域 RMS (cm/s²)',
      qualityGood: '良好',
      qualityFair: '注意',
      qualityPoor: '低品質',
      qualityInsufficient: 'データ不足',
      qualityGoodMessage: 'サンプリング時刻は安定しています。',
      qualityFairMessage: '周波数結果は参考値として確認してください。',
      qualityPoorMessage: '欠損または時刻揺らぎが大きく、スペクトル解析には不向きです。',
      qualityInsufficientMessage: '品質判定に必要なサンプルが不足しています。',
      qualityBackgroundMessage: ' 計測中に画面がバックグラウンドになりました。',
      fpeakMeta: 'Hz · 主成分 {axis}',
      waveformSummary: '{duration} 秒、{samples} サンプルの X / Y / Z / |mag| 時間波形です。',
      spectrumSummary: 'ベクトルPSDの卓越周波数 {frequency} Hz、主成分 {axis}、周波数分解能 {resolution} Hzです。',
      spectrumUnavailableSummary: 'サンプリング品質またはデータ長が解析条件を満たさないため、スペクトルは表示しません。',
      chartPendingSummary: '計測またはインポート後にグラフの概要を表示します。',
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
      themeToLightAria: 'Switch to the light theme',
      themeToDarkAria: 'Switch to the dark theme',
      langToEn: 'English',
      langToJa: '日本語',
      langToggleAria: 'Switch to Japanese',
      statusInit: 'Initializing...',
      statusReady: 'Ready | fs: ~{fs} Hz',
      statusViewer: 'Viewer Mode (import only)',
      statusRecording: 'Recording...',
      statusAnalyzing: 'Analyzing...',
      statusImporting: 'Importing...',
      statusDone: 'Done | {samples} samples',
      statusNoData: 'No data recorded',
      statusInterrupted: 'Measurement was interrupted by page navigation',
      statusSensorError: 'Failed to start the sensor',
      statusAnalysisError: 'Analysis failed',
      statusImported: 'Imported',
      statusImportedAt: 'Imported (exported: {date})',
      toastCsv: 'CSV saved/shared',
      toastJson: 'JSON saved/shared',
      toastZip: 'ZIP saved/shared',
      toastPackage: 'Importable JSON saved/shared',
      toastShare: 'Shared',
      toastShareFail: 'Save/share failed: {error}',
      toastImportOk: 'Data imported successfully',
      toastImportFail: 'Import failed: {error}',
      toastImportBusy: 'Import is unavailable while recording or importing',
      toastSampleLimit: 'Stopped at the safety limit of {samples} samples',
      toastDurationLimit: 'Stopped at the one-hour safety limit',
      toastImportDisplayFail: 'Data was imported, but the display could not be refreshed: {error}',
      statusImportedDisplayError: 'Imported (display refresh failed)',
      zoomWaveform: 'Time Waveform',
      zoomSpectrum: 'Spectrum',
      axisTime: 'Time (s)',
      axisAccel: 'Accel (cm/s\u00b2)',
      axisFreq: 'Frequency (Hz)',
      axisPower: 'PSD ((cm/s²)²/Hz)',
      axisBandRms: 'Band RMS (cm/s²)',
      qualityGood: 'Good',
      qualityFair: 'Caution',
      qualityPoor: 'Poor',
      qualityInsufficient: 'Insufficient',
      qualityGoodMessage: 'Sampling timestamps are stable.',
      qualityFairMessage: 'Treat frequency results as approximate.',
      qualityPoorMessage: 'Gaps or timing jitter are too large for reliable spectrum analysis.',
      qualityInsufficientMessage: 'There are not enough samples to assess quality.',
      qualityBackgroundMessage: ' The page was backgrounded during measurement.',
      fpeakMeta: 'Hz · dominant {axis}',
      waveformSummary: 'Time waveform of X / Y / Z / |mag| for {duration} s and {samples} samples.',
      spectrumSummary: 'Vector PSD dominant frequency {frequency} Hz, dominant axis {axis}, frequency resolution {resolution} Hz.',
      spectrumUnavailableSummary: 'The spectrum is hidden because sampling quality or record length does not meet the analysis requirements.',
      chartPendingSummary: 'A chart summary appears after measurement or import.',
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
    if (localStorage.getItem('vibmeter_consent') !== 'true' ||
        localStorage.getItem('vibmeter_consent_version') !== CONSENT_VERSION) {
      window.location.href = '../index.html';
      return;
    }

    // Load sensor profile
    runtimeProfile = Sensor.loadProfile();
    state.sensorAvailable = !!(runtimeProfile && runtimeProfile.sensorAvailable);
    state.datasetProfile = runtimeProfile;

    cacheDOMRefs();
    initTheme();
    initHelpLanguage();
    setupCharts();
    bindEvents();
    switchTab(state.currentTab);
    readSpectrumSelection();
    readSpectrumMode();
    updateUI();

    // Show profile info / viewer mode message
    if (state.sensorAvailable && runtimeProfile) {
      var profileFs = isFinite(runtimeProfile.fsHz) ? runtimeProfile.fsHz : 0;
      setStatus('statusReady', { fs: profileFs.toFixed(0) });
    } else {
      setStatus('statusViewer');
      els.statusDot.classList.remove('ready', 'recording');
    }

  }

  function cacheDOMRefs() {
    els.appContainer = document.querySelector('.app-container');
    els.btnStart = document.getElementById('btnStart');
    els.btnStop = document.getElementById('btnStop');
    els.statusDot = document.getElementById('statusDot');
    els.statusText = document.getElementById('statusText');
    els.kpiRms = document.getElementById('kpiRms');
    els.kpiPeak = document.getElementById('kpiPeak');
    els.kpiFsHz = document.getElementById('kpiFsHz');
    els.kpiDuration = document.getElementById('kpiDuration');
    els.kpiFpeak = document.getElementById('kpiFpeak');
    els.kpiFpeakMeta = document.getElementById('kpiFpeakMeta');
    els.kpiSamples = document.getElementById('kpiSamples');
    els.qualityPanel = document.getElementById('qualityPanel');
    els.qualityBadge = document.getElementById('qualityBadge');
    els.qualityFs = document.getElementById('qualityFs');
    els.qualityJitter = document.getElementById('qualityJitter');
    els.qualityCompleteness = document.getElementById('qualityCompleteness');
    els.qualityMaxGap = document.getElementById('qualityMaxGap');
    els.qualityResolution = document.getElementById('qualityResolution');
    els.qualityNyquist = document.getElementById('qualityNyquist');
    els.qualityMessage = document.getElementById('qualityMessage');
    els.waveformCanvas = document.getElementById('waveformChart');
    els.spectrumCanvas = document.getElementById('spectrumChart');
    els.waveformSummary = document.getElementById('waveformSummary');
    els.spectrumSummary = document.getElementById('spectrumSummary');
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
    els.spectrumMode = document.getElementById('spectrumMode');
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
    els.specModeFft = document.getElementById('specModeFft');
    els.specModeOct = document.getElementById('specModeOct');
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
    if (state.analysisResult) {
      updateKPI(state.analysisResult);
      updateQualityPanel(state.analysisResult);
      updateChartSummaries(state.analysisResult);
    }
  }

  function updateHelpLangButtons(lang) {
    if (!els.btnLangJa || !els.btnLangEn) return;
    els.btnLangJa.classList.toggle('is-active', lang === 'ja');
    els.btnLangEn.classList.toggle('is-active', lang === 'en');
    els.btnLangJa.setAttribute('aria-pressed', lang === 'ja' ? 'true' : 'false');
    els.btnLangEn.setAttribute('aria-pressed', lang === 'en' ? 'true' : 'false');
  }

  function updateLangToggleButton(lang) {
    if (!els.btnLangToggle) return;
    els.btnLangToggle.textContent = lang === 'ja' ? t('langToEn') : t('langToJa');
    els.btnLangToggle.setAttribute('aria-label', t('langToggleAria'));
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
      state.spectrumChart.options.scales.y.title.text = state.spectrumMode === 'octave'
        ? t('axisBandRms')
        : t('axisPower');
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
    els.btnTheme.setAttribute(
      'aria-label',
      t(theme === 'dark' ? 'themeToLightAria' : 'themeToDarkAria')
    );
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
            borderDash: [],
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Y',
            data: [],
            borderColor: theme.lineY,
            borderWidth: 1,
            borderDash: [8, 3],
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Z',
            data: [],
            borderColor: theme.lineZ,
            borderWidth: 1,
            borderDash: [2, 3],
            pointRadius: 0,
            tension: 0
          },
          {
            label: '|mag|',
            data: [],
            borderColor: theme.lineMag,
            borderWidth: 1.5,
            borderDash: [10, 3, 2, 3],
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
          if (ds.label === '|mag|' || ds.label === 'Vector') {
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

    if (state.analysisResult) {
      updateSpectrumChart(state.analysisResult);
    }
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', startRecording);
    els.btnStop.addEventListener('click', stopRecording);
    els.tabWaveform.addEventListener('click', function () { switchTab('waveform'); });
    els.tabSpectrum.addEventListener('click', function () { switchTab('spectrum'); });
    els.tabWaveform.addEventListener('keydown', handleTabKeydown);
    els.tabSpectrum.addEventListener('keydown', handleTabKeydown);
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
    if (els.specModeFft) els.specModeFft.addEventListener('change', handleSpectrumModeChange);
    if (els.specModeOct) els.specModeOct.addEventListener('change', handleSpectrumModeChange);
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
      var activeOverlay = state.zoom.active
        ? els.zoomOverlay
        : els.helpOverlay.classList.contains('is-open')
          ? els.helpOverlay
          : null;
      if (e.key === 'Tab' && activeOverlay) {
        trapDialogFocus(e, activeOverlay);
        return;
      }
      if (e.key === 'Escape') {
        if (state.zoom.active) closeZoom();
        if (els.helpOverlay.classList.contains('is-open')) closeHelp();
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
      if (state.recording || state.importing) {
        showToast(t('toastImportBusy'));
        return;
      }
      if (e.dataTransfer.files.length > 0) {
        importFile(e.dataTransfer.files[0]);
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (state.recording && document.hidden) {
        state.backgroundedDuringRecording = true;
      }
    });
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  }

  function handleTabKeydown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    var nextTab = state.currentTab === 'waveform' ? 'spectrum' : 'waveform';
    switchTab(nextTab);
    (nextTab === 'waveform' ? els.tabWaveform : els.tabSpectrum).focus();
  }

  function syncOverlayState() {
    var open = false;
    if (els.helpOverlay && els.helpOverlay.classList.contains('is-open')) open = true;
    if (els.zoomOverlay && els.zoomOverlay.classList.contains('is-open')) open = true;
    document.body.classList.toggle('overlay-open', open);
    if (els.appContainer) els.appContainer.inert = open;
  }

  function trapDialogFocus(event, overlay) {
    var candidates = overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    var focusable = [];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].offsetParent !== null) focusable.push(candidates[i]);
    }
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    var active = document.activeElement;
    if (event.shiftKey && (active === first || !overlay.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function openHelp() {
    if (els.helpOverlay.classList.contains('is-open')) return;
    state.helpReturnFocus = document.activeElement;
    els.helpOverlay.classList.add('is-open');
    els.helpOverlay.setAttribute('aria-hidden', 'false');
    syncOverlayState();
    setTimeout(function () { els.btnHelpClose.focus(); }, 0);
  }

  function closeHelp() {
    if (!els.helpOverlay.classList.contains('is-open')) return;
    els.helpOverlay.classList.remove('is-open');
    els.helpOverlay.setAttribute('aria-hidden', 'true');
    syncOverlayState();
    if (state.helpReturnFocus && typeof state.helpReturnFocus.focus === 'function') {
      state.helpReturnFocus.focus();
    }
    state.helpReturnFocus = null;
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
    state.zoomReturnFocus = document.activeElement;
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
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.spectrumMode));
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.spectrumRange));
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.spectrumComponents));
    } else if (state.currentTab === 'waveform') {
      state.zoom.controls.push(moveNodeTo(els.zoomControls, els.waveformRange));
    }
    wrap.classList.add('zoom-target');
    els.zoomOverlay.classList.add('is-open');
    els.zoomOverlay.setAttribute('aria-hidden', 'false');
    syncOverlayState();

    setTimeout(function () {
      els.btnZoomClose.focus();
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
    els.zoomOverlay.setAttribute('aria-hidden', 'true');
    state.zoom.active = false;
    state.zoom.wrap = null;
    state.zoom.parent = null;
    state.zoom.next = null;
    state.zoom.controls = [];
    syncOverlayState();

    if (state.zoomReturnFocus && typeof state.zoomReturnFocus.focus === 'function') {
      state.zoomReturnFocus.focus();
    }
    state.zoomReturnFocus = null;

    setTimeout(function () {
      if (state.currentTab === 'waveform' && state.waveformChart) state.waveformChart.resize();
      if (state.currentTab === 'spectrum' && state.spectrumChart) state.spectrumChart.resize();
    }, 0);
  }

  function readSpectrumMode() {
    var mode = 'fft';
    if (els.specModeOct && els.specModeOct.checked) mode = 'octave';
    state.spectrumMode = mode;
    return mode;
  }

  function handleSpectrumModeChange() {
    readSpectrumMode();
    updateChartLabels();
    if (state.analysisResult) {
      updateSpectrumChart(state.analysisResult);
    }
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
    if (state.analysisResult) {
      updateSpectrumChart(state.analysisResult);
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

  function clearAutoStopTimer() {
    if (state.autoStopTimer) {
      clearTimeout(state.autoStopTimer);
      state.autoStopTimer = null;
    }
  }

  function cleanupRecording() {
    state.recordingSessionId += 1;
    state.recording = false;
    if (state.stopSensor) {
      state.stopSensor();
      state.stopSensor = null;
    }
    if (state.liveUpdateTimer) {
      clearInterval(state.liveUpdateTimer);
      state.liveUpdateTimer = null;
    }
    clearAutoStopTimer();
  }

  function handlePageHide(event) {
    var interruptedRecording = state.recording;
    var interruptedImport = state.importing;
    cleanupRecording();
    if (state.importing) {
      state.importRequestId += 1;
      state.importing = false;
    }

    // A page restored from the back-forward cache keeps its DOM. Synchronize it
    // now so controls cannot remain stuck in their pre-navigation busy state.
    if (event && event.persisted) {
      els.statusDot.classList.remove('recording');
      if (interruptedRecording) {
        setStatus('statusInterrupted');
      } else if (interruptedImport) {
        if (state.analysisResult) {
          setStatus('statusDone', { samples: state.analysisResult.sampleCount });
        } else if (state.sensorAvailable && runtimeProfile) {
          var fs = isFinite(runtimeProfile.fsHz) ? runtimeProfile.fsHz : 0;
          setStatus('statusReady', { fs: fs.toFixed(0) });
        } else {
          setStatus('statusViewer');
        }
      }
      updateUI();
    }
  }

  function handlePageShow(event) {
    if (!event || !event.persisted) return;
    state.recording = false;
    state.importing = false;
    els.statusDot.classList.remove('recording');
    updateUI();
  }

  function startRecording() {
    if (state.recording || state.importing || !state.sensorAvailable) return;

    cleanupRecording();
    state.recording = true;
    state.backgroundedDuringRecording = false;
    state.recordingSessionId += 1;
    var sessionId = state.recordingSessionId;

    try {
      state.stopSensor = Sensor.startListening(function (data) {
        if (!state.recording || state.recordingSessionId !== sessionId) return;
        if (state.rawData.length > 0 &&
            data.t - state.rawData[0].t > MAX_RECORDING_DURATION_MS) {
          showToast(t('toastDurationLimit'));
          stopRecording();
          return;
        }
        state.rawData.push(data);
        if (state.rawData.length >= MAX_RECORDING_SAMPLES) {
          showToast(t('toastSampleLimit', { samples: MAX_RECORDING_SAMPLES }));
          stopRecording();
        }
      });
    } catch (error) {
      cleanupRecording();
      els.statusDot.classList.remove('recording');
      setStatus('statusSensorError');
      showToast(error && error.message ? error.message : String(error));
      updateUI();
      return;
    }

    // Only discard the previous result after sensor registration succeeds.
    // A start-up failure must not make an earlier measurement unexportable.
    state.rawData = [];
    state.analysisResult = null;
    state.datasetProfile = runtimeProfile;
    resetQualityPanel();
    resetChartSummaries();
    updateUI();

    els.statusDot.classList.remove('ready');
    els.statusDot.classList.add('recording');
    setStatus('statusRecording');

    // Live update timer
    state.liveUpdateTimer = setInterval(function () {
      if (state.rawData.length > 0) {
        updateLiveKPI();
      }
    }, 500);

    // Auto-stop by duration
    var duration = parseInt(els.durationSelect.value, 10);
    var requestedDurationMs = duration > 0 ? duration * 1000 : MAX_RECORDING_DURATION_MS;
    var autoStopMs = Math.min(requestedDurationMs, MAX_RECORDING_DURATION_MS);
    var safetyDurationStop = duration <= 0 || requestedDurationMs > MAX_RECORDING_DURATION_MS;
    state.autoStopTimer = setTimeout(function () {
      if (!state.recording || state.recordingSessionId !== sessionId) return;
      if (safetyDurationStop) showToast(t('toastDurationLimit'));
      stopRecording();
    }, autoStopMs);
  }

  function stopRecording() {
    if (!state.recording) return;
    state.recording = false;

    if (state.stopSensor) {
      state.stopSensor();
      state.stopSensor = null;
    }

    if (state.liveUpdateTimer) {
      clearInterval(state.liveUpdateTimer);
      state.liveUpdateTimer = null;
    }
    clearAutoStopTimer();

    els.statusDot.classList.remove('recording');
    els.statusDot.classList.add('ready');

    if (state.rawData.length > 0) {
      setStatus('statusAnalyzing');
      try {
        state.analysisResult = Analysis.analyze(state.rawData);
        if (state.analysisResult.sampling) {
          state.analysisResult.sampling.backgrounded = state.backgroundedDuringRecording;
          if (state.backgroundedDuringRecording && state.analysisResult.sampling.level === 'good') {
            state.analysisResult.sampling.level = 'fair';
          }
        }
        updateKPI(state.analysisResult);
        updateCharts(state.analysisResult);
        updateQualityPanel(state.analysisResult);
        setStatus('statusDone', { samples: state.rawData.length });
      } catch (error) {
        state.analysisResult = null;
        setStatus('statusAnalysisError');
        showToast(error && error.message ? error.message : String(error));
      }
    } else {
      setStatus('statusNoData');
      resetQualityPanel();
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

    els.kpiRms.textContent = rms.toFixed(2);
    els.kpiPeak.textContent = peak.toFixed(2);
    els.kpiFsHz.textContent = fs.toFixed(0);
    els.kpiDuration.textContent = durationS.toFixed(1);
    els.kpiSamples.textContent = state.rawData.length;
    els.kpiFpeak.textContent = '-';
    if (els.kpiFpeakMeta) els.kpiFpeakMeta.textContent = 'Hz';

    // Live waveform update (only when waveform tab is active)
    if (state.currentTab === 'waveform' && dynamic.length > 0) {
      updateWaveformChart(dynamic);
    }
  }

  function updateKPI(result) {
    els.kpiRms.textContent = result.rms.toFixed(2);
    els.kpiPeak.textContent = result.peak.toFixed(2);
    els.kpiFsHz.textContent = result.fsHz.toFixed(1);
    els.kpiFpeak.textContent = result.fPeak > 0 ? result.fPeak.toFixed(1) : '-';
    if (els.kpiFpeakMeta) {
      els.kpiFpeakMeta.textContent = result.fPeak > 0 && result.dominantAxis
        ? t('fpeakMeta', { axis: String(result.dominantAxis).toUpperCase() })
        : 'Hz';
    }
    els.kpiDuration.textContent = (result.durationMs / 1000).toFixed(1);
    els.kpiSamples.textContent = result.sampleCount;
  }

  function resetQualityPanel() {
    if (!els.qualityPanel) return;
    els.qualityPanel.hidden = true;
    els.qualityPanel.classList.remove('level-good', 'level-fair', 'level-poor', 'level-insufficient');
    if (els.qualityBadge) {
      els.qualityBadge.textContent = '-';
      delete els.qualityBadge.dataset.level;
    }
    var fields = [
      els.qualityFs,
      els.qualityJitter,
      els.qualityCompleteness,
      els.qualityMaxGap,
      els.qualityResolution,
      els.qualityNyquist
    ];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i]) fields[i].textContent = '-';
    }
    if (els.qualityMessage) els.qualityMessage.textContent = '';
  }

  function updateQualityPanel(result) {
    if (!els.qualityPanel || !result || !result.sampling) return;
    var quality = result.sampling;
    var level = quality.level || 'insufficient';
    var labelKey = level === 'good'
      ? 'qualityGood'
      : level === 'fair'
        ? 'qualityFair'
        : level === 'poor'
          ? 'qualityPoor'
          : 'qualityInsufficient';
    var messageKey = level === 'good'
      ? 'qualityGoodMessage'
      : level === 'fair'
        ? 'qualityFairMessage'
        : level === 'poor'
          ? 'qualityPoorMessage'
          : 'qualityInsufficientMessage';

    els.qualityPanel.hidden = false;
    els.qualityPanel.classList.remove('level-good', 'level-fair', 'level-poor', 'level-insufficient');
    els.qualityPanel.classList.add('level-' + level);
    if (els.qualityBadge) {
      els.qualityBadge.textContent = t(labelKey);
      els.qualityBadge.dataset.level = level;
    }

    function setMetric(element, value, digits, suffix) {
      if (!element) return;
      element.textContent = isFinite(value) ? Number(value).toFixed(digits) + suffix : '-';
    }

    setMetric(els.qualityFs, quality.fsHz, 1, ' Hz');
    setMetric(els.qualityJitter, quality.jitterPercent, 1, ' %');
    if (els.qualityCompleteness) {
      var completeness = isFinite(quality.completenessPercent)
        ? Number(quality.completenessPercent).toFixed(1) + ' %'
        : '-';
      if (isFinite(quality.estimatedDropped) && quality.estimatedDropped > 0) {
        completeness += ' / -' + Math.round(quality.estimatedDropped);
      }
      els.qualityCompleteness.textContent = completeness;
    }
    setMetric(els.qualityMaxGap, quality.maxGapMs, 1, ' ms');
    setMetric(els.qualityResolution, quality.frequencyResolutionHz, 2, ' Hz');
    setMetric(els.qualityNyquist, quality.nyquistHz, 1, ' Hz');

    if (els.qualityMessage) {
      els.qualityMessage.textContent = t(messageKey) +
        (quality.backgrounded ? t('qualityBackgroundMessage') : '');
    }
  }

  function resetChartSummaries() {
    if (els.waveformSummary) els.waveformSummary.textContent = t('chartPendingSummary');
    if (els.spectrumSummary) els.spectrumSummary.textContent = t('chartPendingSummary');
  }

  function updateChartSummaries(result) {
    if (!result) {
      resetChartSummaries();
      return;
    }
    if (els.waveformSummary) {
      els.waveformSummary.textContent = t('waveformSummary', {
        duration: (result.durationMs / 1000).toFixed(1),
        samples: result.sampleCount
      });
    }
    if (els.spectrumSummary) {
      if (result.fPeak > 0 && result.sampling && result.sampling.spectrumUsable) {
        els.spectrumSummary.textContent = t('spectrumSummary', {
          frequency: result.fPeak.toFixed(2),
          axis: result.dominantAxis ? String(result.dominantAxis).toUpperCase() : '-',
          resolution: result.sampling.frequencyResolutionHz.toFixed(2)
        });
      } else {
        els.spectrumSummary.textContent = t('spectrumUnavailableSummary');
      }
    }
  }

  function updateCharts(result) {
    updateWaveformChart(result.dynamic);
    updateSpectrumChart(result);
    updateChartSummaries(result);
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

  function updateSpectrumChart(result) {
    var fs = result ? result.fsHz : 0;
    var spectrum = null;
    if (result) {
      spectrum = state.spectrumMode === 'octave' ? result.spectrumThird : result.spectrum;
    }

    var primarySpectrum = spectrum && (spectrum.vector || spectrum.mag);
    if (!primarySpectrum || !primarySpectrum.freqs || primarySpectrum.freqs.length === 0) {
      var emptyChart = state.spectrumChart;
      emptyChart.data.labels = [];
      emptyChart.data.datasets = [];
      emptyChart.update('none');
      return;
    }

    var theme = state.chartTheme || getChartTheme();
    var maxFreq = fs > 0 ? fs / 2 : primarySpectrum.freqs[primarySpectrum.freqs.length - 1];
    var labels = [];
    var maxPower = 0;
    var freqs = primarySpectrum.freqs;
    var indices = [];
    var startIndex = state.spectrumMode === 'octave' ? 0 : 1;

    function formatSpectrumLabel(freq) {
      if (state.spectrumMode !== 'octave') return freq.toFixed(1);
      if (freq >= 100) return freq.toFixed(0);
      if (freq >= 10) return freq.toFixed(1);
      if (freq >= 1) return freq.toFixed(2);
      return freq.toFixed(3);
    }

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

    // Skip DC component for FFT (i=0), keep all for 1/3 octave
    for (var i = startIndex; i < freqs.length; i++) {
      var freq = freqs[i];
      if (freq < fitMin) continue;
      if (freq > fitMax) break;
      labels.push(formatSpectrumLabel(freq));
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
        borderWidth: label === 'Vector' ? 1.5 : 1,
        borderDash: key === 'y'
          ? [8, 3]
          : key === 'z'
            ? [2, 3]
            : key === 'vector' || key === 'mag'
              ? [10, 3, 2, 3]
              : [],
        pointRadius: 0,
        fill: !!fill,
        tension: 0.2
      });
    }

    if (selection.x) addDataset('x', 'X', theme.lineX, false);
    if (selection.y) addDataset('y', 'Y', theme.lineY, false);
    if (selection.z) addDataset('z', 'Z', theme.lineZ, false);
    if (selection.mag) addDataset(spectrum.vector ? 'vector' : 'mag', 'Vector', theme.lineMag, true);

    if (datasets.length === 0) {
      addDataset(spectrum.vector ? 'vector' : 'mag', 'Vector', theme.lineMag, true);
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
    if (state.analysisResult) {
      updateSpectrumChart(state.analysisResult);
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
    els.tabWaveform.setAttribute('aria-selected', tab === 'waveform' ? 'true' : 'false');
    els.tabSpectrum.setAttribute('aria-selected', tab === 'spectrum' ? 'true' : 'false');
    els.tabWaveform.tabIndex = tab === 'waveform' ? 0 : -1;
    els.tabSpectrum.tabIndex = tab === 'spectrum' ? 0 : -1;
    els.waveformWrap.setAttribute('aria-hidden', tab === 'waveform' ? 'false' : 'true');
    els.spectrumWrap.setAttribute('aria-hidden', tab === 'spectrum' ? 'false' : 'true');
    els.waveformWrap.style.display = tab === 'waveform' ? 'block' : 'none';
    els.waveformRange.style.display = tab === 'waveform' ? 'block' : 'none';
    els.spectrumWrap.style.display = tab === 'spectrum' ? 'block' : 'none';
    els.spectrumNote.style.display = tab === 'spectrum' ? 'block' : 'none';
    els.spectrumMode.style.display = tab === 'spectrum' ? 'block' : 'none';
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
    var busy = state.recording || state.importing;

    // Measurement controls: disabled entirely when sensor is unavailable
    els.btnStart.disabled = !canMeasure || busy;
    els.btnStop.disabled = !canMeasure || !state.recording;
    els.durationSelect.disabled = !canMeasure || busy;

    els.importInput.disabled = busy;
    els.importWrap.classList.toggle('is-disabled', busy);
    els.importWrap.setAttribute('aria-disabled', busy ? 'true' : 'false');

    // Export: available whenever data exists (measured or imported)
    els.btnCsv.disabled = !hasData || busy;
    els.btnJson.disabled = !hasData || busy;
    els.btnZip.disabled = !hasData || busy;
    els.btnPackage.disabled = !hasData || busy;
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
      Export.downloadJSON(state.analysisResult, state.datasetProfile),
      'toastJson'
    );
  }

  function exportZIP() {
    if (!state.analysisResult) return;
    handleExport(Export.downloadZIP(
      state.rawData,
      state.analysisResult.dynamic,
      state.analysisResult,
      state.datasetProfile
    ), 'toastZip');
  }

  function exportPackage() {
    if (!state.analysisResult) return;
    handleExport(
      Export.downloadPackage(state.rawData, state.analysisResult, state.datasetProfile),
      'toastPackage'
    );
  }

  // Import handler
  function handleImport(e) {
    var file = e.target.files && e.target.files.length > 0 ? e.target.files[0] : null;
    // Reset immediately so selecting the same file again still emits change.
    e.target.value = '';
    if (file) importFile(file);
  }

  function importFile(file) {
    if (state.recording || state.importing) {
      showToast(t('toastImportBusy'));
      return;
    }

    var requestId = state.importRequestId + 1;
    var previousStatusKey = state.statusKey;
    var previousStatusParams = state.statusParams;
    var committed = false;
    state.importRequestId = requestId;
    state.importing = true;
    setStatus('statusImporting');
    updateUI();

    Import.handleFile(file)
      .then(function (result) {
        if (requestId !== state.importRequestId) return;
        var nextAnalysis = Import.reanalyze(result.rawData);
        var importedSampling = result.analysis && result.analysis.sampling;
        if (nextAnalysis.sampling && importedSampling && importedSampling.backgrounded === true) {
          nextAnalysis.sampling.backgrounded = true;
          if (nextAnalysis.sampling.level === 'good') nextAnalysis.sampling.level = 'fair';
        }

        // Commit the dataset only after validation and reanalysis both succeed.
        // This keeps raw data and metrics from different files from mixing.
        state.rawData = result.rawData;
        state.analysisResult = nextAnalysis;
        state.datasetProfile = result.profile || null;
        committed = true;

        updateKPI(state.analysisResult);
        updateCharts(state.analysisResult);
        updateQualityPanel(state.analysisResult);
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
        if (requestId !== state.importRequestId) return;
        var message = err && err.message ? err.message : String(err);
        if (committed) {
          setStatus('statusImportedDisplayError');
          showToast(t('toastImportDisplayFail', { error: message }));
        } else {
          setStatus(
            previousStatusKey || (state.sensorAvailable ? 'statusReady' : 'statusViewer'),
            previousStatusParams || {}
          );
          showToast(t('toastImportFail', { error: message }));
        }
      })
      .finally(function () {
        if (requestId !== state.importRequestId) return;
        state.importing = false;
        updateUI();
      });
  }

  function showToast(msg) {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    state.toastTimer = setTimeout(function () {
      els.toast.classList.remove('show');
      state.toastTimer = null;
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
