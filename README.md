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
- **リアルタイム計測** — 線形加速度を優先して x / y / z を時刻付きで記録し、KPI をライブ更新（単位: cm/s&sup2;）
- **分析** — 時刻依存の重力除去・等間隔再サンプリング・RMS / Peak・ベクトル PSD による卓越周波数
- **サンプリング品質** — 実測周波数・ジッター・欠損推定・最大ギャップ・周波数分解能・ナイキスト周波数を表示
- **グラフ表示** — 時間波形と PSD / 1/3 オクターブ帯域 RMS をタブ切替で表示
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
| グラフ描画 | [Chart.js v4.5.1](https://www.chartjs.org/)（CDN・SRI検証） | MIT |
| ZIP 生成 | [JSZip v3.10.1](https://stuk.github.io/jszip/)（CDN・SRI検証） | MIT / GPLv3 dual（MIT で利用） |
| FFT | 自前実装（Radix-2 Cooley-Tukey + Hann 窓） | — |

サーバーサイドは不要です。計測・解析・ファイル生成はブラウザ内で完結し、計測データを外部サーバーへ送信しません。初回表示時には Chart.js / JSZip を取得するため jsDelivr CDN へ接続します。

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
│   ├── limits.js               # 記録・取込・解析で共有する安全上限
│   ├── sensor.js               # センサー検出・権限・Capability プロファイル
│   ├── analysis.js             # 重力除去・RMS / Peak・FFT + 1/3 オクターブ
│   ├── export.js               # CSV / JSON / ZIP / Web Share
│   └── import.js               # ファイル読み込み・データ復元
├── legal/
│   ├── terms.html              # 利用規約
│   └── privacy.html            # プライバシーポリシー
├── .github/
│   └── workflows/
│       ├── deploy.yml          # テスト後の GitHub Pages デプロイ
│       └── test.yml            # Pull Request の自動テスト
├── tests/                      # 信号処理・取込・センサー・HTML の単体テスト
├── package.json                # 依存なしの検査・テストコマンド
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
| `hasAcc` | 重力除去済みの `acceleration` が取得できるか |
| `fsHz` | 推定サンプリング周波数 |
| `hasRotationRate` | `rotationRate` が取得できるか |

- 記録長 2 秒未満、実測周波数 10 Hz 未満、分解能 0.5 Hz 超、または大きな時刻揺らぎ・欠損がある場合はスペクトルを表示しない
- `hasAccG = false` かつ `hasAcc = false` → 計測不可（閲覧モードへ）

---

## 表示仕様

- **KPI（RMS / Peak）** は `cm/s²` 表示時に小数点以下 2 桁固定。
- **卓越周波数** は `0.5 Hz` 以上にある `PSD_X + PSD_Y + PSD_Z` の最大成分から算出します。`|mag|` の FFT による周波数倍化を避け、端末の向きに依存しにくい指標にしています。
- **FFT 表示** は平均除去・Hann 窓・片側化を行った PSD で、単位は `(cm/s²)²/Hz` です。
- **1/3 オクターブ表示** は PSD を各帯域で積分した帯域 RMS で、単位は `cm/s²` です。
- **`|mag|`** は時間波形と RMS / Peak に使う合成加速度で、`mag = sqrt(X^2 + Y^2 + Z^2)`（X/Y/Z は重力除去後の成分）です。
- センサー時刻の品質が解析条件を満たさない場合、スペクトルは算出せず品質パネルで警告します。

---

## エクスポート形式

| ファイル | 内容 |
| -------- | ---- |
| `vibration_raw_*.csv` | 時刻・ax・ay・az・動的加速度マグニチュード（単位: cm/s&sup2;） |
| `vibration_analysis_*.json` | RMS・Peak・卓越周波数・サンプリング品質・デバイスプロファイル（閲覧用、再取込不可） |
| `vibration_package_*.json` | 生データ＋分析結果の統合ファイル（インポート用） |
| `vibration_export_*.zip` | 上記すべてをまとめた ZIP |

### 保存先・インポートについて

- **保存先の指定**：Web アプリ側では保存先（フォルダ/パス）を指定できません。保存場所はブラウザ/OS の挙動に従います（例: iOS は「ファイル」、Android は「ダウンロード」等）。Web Share API が利用できる端末では共有シートが開き、保存先アプリや場所をユーザーが選べます。
- **インポート対象**：インポートはブラウザのファイル選択ダイアログからユーザーが選んだファイルのみを読み込みます。端末のファイルピッカーが iCloud Drive / Google Drive 等を表示する場合はそこから選択できますが、アプリ側から外部ストレージを直接参照することはできません。
- **検証と上限**：再取込用 JSON / ZIP は形式・version・単位・有限値・時刻順を検証します。安全のため 25 MiB、120,000 サンプル、1 時間、各軸絶対値 10,000,000 cm/s² を上限とし、ZIP は展開中にもサイズを監視します。記録側にも同じサンプル数・時間上限を適用します。

### 単位について

- 画面表示・エクスポートは **cm/s&sup2;** を採用しています。
- version 未記載または 1.x の旧パッケージで `accelUnit` がない場合は **m/s&sup2;** とみなし、自動換算します。version 2.x では単位指定が必須です。

---

## 開発・検証

Node.js 20 以上で、追加依存なしに構文検査と単体テストを実行できます。

```bash
npm run check
npm test
```

テストには既知周波数の正弦波、サンプリングジッター／欠損、PSD 正規化、1024/1025 点境界、旧パッケージ互換、不正インポート、HTML の構文・ARIA参照検査が含まれます。Pull Request と GitHub Pages デプロイでは Node.js 20 / 22 の両方で同じ検査を実行します。

---

## ライセンス

MIT License — 詳細は [LICENSE](./LICENSE) を参照してください。
依存ライブラリのライセンスは [THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES) に記載しています。
