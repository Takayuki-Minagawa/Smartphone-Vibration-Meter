# Smartphone Vibration Meter

スマートフォンの加速度センサーを使った簡易振動計測 Web アプリです。
計測・分析・グラフ表示・データ共有までをブラウザだけで完結します。

GitHub Pages（HTTPS）でホスティングする静的サイト（HTML / CSS / JS のみ）です。

> **注意（免責）**
> 本アプリは簡易計測・参考用途です。
> 厳密な計測や評価が必要な場合は、専用計測器・規格に基づく手順を使用してください。

---

## 主な機能

- **センサー自動診断** — HTTPS 判定・権限要求・プローブを経て Capability プロファイルを生成
- **リアルタイム計測** — 加速度（x / y / z）を時刻付きで記録し、KPI をライブ更新（単位: cm/s&sup2;）
- **分析** — 重力除去（ローパスフィルタ）・RMS / Peak / 卓越周波数（FFT）
- **グラフ表示** — 時間波形とパワースペクトルをタブ切替で表示
- **エクスポート** — CSV / JSON / ZIP ダウンロード、Web Share API による共有
- **インポート** — エクスポートしたデータを読み込み、グラフと指標を復元
- **閲覧モード** — センサー非搭載の端末（PC 等）でもインポート・グラフ表示が可能

---

## 画面フロー

1. **トップページ** — アプリ説明 → 利用規約・プライバシーポリシーへのリンク → 同意チェック → 「センサーチェック開始」
2. **診断結果**
   - OK → 「計測画面へ進む」
   - NG → 原因表示（HTTPS / 権限 / 非対応）＋「閲覧モードで進む（インポートのみ）」
3. **計測画面** — Start / Stop・KPI・波形・スペクトル・Export / Import

---

## 対応環境

| 環境 | 備考 |
| ---- | ---- |
| iOS Safari | `DeviceMotionEvent.requestPermission()` をユーザー操作内で実行 |
| Android Chrome | 多くの端末でそのまま取得可能 |
| デスクトップブラウザ | センサー非搭載のため閲覧モード（インポート・グラフ表示のみ） |

---

## 技術スタック

| 項目 | 選定 | ライセンス |
| ---- | ---- | --------- |
| グラフ描画 | [Chart.js v4](https://www.chartjs.org/)（CDN） | MIT |
| ZIP 生成 | [JSZip v3](https://stuk.github.io/jszip/)（CDN） | MIT / GPLv3 dual（MIT で利用） |
| FFT | 自前実装（Radix-2 Cooley-Tukey + Hanning 窓） | — |

サーバーサイドは不要です。すべての処理はブラウザ内で完結し、外部へのデータ送信は行いません。

---

## リポジトリ構成

```text
.
├── index.html                  # トップページ（同意・センサー診断）
├── favicon.svg                 # ファビコン
├── app/
│   ├── index.html              # 計測・分析 UI
│   ├── style.css               # アプリ共通スタイル
│   ├── app.js                  # メインコントローラー
│   ├── sensor.js               # センサー検出・権限・Capability プロファイル
│   ├── analysis.js             # 重力除去・RMS / Peak・FFT スペクトル
│   ├── export.js               # CSV / JSON / ZIP / Web Share
│   └── import.js               # ファイル読み込み・データ復元
├── legal/
│   ├── terms.html              # 利用規約
│   └── privacy.html            # プライバシーポリシー
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Pages デプロイ
├── LICENSE                     # MIT License
├── THIRD-PARTY-NOTICES         # 依存ライブラリのライセンス表記
└── README.md
```

---

## デプロイ

GitHub Actions で `main` ブランチへの push 時に自動デプロイされます。

### 初回設定

1. リポジトリの **Settings → Pages → Source** を **GitHub Actions** に変更
2. `main` へ push する

手動デプロイは Actions タブから **Run workflow** でも実行できます。

---

## Capability プロファイル

機種名に依存せず、実際に取得できるセンサー情報から処理を自動切替します。

| プロパティ | 説明 |
| ---------- | ---- |
| `sensorAvailable` | センサーが利用可能か |
| `needsPermission` | `requestPermission()` が必要か（iOS） |
| `hasAccG` | `accelerationIncludingGravity` が取得できるか |
| `fsHz` | 推定サンプリング周波数 |
| `hasRotationRate` | `rotationRate` が取得できるか |

- `fsHz < 25` → スペクトル表示は参考値として扱う
- `hasAccG = false` かつ `hasAcc = false` → 計測不可（閲覧モードへ）

---

## エクスポート形式

| ファイル | 内容 |
| -------- | ---- |
| `vibration_raw_*.csv` | 時刻・ax・ay・az・動的加速度マグニチュード（単位: cm/s&sup2;） |
| `vibration_analysis_*.json` | RMS・Peak・卓越周波数・デバイスプロファイル・加速度単位（`accelUnit`） |
| `vibration_package_*.json` | 生データ＋分析結果の統合ファイル（インポート用） |
| `vibration_export_*.zip` | 上記すべてをまとめた ZIP |

### 単位について

- 画面表示・エクスポートは **cm/s&sup2;** を採用しています。
- 旧形式のパッケージ（`accelUnit` 未記載）は **m/s&sup2;** とみなして読み込み時に自動換算します。

---

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。
依存ライブラリのライセンスは [THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES) に記載しています。
