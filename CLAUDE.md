# 社内ポータル(internal-web-system) 運用ガイド (Claude Code向け)

このファイルはこのリポジトリを開いたClaude Codeに自動で読み込まれます。セルフカフェのパートナー向けポータル+バックエンド(棚卸・出勤・発注・在庫差異検知等)一式です。

## 0. 全体アーキテクチャ

```
index.html / admin-guide.html / invoice.html 等
  → GitHub Pages(https://selfcafe.github.io/internal-web-system/、mainブランチのルートを直接配信)
  → 通常のgit push origin mainだけで数秒後に自動反映(ビルド不要)

gas_backend.gs
  → Google Apps Script(スクリプト名「社内ポータルスクリプト」)
  → デプロイは2通り:
     ① GitHub Actions(推奨・cloud) — gh workflow run deploy-gas.yml
     ② 手動clasp(緊急時のフォールバック) — 下記2章参照

scripts/*.py (import_stera_daily_sales.py / poll_stera_realtime_sales.py / watchdog_portal_health.py等)
  → Windowsタスクスケジューラで80000785 PC上に常駐実行(このPC=xxxunではない)
  → .github/workflows/stera-daily-import.yml(self-hosted runner、手動再実行用に残置)
```

**⚠️`gas_backend.gs`はSHEET_ID等の実IDを空文字プレースホルダーのまま維持するルール(公開リポジトリのため)。実IDはGitHub Secretsにのみ存在する。**

## 1. デプロイ方法(このPCでなくても実行可能)

**通常はこれだけでよい**(2026-09-12構築、動作確認済み):
```
gh workflow run deploy-gas.yml --repo selfcafe/internal-web-system --ref main
```
`.github/workflows/deploy-gas.yml`(手動実行のみ、`runs-on: ubuntu-latest`)が、GitHub Secretsに登録済みの認証情報・実IDを使って`clasp push`→`clasp deploy`→疎通確認まで自動で行う。**ブラウザ操作を伴わないGoogle公式APIへの呼び出しのみのため、完全クラウドの`ubuntu-latest`で問題なく動く**(後述のstera/kaihipayのブラウザ自動化とは性質が違う)。

必要なGitHub Secrets(`selfcafe/internal-web-system`):
| Secret名 | 用途 |
|---|---|
| `CLASP_CREDENTIALS` | `selfcafe001@gmail.com`のclasp OAuth認証情報(`{client_id,client_secret,refresh_token,access_token,token_type,expiry_date}`) |
| `CLASP_SCRIPT_ID` | Apps ScriptプロジェクトID |
| `CLASP_DEPLOYMENT_ID` | 本番Web AppデプロイID(index.html等が指す`GAS_URL`と同じもの) |
| `SHEET_ID` | メインの社内ポータルデータ(orders/settings/checksheet/attendance等) |
| `INVENTORY_SHEET_ID` | 棚卸集計スプレッドシート([[feature_inventory_phase1]]参照) |
| `DELIVERY_HISTORY_SHEET_ID` | 発注「納品済み」履歴専用スプレッドシート |
| `GAS_URL`/`STERA_EMAIL`/`STERA_PASSWORD` | `stera-daily-import.yml`(self-hosted)用、80000785 PC上のPython実行に必要 |

**index.html側だけの変更は`clasp`不要。** `git push origin main`だけでGitHub Pagesが自動再ビルドする。`gas_backend.gs`を変更した場合のみ上記デプロイが必要。

### 手動clasp(緊急時のフォールバック)
```
clasp push -f --user selfcafe   # gas-clasp的な作業フォルダで、実IDに置換済みのgas_backend.jsを配置してから
clasp deploy -i <CLASP_DEPLOYMENT_ID> --user selfcafe
```
**このPCの`~/.clasprc.json`には`tokens.selfcafe`という名前付きプロファイルで`selfcafe001@gmail.com`の認証情報が入っている。** clasp v3.3.0系で作成した認証情報のため、他のPC/CI環境でも**同じv3.3.0系**のclaspを使わないと`.clasprc.json`形式の非互換で`Error retrieving access token`エラーになる(2026-09-12に実際に発生・解決済み)。

## 2. 権限引き継ぎチェックリスト

このリポジトリは`selfcafe`組織所有のため、GitHubの所有権移転(Transfer)自体は不要。

**一部だけ渡す場合(Outside Collaborator)**:
```
gh repo add-collaborator selfcafe/internal-web-system <相手のGitHubユーザー名> --permission write
```
GitHub Secretsの値自体は招待した相手からは見えない(上書きのみ可能)。GitHub Actions経由のデプロイ(1章)はSecretsが既に登録済みなので、相手が`selfcafe001@gmail.com`のGoogleアカウントを知らなくてもリポジトリ権限だけで実行できてしまう。

**完全に手放す場合**、GitHub権限を外すだけでは不十分。以下も洗い出しが必要:
1. `selfcafe001@gmail.com`自体のログイン情報(パスワード・2段階認証)——Apps Scriptプロジェクト・各スプレッドシートの実質的な所有者
2. `SHEET_ID`/`INVENTORY_SHEET_ID`/`DELIVERY_HISTORY_SHEET_ID`が指す各Googleスプレッドシートの共有設定(誰が編集者になっているか個別確認)
3. 画像保存用Driveフォルダ・請求書テンプレート(`IMAGE_FOLDER_ID`/`INVOICE_TEMPLATE_ID`/`INVOICE_PDF_FOLDER_ID`、いずれも`gas_backend.gs`内で確認可能)
4. **80000785 PC自体へのアクセス**(Tailscale/RDP、[[reference_80000785_remote_access]]参照)——stera日次取込み・在庫差異検知Bot・ポータル監視Botがここで動いている。GitHub権限とは完全に別系統
5. LINE WORKS Bot(在庫差異検知Bot「佐藤テスト」等)の管理者アカウント

**完全に手放した場合、`CLASP_CREDENTIALS`は無効化しておくこと**(`selfcafe001@gmail.com`のGoogleアカウント設定→セキュリティ→サードパーティアクセスからclaspのOAuth権限を取り消せる)。取り消さない限り、GitHub Secretsを知っている人は誰でも(あなたが権限を外された後も)デプロイを実行できてしまう。

## 3. 重大な過去の事故・教訓(抜粋、詳細はClaude Codeメモリ参照)

このリポジトリ自体には載っていないが、繰り返し起きた/起きうる事故のパターンを最低限記録しておく:

- **列ズレ事故が複数回発生している。** シートに新規列を追加する際は必ず末尾に追加し、既存列の並びを変えない(`migrateXxxColumns`系の一発移行関数のパターンを踏襲)。ヘッダーの日本語表示テキストではなく、コード側の宣言順(`XXX_COLS`配列)を正として読み書きする設計を維持すること。
- **日付・年月文字列("2026-07"等)はSheetsが自動的に日付型セルへ変換してしまう。** 書き込み時は`setNumberFormat('@')`でプレーンテキスト固定、読み込み時はDate型を検出してスプレッドシート自身のタイムゾーンで文字列に戻す(`_sheetTz()`/`_invSheetTz()`パターン)。**Apps Scriptの実行タイムゾーンと対象スプレッドシートのタイムゾーンが一致している前提のコードが多い**(両方Asia/Tokyoである前提)。
- **複数端末・複数リクエストからの同時書き込みは「全削除→丸ごと書き直し」ではなくマージ方式にする。** 棚卸表で実際に複数端末の入力が互いを上書きする事故が起きた([[feature_inventory_phase1]]の2026-07-31の項目)。
- **棚卸集計スプレッドシート(`INVENTORY_SHEET_ID`)は1年ごとに新ファイルへ切り替える設計になっている**([[feature_inventory_year_rollover]]、2026-09-12実装)。年をまたぐ日付・期間の参照は`_inventorySheetIdForPeriod_`/`_steraSheetIdsForRange_`を通すこと。新機能を追加する際は`scripts/test_year_boundary_sim.js`で年またぎ・新規店舗のシナリオを演算確認してから本番反映する。
- **clasp本番デプロイ前は必ず`clasp clone`(またはGitHub Actionsのdeploy-gas.yml実行ログ)で本番の現在のコードとリポジトリの差分を確認する習慣をつけること。** 過去に「コミットしたのに本番デプロイし忘れる」積み残しが複数回発生している。

## 4. 関連リポジトリ

- `selfcafe/kaihipay-downloader` — 会費ペイ/e-MOSS自動化(このリポジトリの`kaihipayRequestApproval`/`kaihipayCheckApproval`関数がLINE WORKS承認ゲートとして使われている、[[project_kaihipay_remote_approval_design]]参照)
- `selfcafe/GBP-Post` / `GBP-Post-previews` — Googleビジネスプロフィール自動投稿(このリポジトリとは独立、承認ゲートも別実体)
