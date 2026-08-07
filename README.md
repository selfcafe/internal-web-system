# internal-web-system

セルフカフェの社内ポータル（パートナー用ポータル／管理者用ポータル）。GitHub Pages上で動く単一の静的サイトで、Google Apps Script（GAS）をバックエンドAPIとして使い、一部データはFirebase Realtime Databaseでリアルタイム同期しています。

- 公開URL: https://selfcafe.github.io/internal-web-system/
- パートナー側・管理者側どちらも `index.html` 1ファイルの中で、ログイン方式（店舗パスワード or 管理者パスワード）によって表示を切り替えています。

## できること

- **発注管理**: パートナーが商品を発注依頼→管理者が確認・確定
- **棚卸表**: 月次の棚卸入力・締め処理、原価把握用の外部シート連携
- **チェックシート**: 日次のデイリーカウント・清掃点検項目の入力（店舗ごとにカスタマイズ可能）
- **忘れ物管理**: 忘れ物の登録・一覧
- **納品履歴**: 発注に対する納品記録
- **業務開始（出勤）**: 位置情報付きの出勤打刻、休み申請、業務日数/休んだ日数の集計
- **請求書**: パートナー向け請求書関連機能
- **管理者向け設定画面**: 商品設定・チェック項目設定・店舗管理・エリア設定など、ほぼ全ての運用ルールを管理画面から変更可能

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | アプリ本体（パートナー/管理者ポータル、全ロジック込み） |
| `gas_backend.gs` | バックエンドAPI（Google Apps Script）。Google スプレッドシートを実データベースとして読み書きする |
| `stores.js` | 店舗マスタ（店舗ID・店舗名など）。フロント用だが `gas_backend.gs` からも動的に取得して参照している |
| `admin-guide.html` / `guide.html` | 管理者向け・パートナー向けの操作マニュアル |
| `invoice.html` | 請求書関連ページ |
| `manifest.json` / `icon-*.png` / `splash-*.png` / `apple-touch-icon.png` | PWA（ホーム画面追加）用の設定・アイコン |

## デプロイ

- **Apps Scriptプロジェクト**: https://script.google.com/u/1/home/projects/1J5qtNKPyXt3L7wmX6MMmAD33t1LQF5hBaDfjG2mghCinlc4h4xwagxP2/edit （selfcafe001@gmail.comアカウントでログインすると閲覧可能。実行数ログもここから確認する）
- **`index.html`など静的ファイル**: `main`ブランチへのpushでGitHub Pagesが自動反映（数分以内）。
- **`gas_backend.gs`**: 自動デプロイされない。変更後は必ず、Google Apps Scriptエディタにコードを貼り付けて「デプロイ→デプロイを管理→新しいバージョン」で手動デプロイする必要がある。
  - リポジトリ内の`SHEET_ID`・`IMAGE_FOLDER_ID`等はダミー値（伏せ字）になっているため、Apps Scriptエディタに貼り付けた後は本番の実値に戻すこと。
- データの実体はFirebase Realtime Database（ライブ同期用ping）とGoogle スプレッドシート（実データ）。Firebaseのセキュリティルールはこのリポジトリには含まれておらず、Firebaseコンソール側でのみ管理されている。

## ローカルでの動作確認

```bash
python -m http.server <高めのランダムポート>
```

- 低い番号のポート（8000〜9000番台）は過去のセッションが残した`http.server`の残骸プロセスと衝突することがあるため、19000番台などの高いポートを使うこと。
- ログイン画面をバイパスしたい場合は、ブラウザの`sessionStorage`に以下を設定してリロードする。
  ```js
  sessionStorage.setItem('site_authed', '1');
  sessionStorage.setItem('site_authed_store', '<店舗ID>'); // パートナー側
  // または
  sessionStorage.setItem('admin_authed', '1'); // 管理者側
  ```
- `initGas()`は実際に本番のGAS APIへ生きた通信を行うため、ローカル検証中でも本番の実データを読み込む点に注意（読み取り専用の確認なら問題ないが、保存系関数は不用意に呼ばないこと）。

## 開発フロー

- リポジトリを直接clone→編集→commit→`main`へ直接push（PRは使っていない）。
- リアルタイム同期・全件置き換え保存に関わる箇所（`_initRealtime`、`_syncStoreToDb`、`saveOrders`等）を触る変更は、pushの前に差分を確認してもらうこと。
