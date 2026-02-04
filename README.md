# Smartphone Vibration Meter (Static Web App on GitHub Pages)

スマホのセンサー（加速度）を使って、**簡易振動計測 → 分析 → グラフ表示 → データ共有（ダウンロード/共有シート）**までを行う、**静的Webアプリ（HTML/CSS/JSのみ）**です。  
ホスティングは **GitHub Pages** を前提にしています（HTTPS必須）。

> **注意（免責）**
> 本アプリは簡易計測・参考用途です。
> 厳密な計測/評価が必要な場合は、専用計測器・規格に基づく手順を使用してください。

---

## 目的 / ゴール

- **センサーが利用可能か**を最初に確実に判定（HTTPS / 権限 / 実イベント取得）
- 端末の“機種名”ではなく、取得できる情報から **capability（能力）プロファイル**を作って処理を自動切替
- 計測した **波形・分析結果をダウンロード**（CSV/JSON/ZIP）
- 対応端末は **Web Share API** で共有（AirDrop/LINE/メール等）
- **インポート**により、他人が受け取ったデータをアプリ上で復元表示できる

---

## 主要機能

### 1. 規約/プライバシー表示 → 同意
- `/terms` 利用規約（静的ページ）
- `/privacy` プライバシーポリシー（静的ページ）
- 初回は同意チェックが必須（localStorageに同意フラグを保存）

### 2. センサーチェック（事前診断）
- `window.isSecureContext` による HTTPS 判定
- `DeviceMotionEvent` の存在確認
- iOS Safari系では `DeviceMotionEvent.requestPermission()` を **ボタン押下（ユーザー操作）内**で実行
- `devicemotion` を 1～2秒プローブして **イベントが来るか・値が null でないか**を確認
- イベント間隔から **推定サンプリング周波数 fs[Hz]** を算出

### 3. Capability プロファイル作成（機種名依存を避ける）
例：
- `needsPermission`: `requestPermission` が必要か
- `hasAccG`: `accelerationIncludingGravity` が取得できるか
- `fsHz`: 推定サンプルレート
- `hasRotationRate`: `rotationRate` が使えるか（任意）

これにより解析/表示を自動切替：
- `fsHz < 25` → スペクトル表示を簡略化/参考表示にする
- `hasAccG=false` → 計測不可として案内

### 4. 計測・分析
- 計測：加速度（x,y,z）を時刻付きで保存
- 重力除去：ローパスで重力推定 → 差分で“振動成分”
- 指標：RMS/Peak/Peak-to-Peak/簡易卓越周波数（任意）
- グラフ：時間波形（必須）、スペクトル（任意）

### 5. エクスポート / 共有
- **ダウンロード**（必須）
  - `raw.csv`（時刻, ax, ay, az, magDyn）
  - `analysis.json`（RMS, peak, fPeak, 設定, deviceProfile）
  - `package.json`（raw+analysisをまとめた1ファイルでも可）
  - 可能なら `export.zip`（複数ファイルをまとめる）
- **共有**（任意）
  - `navigator.canShare({ files })` が使える場合は共有シート
  - 使えない場合はダウンロードにフォールバック

### 6. インポート（復元表示）
- Exportした `package.json`（またはzip）を読み込み
- グラフと指標を復元して表示

---

## 技術要件

- 静的ホスティング（GitHub Pages）
- フロントのみ（サーバ不要）
- HTTPS 前提（センサー系の制約）
- 対応ブラウザ：
  - iOS Safari（権限要求が必要）
  - Android Chrome（多くはそのまま取得可能）
- ライブラリ（候補）：
  - グラフ：Chart.js など（CDNでもOK）
  - ZIP：JSZip（採用する場合）
  - FFT：必要なら fft.js など（※最初はDFTでも可）

---

## リポジトリ構成（例）
.
├─ index.html # 入口（同意→チェック→アプリへ）
├─ app/
│ ├─ index.html # 計測・分析UI
│ ├─ app.js # メインロジック
│ ├─ sensor.js # センサーチェック/permission/capabilities
│ ├─ analysis.js # RMS/peak/重力除去/スペクトル
│ ├─ export.js # CSV/JSON/ZIP/Share
│ ├─ import.js # package読み込み/復元
│ └─ style.css
├─ legal/
│ ├─ terms.html # 利用規約
│ └─ privacy.html # プライバシーポリシー
└─ README.md

### yaml例

## 画面/フロー（必須）

1. **トップ**：説明 + 「利用規約/プライバシー」リンク + ✅同意チェック + 「センサーチェック開始」ボタン  
2. **チェック結果画面**：
   - OK → 「計測画面へ」
   - NG → 理由（HTTPS/権限/非対応）と対処（別ブラウザ/設定/再試行）
3. **計測画面**：
   - Start/Stop
   - KPI（RMS/Peak/fsHz）
   - 時間波形
   - Export（ダウンロード/共有）
   - Import（復元）

---

## 実装メモ（重要）

### iOS権限要求の注意
- `DeviceMotionEvent.requestPermission()` は **ユーザー操作の中**で呼ぶこと
- 例：同意→「センサーチェック開始」クリック内で requestPermission → プローブ

### “機種判定”は補助扱い
- 可能なら `navigator.userAgentData.getHighEntropyValues(["model"])` を試す（取得できないことも多い）
- 主要分岐は capability プロファイルで行う

### サンプリング間隔の揺れ
- `devicemotion` の発火間隔は揺れる可能性がある
- 周波数解析を真面目にする場合は
  - タイムスタンプで等間隔リサンプリング
  - 窓関数
  - FFT
  を検討（初期版は簡易でOK）
