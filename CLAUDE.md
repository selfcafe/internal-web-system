# 社内ポータル(internal-web-system) 運用ガイド (Claude Code向け)

このファイルはこのリポジトリを開いたClaude Codeに自動で読み込まれます。人間向けの引継ぎ書・未完成部分の一覧は[HANDOVER.md](HANDOVER.md)。セルフカフェのパートナー向けポータル+バックエンド(棚卸・出勤・発注・在庫差異検知等)一式です。

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
  → Windowsタスクスケジューラで80000785 PC(前任者PC。HANDOVER.mdでは「前任者PC」と表記)上に常駐実行
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
| `INVENTORY_SHEET_ID` | 棚卸集計スプレッドシート(`inventory_log`・店舗タブ・全店舗棚卸集計を持つ、8章「棚卸表」参照)。年次切り替え自動化については5章参照 |
| `BUGREPORT_SHEET_ID` | バグ報告専用スプレッドシート(6章) |
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
4. **80000785 PC自体へのアクセス**(状態確認は`selfcafe/pc-remote-ops`のself-hosted runner経由、8章「外部PC・Bot・clasp」参照)——stera日次取込み・在庫差異検知Bot・ポータル監視Botがここで動いている。GitHub権限とは完全に別系統
5. LINE WORKS Bot(在庫差異検知Bot「佐藤テスト」等)の管理者アカウント
6. **`SECRETS_ADMIN_TOKEN`(5章)** — GitHub Secrets/Variablesを書き換えられる強い権限のトークン。手放す際はGitHub側で無効化(Revoke)すること

**完全に手放した場合、`CLASP_CREDENTIALS`は無効化しておくこと**(`selfcafe001@gmail.com`のGoogleアカウント設定→セキュリティ→サードパーティアクセスからclaspのOAuth権限を取り消せる)。取り消さない限り、GitHub Secretsを知っている人は誰でも(あなたが権限を外された後も)デプロイを実行できてしまう。

## 3. 重大な過去の事故・教訓(抜粋、機能別の詳細は8章)

このリポジトリ自体には載っていないが、繰り返し起きた/起きうる事故のパターンを最低限記録しておく:

- **列ズレ事故が複数回発生している。** シートに新規列を追加する際は必ず末尾に追加し、既存列の並びを変えない(`migrateXxxColumns`系の一発移行関数のパターンを踏襲)。ヘッダーの日本語表示テキストではなく、コード側の宣言順(`XXX_COLS`配列)を正として読み書きする設計を維持すること。
- **日付・年月文字列("2026-07"等)はSheetsが自動的に日付型セルへ変換してしまう。** 書き込み時は`setNumberFormat('@')`でプレーンテキスト固定、読み込み時はDate型を検出してスプレッドシート自身のタイムゾーンで文字列に戻す(`_sheetTz()`/`_invSheetTz()`パターン)。**Apps Scriptの実行タイムゾーンと対象スプレッドシートのタイムゾーンが一致している前提のコードが多い**(両方Asia/Tokyoである前提)。
- **複数端末・複数リクエストからの同時書き込みは「全削除→丸ごと書き直し」ではなくマージ方式にする。** 棚卸表で実際に複数端末の入力が互いを上書きする事故が起きた(2026-07-31、`saveInventorySnapshot`をマージ方式に修正。8章「棚卸表」参照)。
- **棚卸集計スプレッドシート(`INVENTORY_SHEET_ID`)は1年ごとに新ファイルへ切り替える設計になっている**(2026-09-12実装、5章参照。旧年のIDは`INVENTORY_SHEET_ID_ARCHIVE`で引く)。年をまたぐ日付・期間の参照は`_inventorySheetIdForPeriod_`/`_steraSheetIdsForRange_`を通すこと。新機能を追加する際は`scripts/test_year_boundary_sim.js`で年またぎ・新規店舗のシナリオを演算確認してから本番反映する。
- **clasp本番デプロイ前は必ず`clasp clone`(またはGitHub Actionsのdeploy-gas.yml実行ログ)で本番の現在のコードとリポジトリの差分を確認する習慣をつけること。** 過去に「コミットしたのに本番デプロイし忘れる」積み残しが複数回発生している。

## 4. 関連リポジトリ

- `selfcafe/kaihipay-downloader` — 会費ペイ/e-MOSS自動化。LINE WORKS承認ゲート(`kaihipayRequestApproval`/`kaihipayCheckApproval`)は当初このリポジトリに実装したが、2026-08-10に別GASプロジェクト`kaihipay-gbp-approval-bot`へ移設済みで、**このリポジトリには無い**(社内ポータルのexec URLへ送ると`Unknown action`になる)。`scripts/watchdog_portal_health.py`の認可切れ通知だけがこの承認Bot経由で送られる。
- `selfcafe/GBP-Post` / `GBP-Post-previews` — Googleビジネスプロフィール自動投稿(このリポジトリとは独立、承認ゲートも別実体)

## 5. 棚卸集計スプレッドシートの年次切り替え自動化(2026-09-12実装)

3章の「1年ごとに新ファイルへ切り替える」運用を、1コマンドで完結させる仕組み。

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

**自動実行トリガー登録済み(2026-09-12)**: 毎年1/1 00:15(JST)に自動発火するClaude Codeの`/schedule`ルーティン(cloud routine)を登録済み。routine: https://claude.ai/code/routines/trig_01BPsb39P38g8n7PYoRMbZVk (次回発火: 2027-01-01 00:15 JST)。

- 発火するとクラウドエージェントが`TZ=Asia/Tokyo date +%Y`でJST基準の年を取得し(発火時点で既にJSTは新年に入っているため、そのままの年を使う。`+1`しない・省略もしない)、GitHub MCPツール(`actions_run_trigger`、method: run_workflow)で`rollover-inventory-year.yml`を`year=<その年>, dry_run=false`で起動、完了まで監視して結果を報告する。失敗時は自動リトライせず報告のみ(本番Secrets操作のため)。
- 事前にトリガー機構自体を`year=9999, dry_run=true`のデコイ値で実機テスト済み(2026-09-12、Run ID `34698834540`、success)——クラウド環境からのGitHub認証・workflow_dispatch起動が問題なく動くことを確認済み。
- ルーティンの一覧・削除は https://claude.ai/code/routines から(API側に削除機能は無い)。プロンプト内容の変更は`/schedule`スキルの update アクションで行う。

## 6. バグ報告機能・LINE WORKS Bot連携(2026-09-25更新)

バグ報告/修正依頼機能は、専用スプレッドシート(`BUGREPORT_SHEET_ID`、`bug_reports`/`bug_report_comments`タブ)にデータを持つ。メインDB(`SHEET_ID`)とは分離済み(2026-09、リスク低減のため意図的に別ファイル化)。`status`列の格納値は2026-09-19に`open`/`doing`/`done`から**日本語ラベル(未対応/対応中/完了)そのもの**へ統一し、Sheets側にもプルダウン(データ入力規則)を設定した(`seedBugReportSheetGuide_`が「使い方」タブの整備・プルダウン設定・旧値移行を一括で行う、`?action=seedBugReportSheetGuide`で再実行可能・何度実行しても安全)。

**投稿経路は2つ**:
1. ポータル(パートナー/管理者/社員)からの投稿 — 画像添付対応済み(lost_itemsと同じDrive保存の仕組みを再利用)
2. LINE WORKS Bot「バグ報告（社内ポータル）」(Bot ID 13130517)への1:1メッセージ — テキスト・画像とも受信対応済み(`handleLineWorksBugReport_`/`handleLineWorksBugReportImage_`)。認証情報は在庫差異Botとは別のScript Propertiesキー(`LW_CLIENT_ID_BUGREPORT`等)で独立管理。テキストと画像は別イベントで届くため、CacheServiceで3分間(画像が届くたびに延長)「直前の投稿」を紐付けて同じ報告にまとめる。

**Bot振り分け(2026-09-24実機確認済み)**: LINE WORKSのコールバックペイロードにはbotIdが含まれない(type/source{userId,domainId}/issuedTime/contentのみ)。そのためバグ報告BotのCallback URLには`?bot=bugreport`を付けて在庫差異Botと区別している(`_routeLineWorksCallback_`)。パラメータ無し=在庫差異Bot。画像添付取得も実機で動作確認済み。

**運用方針(2026-09-25確定、ユーザーと合意)**: 管理の中心はLINE WORKS。パートナーへの連絡はポータル経由(パートナーはLINE WORKSを使わない)。どこから操作しても同じ記録・通知になるよう、返信は`addBugReportComment`、ステータス変更は`updateBugReportStatus`に集約し、通知もこの2関数が`_notify`に積む。

| 操作 | LINE WORKS(管理者) | シート | 管理者ポータル |
|---|---|---|---|
| 返信 | `No.5 本文` | bug_reportsの`reply_input`列に書く(自動で空欄に戻る) | スレッドの返信欄 |
| ステータス変更 | `No.5 完了`(本文がステータス名だけ) | status列のプルダウン | ステータスボタン |

- **Claude Codeセッションからも操作できる**(2026-10-04追加): `python scripts/bugreport.py list`(未対応・対応中の一覧、`--all`で完了も)/ `show 4` / `reply 4 "本文"` / `status 4 完了`。管理者ポータルと同じ`addBugReportComment`/`updateBugReportStatus`を呼ぶので、履歴・報告者への通知も同じになる。返信・ステータス変更は報告者に届くので、セッションから実行する前に内容をユーザーに確認すること。
- 報告番号は「No.」必須(`5 本文`のような素の数字は新規報告扱い。数字始まりの報告の誤認を防ぐため)。全角(`Ｎｏ．５`)・括弧付き(`(No.5)`)も可。
- 管理者以外が`No.5 本文`と送ると、その報告への**追記**として記録し管理者全員へ通知(`handleLineWorksBugReportFollowUp_`)。パートナーがポータルのスレッドに書いた場合も同様に管理者全員へ通知。
- 管理者の返信・ステータス変更 → LINE WORKS経由の報告なら報告者本人へLINE WORKSで転送。ポータル経由の報告はスレッドに記録され、パートナー側の一覧に「返信あり」バッジ(端末ごとのlocalStorageで既読管理、`_bugReportHasUnread`)。
- **管理者の判定は`_isBugReportAdmin_`に集約**。バグ報告スプレッドシートの「管理者」タブ(`name`/`lineworks_user_id`/`memo`)が正で、行の追加・削除で即反映(デプロイ不要)。1人も登録が無い場合のみ`LW_USER_ID_BUGREPORT`を管理者とみなす。新規報告・追記の通知は管理者全員に送る。
- シート操作は`onBugReportSheetEdit`(インストール型onEditトリガー、`?action=setupBugReportSheetTrigger`で登録・重複登録しない)が処理する。人の手による編集でしか発火しないので、スクリプトの書き込みと二重処理にならない。
- 9/24以前の報告には`no`が無いため番号指定できない(ユーザー判断で対応不要)。
- **列の並び(2026-09-25変更)**: 人がシートを見て報告を特定できるよう、`bug_reports`の`no`と`bug_report_comments`の`report_no`をA列へ移動済み(`_moveColumnToFront_`、seedBugReportSheetGuideで実行)。この2枚は例外的に**3章の「宣言順を正とする」ルールを適用せず、書き込みは全て`_appendRowByHeaders_`(ヘッダー名で列を引く)**にしてあるので、列を動かしてもズレない。この2枚に位置指定の`appendRow([...])`を新たに書かないこと。

**実機テスト状況(2026-09-25時点)**:
- ✅ 確認済み: LINE WORKSからの新規報告(No.3)、管理者の`No.3 本文`による返信、ステータス変更(9:20〜9:23のデータで記録を確認)
- ⏸ 未実施(ユーザー判断で「テストは今度」): ①シートの`reply_input`記入・status列プルダウン変更(onEditトリガー) ②管理者以外からの`No.n 本文`追記 ③パートナーポータルの「返信あり」バッジ
- ②のテスト方法: 別アカウント不要。「管理者」タブの自分の行の`lineworks_user_id`を一時的に`test`等へ書き換えてから送り、終わったら戻す(行を消すだけだとタブが空になり、`LW_USER_ID_BUGREPORT`=本人が管理者に戻るので不可)
- 管理者判定を「文章の内容」で行う方式もユーザーと検討したが、誰でも`完了 No.3`等でステータスを変えられてしまう(特にグループトーク化後)ため、**管理者方式(ユーザーID)のまま維持と確定**
- テスト用投稿(No.2「(No.1)返信テスト」、No.3「テスト送信」)が残っている。テスト完了後に管理者ポータルから削除してよい

**将来構想(未実装)**: 完成後、Botを「バグ報告」グループトーク(報告者と管理者が同じグループ)へ移す予定。その場合も管理者判定はユーザーID方式(`_isBugReportAdmin_`)のまま使える。未確認事項: グループ内の全メッセージがBotに届くか、コールバックにchannelIdがどう入るか、グループ宛ての送信API。グループでは全発言が報告として登録される点(お礼等)の扱いも要検討。

**過去の事故**: 2026-09-15、このBotのコードだけgit未コミットのままclaspで直接本番投入していたため、翌々日のGitHub Actions経由デプロイ(gas_backend.gsの内容でclasp push)で本番から消えた。以後、この種のBotコードは必ず`gas_backend.gs`にコミットしてからデプロイすること(`createBugReportBotJWT_`直上のコメント参照)。

## 7. 保留中・未着手の作業(2026-10-01時点)

別のPC・別セッションから続きをやる場合はここから。着手・完了したらこの節を更新すること。

### 7.1 【対応済み 2026-10-05】店舗の端末には自店舗分+共通部分の設定だけを渡す

- パートナー画面・ログイン画面は`getStoreSettings&storeId=...`(GAS)を読む。`STORE_SCOPED_SETTING_KEYS`(`store_product_cfg`・`store_checksheet_cfg`、gas_backend.gsとindex.htmlの両方にある。増減するときは両方揃える)だけ指定店舗の分に絞り、他のキーは`getSettings`と同じ。約133KB→約40KBで、CacheService(1件100KB上限)にも載る。
- 読む範囲: 管理者ログイン中=全店舗分(`getSettings`)、店舗ログイン中=その店舗、未ログイン=この端末で前回ログインした店舗(`last_login_store`)。ログイン時に範囲が違えば読み直してから画面を開く(`ensureSettingsScope`)。
- 端末のlocalStorageに今どの範囲が入っているかは`settings_scope`(`'all'`/`'store:<id>'`、無ければ従来の全店舗分扱い)。
- 安全策: 全店舗分が無い端末では①管理画面を開かない(`showPage`・`submitSiteLogin`)②上の2キーを`_gasSaveSetting`で丸ごと保存しない(他店舗分が消えるため。店舗ごとの変更は`_gasMergeSetting`)③読み込み失敗時に端末の前回分が別店舗の分ならチェックシートを出さない。
- 応答速度(GAS側の処理時間)は全店舗分と大差なく約2.4秒。減ったのは転送量で、通信の弱い端末ほど効く。
- 全店舗のパスワード・管理者PINが全端末に届き開発者ツールで見られる点は、ユーザー判断で対策不要(そういう相手を想定した作りではない)。

### 7.2 【対応済み・参考】設定の読み込み失敗時のチェック項目欠落(バグ報告No.4、commit `b9cbfcb`)

9/30深夜に大塚駅南口の端末で`getSettings`が失敗し、管理画面で追加したチェック項目が読めずコード内蔵の初期リスト(清掃5項目)で表示された。同時に「サーバーに無いキーを端末から補完する」処理が全キー分走り、端末の設定をサーバーへ書き戻していた(ユーザー確認で実害なし)。現在は、失敗時は2回取り直し、それでも駄目なら端末に残っている前回分で表示して警告バナーを出し、書き戻しはしない。前回分も無い端末ではチェックシートを出さない。失敗した根本原因(通信かGAS側か)は不明。

### 7.3 【いったん停止中】水の「売上超過」通知・チェックシートの「残り在庫」表示(commit `d22f44e`)

- 「売上超過」(ステラ実売上>補充数)の通知は削除済み。入力が補充数だけで、補充は在庫が減った時だけ行う運用のため、補充0の日に売れるだけで必ず誤報になっていた。
- **盗難疑い方向(補充>売上)の通知も2026-10-05に停止**(commit `87c8357`)。現地の状況と突き合わせて判定の正しさを実証できておらず、千種で「補充24個／ステラ実売上0個」の通知が出ていた。`WATER_STOCK_MISMATCH_NOTIFY_ENABLED = false`で送信だけ止め、計算・チェックポイント更新は継続(再開時にcarryOverが途切れないように)。再開はユーザーが判断する。
- 「残り在庫：N個」表示は全商品で非表示。ロジックは残してあり、`index.html`の`CHECKSHEET_SHOW_REMAINING_STOCK`を`true`に戻せば復活する。
- 棚卸表が本格始動したら「前回在庫+補充−売上≠現在在庫」の形で両方取り入れ直す予定(ユーザーが判断する。それまで勝手に再開しない)。

## 8. 設計上の注意点・決定事項(旧ローカルメモリから移行、2026-10-05)

前任者PCのClaude Codeローカルメモリ(引き継がれない)から、知らないと事故につながる仕様と、コードからは読み取れないオーナーの判断を移したもの。2026-10-05時点のコードで存在を確認済み。

### 共通(データ保存・同期・通知)
- **全置換保存と自己エコー**: `saveOrders`等は店舗分の行を全削除して書き直す。リアルタイム受信時に作業配列(`storeRows`/`ORDERS_CACHE`)をサーバーの最新状態で丸ごと置き換えると、その後のローカル編集で古い配列が保存され、サーバー側でも本当に消える(2026-07-08に発注データ消失)。受信側は既存行のフィールドだけ更新し、`_CLIENT_ID`で自分の通知を無視し、保存は`_syncChain`で直列化する。
- **設定保存の競合**: `_gasSaveSetting`はキーごとに`_settingSyncChain`で直列化している。素の`gasPost`を短い間隔で並べると、古い内容が後から届いて上書きする(2026-07-14、ストローのケース数が消えた)。
- **読み取りキャッシュ**(CacheService 25秒、`_xxxRowsCached_`): `_dateStr`/`_dateTimeStr`で文字列にしてから入れる。Date型のままJSON化するとUTCになり1日ずれる。1件100KBを超えると自動で毎回読みに戻る(エラーにはならない)。
- **列追加の罠**: 運用中のシートに列を足しても`ensureHeaders`は見出しを書かない。書き込みは位置指定なので値は入るが、読み取りは見出し名で探すので常に空や0になる(2026-07〜09、原価率が0のままだった)。「末尾に追記」型の移行関数は、データ側で`getLastColumn()`が既に伸びていると見出しが1列ずれる。
- **列ずれの診断**: 実データに触らず、架空の店舗ID(例`_probe_test_zz`)で全フィールドに識別できる値を送り、`getOrders`等でどの見出しの下に出るかを照合する。
- **ロックと通知**: `doPost`のスクリプトロック中はネットワーク通信をしない。通知は`result._notify`に積み、ロック解放後に送る。
- **日次バッチへの相乗り**: 未設定IDに依存する処理を既存の日次バッチ(`sendDailyOrderNotification`等)に相乗りさせるときは、必ずtry/catchで囲む。例外が出ると発注通知まで止まる。
- **curlで直接API編集した後**:
  - Firebaseへの通知が飛ばないので、開いているタブ・PWAは手動で再読み込みが必要。
  - POSTは302で`script.googleusercontent.com/...echo`に転送されるので、結果はGETで取り直す(`--post302`は失敗する)。
- **ルールの二重持ち**: 同じ業務ルールが描画側とハンドラ側の2か所にあることがある(例: 発注「その他」の重複選択)。ルールを緩めるときはgrepで全箇所を探す。
- **関数が残っていても使われているとは限らない**: `notifyNewOrder_`はテスト関数以外から呼ばれていない。発注通知は8:30の日次まとめ(`sendDailyOrderNotification`)だけ。
- **LINE WORKS**:
  - 通知を足すときは、まず既存の`sendLineWorksNotification`系で足りるか確認する。
  - チャンネル一覧を取るAPIは無い。Callback URLを一時的にGASへ向け、テスト投稿の`source.channelId`を読む。1:1トークには`channelId`が無く`userId`だけが入る。
  - `button_template`は`postback`非対応のため`type:'message'`を使う。
  - トークン要求のscopeはAppに付けたOAuth Scopeと一致させる(`bot`と`bot.message`は別物)。
  - Script Propertiesに貼ったPEM秘密鍵は改行潰れやゴミ混入が起きるので、base64として有効な文字だけを抜き出す方式(`createStockBotJWT_`)を使う。
  - Botの名前はDeveloper Consoleの複数箇所で設定する。

### 棚卸表
- **締め日**: 2026-08-29から「月末締め・暦月」(`getInventoryPeriod`)。旧「5日締め」は廃止。期間ラベルは送信した日の暦月で自動的に決まる。
  - 過去月をUIから送る手段は無い。過去月の登録・修正は`saveInventorySnapshot`を直接呼ぶ(`rows:[]`で送るとその店舗×期間を削除)。
  - 検証で送るときは、付くラベルが意図した月になるかを確認する。
- **`saveInventorySnapshot`はマージ方式**: 空欄で送った項目は既存値を残す(複数端末での分担入力のため)。裏返すと、再送信では値を空欄に戻せない。
- **送信前の警告3種と送信可否**:
  - 送信を止めるのは「消費量の異常(前月比+1以上またはマイナス)で理由が未入力」のときだけ。
  - 期限切れはconfirmで確認するだけで送信できる。デイリーカウント不一致は参考表示のみ。
  - 消費期限(`exp1〜3`)はスプレッドシートに残らない。
- **2つの対象外ルールは独立**: デイリーカウント対象(`isDailyCountTracked`)と消費期限対象(`needsExpiryTracking`)は別ルール(例: ペーパータオルはデイリーカウント対象だが期限管理外)。
  - `isDailyCountTracked`(棚卸)はother=ペーパータオルだけ、`_checksheetProductColumns`(チェックシート)はペーパータオル・ストロー・トイレットペーパーで、**ずれているのは意図どおり**(2026-10-05オーナー確認)。チェックシートは「随時数えてほしいもの」、棚卸表は「月末に数える、消耗品以外の在庫すべて」と、数える目的が違うため。片方に揃える修正はしないこと。
- **消費量の値の出どころ**: `inventory_log`の消費量は送信時点の固定値。店舗タブの消費量・差異・金額・発注数はスプレッドシートの数式(2026-09-07〜)。
  - 過去の納品数を直したら店舗タブを再構築する。前月比の異常検知等は`inventory_log`側を読むので、そちらも直す。
- **当月納品**: `inventory_delivery_auto`は追記だけの生ログで、集計のたびに合計し直す。
  - 期末在庫を数えた後の納品は消費量を過大に見せるが、対応しない(オーナー判断)。棚卸は何度でも再送でき、どれが最終カウントか区別できないため。
- **棚卸完了後の処理**: `buildStoreInventorySheet`/`buildStockCheckMonthly`/`processMonthlyReorder`は、結果を待たない別リクエストで投げている(ボタンの応答速度のため)。`saveInventorySnapshot`の中へ戻さない。
- **店舗タブ**:
  - 列順は`STORE_INVENTORY_COLS`だけが正。
  - 色分けはコードが毎回塗り直す。青=金額、オレンジ=手入力の実数、赤=計算結果、緑=ステラ関連。
  - タブの並び・色は`AREA_STORES`の既定値(`_defaultAreaForStore_`)で決める。店舗管理画面でエリアを変えても反映されない(速度優先)。
- **手動実行の注意**:
  - `buildSalesCategoryCostRatio`/`buildStockCheckMonthly`は、指定期間のブロックが店舗タブに無ければ何も書かない。
  - 原価率(ステラ実売上ベース)は、毎月1日8:00の`runMonthlyStockCheckBackstop`が前月分を書く。
- **「ステラ注文詳細」タブ**: 使い捨て(`importSteraOrdersCsv`が毎回全消去)。蓄積が要るデータは`stera_daily_sales`に持つ。
- **在庫僅少**: ケースサイズが登録された商品で「期末在庫 ≦ 1ケース」なら「要確認」を立てる。
  - 消費量がマイナスのときの発注数は0(不足側に倒れる)。警告表示は不要(オーナー判断)。
- **新規店舗の初回棚卸**: 消費量を自動計算できないので、`inventory_log`の消費量セルに手で入れてよい(オーナーが標準化済み。金額計算には影響しない)。
- **入れ替わりミス**: 期首と前月末の一致チェックでは、2商品の値の入れ替わりを検出できない。手作業の「棚卸表」スプレッドシート(参照専用・編集禁止)との突き合わせが唯一の手段。
- **直接修正時の権限**: 棚卸集計スプレッドシートを直接直すときは、実行アカウントに編集権限があるか先に確認する(閲覧のみで403になった前例あり)。
- **オーナーの方針**:
  - 棚卸集計スプレッドシートは「仮運用、別のものへ移行の可能性あり」。抜本的な再設計は本格運用が決まってから。
  - 棚卸表タブの「準備中」バッジは意図的に残している。
- **原価率の定義**: 原価率 = 全消費額 ÷ 月内売上(会費 + ステラのオプション販売 + ドロップイン)。
  - 実装済みは販売品類(ステラ)だけ。会費の店舗別集計は未着手(粒度を上司に確認してから)。
  - アペックス/トーヨーはステラを通らないので、商品単位の売上原価率は出せない。

### チェックシート
- **期間**: 暦月で、猶予期間は無い。`updateChecksheetField`は「今日」ではなく編集した`dayKey`から期間を決める。
- **デイリーカウント対象**: 全店共通の1ルール(`_checksheetProductColumns`)。
  - apex/toyo/cs3は全商品、otherはペーパータオル・ストロー・トイレットペーパー、salesは水だけ。
  - 水・ペーパータオルを外さない理由: 「デイリーカウントが入っている = 在店した」という在店確認の代わりに使っているため。
- **保存のマージ**: クライアントは月全体を毎回送り、サーバー(`_stampChecksheetEntryTimes_`)が日付・商品の両階層でマージする。日ごとに`_enteredAt`(入力時刻)が付く。
- **過去日の追加**: UIからはできないので直接APIで書く。キーは`'prod:'+商品名`。略称は、その店舗の既存データと`store_product_cfg`で確かめてから使う。
- **Firebaseのルール**: Firebase RTDBのセキュリティルールはコンソールにしか無い。新しいパスを足したらルールにも追加する(`curl <db>/<path>.json`で"Permission denied"が出るかで確認できる)。
- **CSSの罠**: グローバルの`input[type=number]{min-height:38px}`と、モバイルの`font-size:16px !important`には、インライン指定では勝てない。ID付きセレクタで上書きする。
- **表示店舗の設定**: 除外リスト方式(`store_checksheet_cfg`/`store_product_cfg`)。複数店舗の変更は1回の読み込み・1回の同期にまとめる。

### 発注・納品
- **ケース換算**:
  - 実際数量の単位の既定値は`effectiveActualUnitMode`に一本化している。独自の判定を書くと、ケース単位の商品がバラで確定する事故が再発する。
  - 「納品済み」ボタンは`_markDeliveredInProgress`で二重送信を防いでいる。
- **商品設定の優先順位**: 保存値(`all_products`)はコード内の`PRODUCTS`初期値より優先される。保存値を初期値に戻すと、管理者が直した値を巻き戻してしまう。
- **納品済み・バッジ**: 納品済みボタンは商品ごとに独立(同じ納品予定日でも到着がずれるため)。NEWバッジの既読は`localStorage`の`seen_attention_{店舗}`。
- **発注数量**: 随時発注の数量自動入力(消費量×1.5)は2026-09-29に廃止。月初発注(`processMonthlyReorder`)は別系統で、基準値をもとに計算し、対象店舗はGmail下書きを作る。今も稼働中。
- **手動納品シート**: `MANUAL_DELIVERY_SHEET_ID`はdeploy-gas.ymlで値が差し込まれないため、本番では常に空(未使用)。
- **忘れ物の運用**: 貴重品は警察に届けたうえでポータルに登録。それ以外も全てポータルに登録する。

### 在庫差異検知・ステラ
- **対象にする基準**: 「ドリンクマシン経由で会員がQRで無料消費できる商品か」で決める。カテゴリ名では判断しない。水は対象(会員かどうかに関わらず必ずステラ決済が発生する)。
- **名寄せ**:
  - 商品コード(STE0xx)が空欄の行があるので、主キーは商品ID(`prd_`)のほうが安全。味を区別しない商品はグループで合算する(`STERA_SALES_MAPPING`)。
  - 店舗名の表記ゆれは、正規化ロジックではなく`stores.js`側をステラの表記に合わせる方針。
  - 別事業の店舗名が`unmatchedStores`に出るのは正常。
- **数字の鮮度**:
  - 確定値は翌朝のCSV取り込み、当日分は10分おきの速報(非公式API、`stera_realtime_today`)。営業日はAM4:30締め。
  - 80000785 PCが止まると、当日分と確定分の両方が止まる。
  - ステラ管理画面の数字と合わないと言われたら、まずこの点を疑う。
- **水の判定**: 差が絶対3個以上かつ30%以上で、1回の検知で即通知する設計(監視カメラ映像の保存期間が約7日のため)。**2026-10-05から送信は停止中**(7.3参照)。
  - 誤検知を疑ったら、その店舗がステラ上で個別公開されていない「水だけ」店舗(除外リスト)ではないかを先に確認する。
- **理論在庫を水で表示しない理由**: 盗難が続くと「いつも在庫が少ない」と表示され続け、士気が下がる懸念があるため。
- **処分・店舗間移動**: 処分は月末にしか発生しない。店舗間の移動は月次確認欄に人が記入し、専用機能は作らない(オーナー確定)。
- **不採用が確定した案(再提案しない)**:
  - ステラの理論在庫・入庫機能の活用
  - チェックシート入力のたびにステラを確認しに行く仕組み
  - 日次・週次の閾値判定
  - パートナー向け表示から差異を隠すこと
  - 未入力時のリマインド
- **ステラ公式API**(elepay基盤): 決済単位の情報だけで、SKU・数量は取れない。
- **ステラ自動化の要点**:
  - reCAPTCHAを避けるため、独立したChromeを起動して`connect_over_cdp`で接続する。
  - CSVエクスポートは非同期で、日付範囲は月をまたいで指定できない。
- **渋谷神南・水のbaseline**: 2026-08-04 18:51の実地カウント151本を基準点とする(過去20本差の追及は打ち切り、オーナー判断)。

### 業務開始(出勤)・休み申請
- **基本仕様**:
  - コード上の名前は`attendance`のまま。
  - 判定は300m固定で、店舗座標は管理者が手入力する。
  - **外部サービスはGoogle内で完結させる、という会社の指示がある**(OSM等は却下)。Wi-Fiによる出勤判定も却下済み。
- **未打刻リマインド**: ログイン時に「登録スタッフ全員が当日打刻済みか」で判定する。端末ごとに1日1回だけ出し、共有端末には対応しない(オーナー確認済み)。
- **スケジュール**: weekday型は毎日8:30に判定、interval型は毎月1日9時の`sendMonthlyAttendanceCheck`。スタッフ0名の店舗は店舗デフォルト(`attendance_store_default_schedule`)を使う。
- **打刻の扱い**: 当日・同一人物の打刻は上書き(1日1行)。位置情報の拒否・タイムアウトなど端末側の失敗はサーバーに残らない。
- **決定済み方針(未実装)**: 押し忘れブロックを作る場合も、デイリーカウントとチェックシートは対象外。記録が食い違ったら、GPSが正常な限り位置情報を優先する。
- **休み申請**: 承認なしで即時確定。即時通知は「翌日分」だけで、送り先は`LW_CHANNEL_ID_LEAVE_*`(エリア別)。

### 請求書
- **テンプレート**:
  - 不具合時はまず、`INVOICE_TEMPLATE_ID`が実際に編集しているファイルか確認する(別ファイルを指していた前例あり)。
  - テンプレートを手で編集するとセル結合が変わる。見た目から推測で直さず、座標マップを取り直して`INVOICE_CELL_MAP`を直す。見た目の確認はPDFのテキスト層ではなく画像で行う。
- **金額**: `floor(満額 ÷ 基準業務日数 × 実業務日数)` + その他行の合計(マイナス可)。
- **まとめ請求**: 業者コードが同じ店舗は自動でまとめる。口座情報の連動は`index.html`の提出フォームだけで行う(`invoice.html`側で連動させると、空の口座で他店舗を上書きする)。
- **その他**: `invoice.html`に認証が無いのはオーナーの指定。

### 設定・店舗管理
- **店舗IDの改名**: `STORE_ID_ALIASES`(行データ用)だけでは足りない。settingsにある店舗IDキーのJSON blobを全て、旧キーから新キーへ移して旧キーを消す。
  - 対象: `store_passwords`, `store_product_cfg`, `store_checksheet_cfg`, `store_regions`, `invoice_store_cfg`, `invoice_partners`, `attendance_*`, `reorder_targets`。
  - ログインはパスワードの値が最初に一致したキーを使うので、旧キーが残ると誤った店舗になる(2026-08-04の御器所)。
- **管理画面の設定が反映されないとき**: そのキーが`initGas()`の読み込み一覧と`syncAllStoreDataToGas()`の両方にあるか確認する。
- **GAS側の店舗情報**: GASは公開中の`stores.js`を`UrlFetchApp`で取り、店舗名とFC判定(表示名が「FC 」始まり、または末尾`_fc`)に使う。エリア(`AREA_STORES`)はGAS側に複製を持っている。
- **設定の監査と復旧**:
  - 変更履歴は`?action=getSettingHistory&key=...`で見られる。
  - 「汚染だ」と思っても、戻す前に履歴を読む。オーナー本人の正規の操作を巻き戻しかけた前例がある。
  - `getSettings`の応答には全店舗のパスワードと管理者PINが平文で入っているので、ファイルに保存しない。

### 管理者ガイド・テスト(Playwright)
- **本番への書き込み防止(必須)**: ローカルの`index.html`も本番`GAS_URL`へ実際に通信する。保存系の関数に届く操作の前に、`script.google.com` / `script.googleusercontent.com` / `firebaseio.com` / `googleapis.com`をroute遮断する。
  - 「ちょっとした確認」のつもりの1回でも本番に書き込まれる(2026-07-21〜22に3回事故)。作業前に`getSettings`のスナップショットを取っておく。
- **ローカル検証**:
  - ローカルサーバーは19000番台などの高いポートで立てる。
  - subagentがPlaywrightを使っている間は、メイン側で使わない(同じブラウザを共有する)。
- **モバイル検証**:
  - `page.click()`はタッチイベントを出さないので、`TouchEvent`をdispatchして試す(このアプリはグローバルな`touchstart`でメニューを閉じている)。
  - DevToolsのデバイス表示では描画エンジンの差は再現しない。
- **CSSの罠**:
  - グローバルの`table{overflow:hidden}`があるとsticky列が効かないので、`overflow:visible`を明示する。
  - auto layoutのセル幅はJSで実測して`left`を合わせる。colspanのstickyは個別セルに分解する。
- **`admin-guide.html`**: 100KB超の行(base64画像)があるので、Read/Grepで直接読まない。差し替えは固定の接頭辞文字列だけを置換する。
- **ヘッダー配色**:
  - マニュアル`#b5544a`、ログアウト`#6b7280`、請求`#8a8f7e`。
  - 業務管理は管理者が金グラデーション、パートナーが`#22703d`。
  - パートナー側に請求ボタンを足すときは`#8a8f7e`(指示があるまで作らない)。

### 外部PC・Bot・clasp
- **80000785 PC**(前任者PC):
  - 会社用の常時起動PCで、ステラ取り込み・ポータル監視(`InternalPortalHealthWatchdog`)を動かしている。
  - 状態確認は`selfcafe/pc-remote-ops`のself-hosted runner経由(2026-09-27時点。WinRMは未開通)。
- **タスク登録スクリプト**: `scripts/register_*.ps1`と`run_*.cmd`は`C:\Users\80000785`とUserIdを決め打ちしている。別PCへ移すときは書き換えが必要。PythonはPATHでなくフルパスで指定する。
- **Bot構成**:
  - 「社内ポータル通知」: 発注・業務開始・休み申請。
  - 在庫差異検知Bot「佐藤テスト」: 1:1の`userId`宛。Script Propertiesは`LW_*_STOCK`。この1:1トークへの返信で任意期間を再調査できる。
  - バグ報告Bot: 6章。
  - 会費ペイ承認Bot・GBP承認Botは、別GASプロジェクト`kaihipay-gbp-approval-bot`にある(4章)。
- **手動clasp**:
  - `~/.clasprc.json`の`default`枠が個人アカウントに上書きされたことがあるので、必ず`--user selfcafe`を付ける。
  - 作業フォルダは`gas_backend.js`と`appsscript.json`の2ファイルだけにする。比較用コピーを残すと`const`の重複宣言で本番全体が壊れる。
  - `clasp run`は使えないので、トリガー登録などはApps Scriptエディタから手で実行する。

### 保留・却下が確定した案
- **棚卸ログの店舗別分割**(2026-08-01に着手合意→2026-10-05、当面はテスト運用中の棚卸集計スプレッドシートのまま扱い、実施するかは引き継ぎ先に委ねると決定。HANDOVER.md 4-9): `inventory_log`を店舗ごとのシートに分ける案。
  - トレードオフ: 全店舗集計が重くなる。対案として、全店舗集計を店舗ごとの金額・原価率サマリーに簡略化する案がある。
  - 着手前に詰めること: ①シートの命名規則 ②集計方針 ③既存データの移行手順。あわせて、棚卸集計スプレッドシートの「仮運用」前提が変わっていないか確認する。
- **フレーバー統合**(却下確定、2026-09-05): 味ごとの商品を1つにまとめる案。発注数の計算に味ごとの在庫・消費量が要るため、再検討しない。
