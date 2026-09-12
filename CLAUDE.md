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
| `INVENTORY_SHEET_ID` | 棚卸集計スプレッドシート([[feature_inventory_phase1]]参照)。年次切り替え自動化については5章参照 |
| `DELIVERY_HISTORY_SHEET_ID` | 発注「納品済み」履歴専用スプレッドシート |
| `GAS_URL`/`STERA_EMAIL`/`STERA_PASSWORD` | `stera-daily-import.yml`(self-hosted)用、80000785 PC上のPython実行に必要 |
| `SECRETS_ADMIN_TOKEN` | GitHub Secrets/Variablesを書き換えられる強い権限のPAT。5章の年次切り替え専用 |

必要なGitHub Actions Variables:
| Variable名 | 用途 |
|---|---|
| `INVENTORY_SHEET_ID_ARCHIVE_JSON` | 年→旧`INVENTORY_SHEET_ID`のマップ(JSON)。Secretsと違い読み出し可能なので5章の自動更新に使う |

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
6. **`SECRETS_ADMIN_TOKEN`(5章)** — GitHub Secrets/Variablesを書き換えられる強い権限のトークン。手放す際はGitHub側で無効化(Revoke)すること

**完全に手放した場合、`CLASP_CREDENTIALS`は無効化しておくこと**(`selfcafe001@gmail.com`のGoogleアカウント設定→セキュリティ→サードパーティアクセスからclaspのOAuth権限を取り消せる)。取り消さない限り、GitHub Secretsを知っている人は誰でも(あなたが権限を外された後も)デプロイを実行できてしまう。

## 3. 重大な過去の事故・教訓(抜粋、詳細はClaude Codeメモリ参照)

このリポジトリ自体には載っていないが、繰り返し起きた/起きうる事故のパターンを最低限記録しておく:

- **列ズレ事故が複数回発生している。** シートに新規列を追加する際は必ず末尾に追加し、既存列の並びを変えない(`migrateXxxColumns`系の一発移行関数のパターンを踏襲)。ヘッダーの日本語表示テキストではなく、コード側の宣言順(`XXX_COLS`配列)を正として読み書きする設計を維持すること。
- **日付・年月文字列("2026-07"等)はSheetsが自動的に日付型セルへ変換してしまう。** 書き込み時は`setNumberFormat('@')`でプレーンテキスト固定、読み込み時はDate型を検出してスプレッドシート自身のタイムゾーンで文字列に戻す(`_sheetTz()`/`_invSheetTz()`パターン)。**Apps Scriptの実行タイムゾーンと対象スプレッドシートのタイムゾーンが一致している前提のコードが多い**(両方Asia/Tokyoである前提)。
- **複数端末・複数リクエストからの同時書き込みは「全削除→丸ごと書き直し」ではなくマージ方式にする。** 棚卸表で実際に複数端末の入力が互いを上書きする事故が起きた([[feature_inventory_phase1]]の2026-07-31の項目)。
- **棚卸集計スプレッドシート(`INVENTORY_SHEET_ID`)は1年ごとに新ファイルへ切り替える設計になっている**([[feature_inventory_year_rollover]]、2026-09-12実装、5章参照)。年をまたぐ日付・期間の参照は`_inventorySheetIdForPeriod_`/`_steraSheetIdsForRange_`を通すこと。新機能を追加する際は`scripts/test_year_boundary_sim.js`で年またぎ・新規店舗のシナリオを演算確認してから本番反映する。
- **clasp本番デプロイ前は必ず`clasp clone`(またはGitHub Actionsのdeploy-gas.yml実行ログ)で本番の現在のコードとリポジトリの差分を確認する習慣をつけること。** 過去に「コミットしたのに本番デプロイし忘れる」積み残しが複数回発生している。

## 4. 関連リポジトリ

- `selfcafe/kaihipay-downloader` — 会費ペイ/e-MOSS自動化(このリポジトリの`kaihipayRequestApproval`/`kaihipayCheckApproval`関数がLINE WORKS承認ゲートとして使われている、[[project_kaihipay_remote_approval_design]]参照)
- `selfcafe/GBP-Post` / `GBP-Post-previews` — Googleビジネスプロフィール自動投稿(このリポジトリとは独立、承認ゲートも別実体)

## 5. 棚卸集計スプレッドシートの年次切り替え自動化(2026-09-12実装)

[[feature_inventory_year_rollover]]で実装した「1年ごとに新ファイルへ切り替える」運用を、1コマンドで完結させる仕組み。

**⚠️実行タイミングは「毎年1/1深夜(JST)、できるだけ日付が変わってすぐ」固定——月内のどこでも良いわけではない。** 理由: 在庫差異検知のチェックポイント・当日速報売上(`stera_realtime_today`)は「今日」を基準に常に現行ファイルへ書き込む設計のままのため(これ自体は意図的——影響範囲が狭く「参考値」扱いの機能なので、切り替えタイミングを厳密にする方が実装を複雑にするより合理的と判断し、書き込み側の年またぎ対応はここだけ見送った)、切り替えが年境界から大きくズレると、その前後数日分のデータが迷子になるリスクがある。棚卸本体(`saveInventorySnapshot`等)は既にperiodLabel基準で書き込み先を解決するため、このタイミング制約を受けない。

**実行方法**:
```
gh workflow run rollover-inventory-year.yml --repo selfcafe/internal-web-system --ref main -f year=2027 -f dry_run=false
```
`dry_run=true`(既定)では新規スプレッドシート作成のみ行い、本番への影響は一切無い。`year`省略時は実行時点の翌年(JST基準)。

**中身(`.github/workflows/rollover-inventory-year.yml`)**:
1. `provisionNewInventorySheet`(GAS、新規アクション)で新しい年のスプレッドシートを作成
2. `INVENTORY_SHEET_ID_ARCHIVE_JSON`(GitHub Actions Variable)に「旧年: 旧`INVENTORY_SHEET_ID`」を追記——GitHub Secretsは書き込み専用(読み出し不可)なので、複数年にわたって蓄積するアーカイブだけはVariableで管理している
3. `INVENTORY_SHEET_ID`(Secret)を新しいスプレッドシートIDへ上書き
4. `deploy-gas.yml`を起動し、完了(`getSettings`疎通確認まで)を待つ

**`SECRETS_ADMIN_TOKEN`について**: 上記2・3はGitHub Secrets/Variablesの書き換えを伴うが、既定の`GITHUB_TOKEN`にはこの権限が無いため、`gh` CLI操作用のPAT(`repo`+`workflow`スコープ、`Created-by-Luna`アカウントのもの)を新規Secretとして保存し使っている。**これは`CLASP_CREDENTIALS`より強い権限(リポジトリ全体のSecrets/Variables操作権)を持つため、取り扱いに注意すること。**

**動作確認(2026-09-12)**: 各要素を個別に実機検証済み——
- `provisionNewInventorySheet`を実際に本番へ2回叩き、スプレッドシートの新規作成・既存流用(重複防止)の両方を確認
- `rollover-inventory-year.yml`を`dry_run=true`で実行し、新規作成だけが行われ以降のステップが正しくスキップされることを確認
- `dry_run=false`の危険な経路(Secrets/Variables更新)は、本番の`INVENTORY_SHEET_ID`/`INVENTORY_SHEET_ID_ARCHIVE_JSON`ではなく**決め打ちのデコイ名(`TEST_ROLLOVER_*`)を使った専用の使い捨てワークフロー**で実行し、正しく更新されることを確認してから削除した(本番の値には一度も触れていない)
- 上記テストで作成した実スプレッドシート(「棚卸集計_TESTPLAY9999」「棚卸集計_TESTYEAR9999」)はDrive上に残っている——削除権限がこのセッションに無かったため、不要なら手動で削除すること

**まだ手動対応が必要なもの**: 実際に「毎年1/1深夜」に自動実行させるトリガー自体(Claude Codeの`/schedule`ルーティン登録)は、このリポジトリのコードの外の話であり、かつ`/schedule`スキル自体がある種のセッション権限設定では呼び出せないため、**人間が`/schedule`コマンドを直接叩いて「毎年1/1 00:15(JST)に`gh workflow run rollover-inventory-year.yml -f dry_run=false`を実行」という予約を登録する必要がある。** これが完了するまでは、この日付を忘れずに手動実行する運用のままとなる。
