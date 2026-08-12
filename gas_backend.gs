// ============================================================
// セルフカフェ社内ポータル - Google Apps Script バックエンド
// ============================================================
// ⚠️ このファイル内の *_SHEET_ID 定数（SHEET_ID/INVENTORY_SHEET_ID/MANUAL_DELIVERY_SHEET_ID/
// DELIVERY_HISTORY_SHEET_ID）は全て空文字のまま維持すること。本リポジトリはGitHub公開リポジトリのため、
// 実IDは絶対にここへコミットしない。実IDはApps Scriptエディタ側（本番デプロイ環境）にのみ設定する。
// 【設定】デプロイ前に以下2行を入力してください
const SHEET_ID        = '';  // GoogleスプレッドシートのID
// 画像保存用DriveフォルダのID。フォルダ自体の共有設定を「リンクを知っている全員：閲覧者」に
// している（2026-08-12）ため、このフォルダ内に新しく作るファイルは何もしなくても
// リンクで閲覧可能になる。請求書PDF等、非公開にしたいファイルは絶対にこのフォルダへ
// 保存しないこと（別フォルダを使う。buildInvoiceReceiptPdf等が使うfolderは別物なので問題ない）
const IMAGE_FOLDER_ID = '1adg7TQIYXSkWIo19ohVo93raDY2HsTW_';
// 棚卸完了の送信先（別Driveの「棚卸集計」スプレッドシート、この実行アカウントに編集権限で共有しておくこと）
const INVENTORY_SHEET_ID = '';  // 棚卸集計スプレッドシートのID
// 月初納品分など、アプリを通さず本部が直接手配・受領した納品を本部が手入力するスプレッドシート
// （棚卸集計とは別。この実行アカウントに編集権限で共有しておくこと。列は「期間ラベル/店舗ID/商品コード/数量」）
const MANUAL_DELIVERY_SHEET_ID = '';  // 手動納品入力スプレッドシートのID
// 発注を「納品済み」にした際の履歴ログ専用スプレッドシート（2026-07-18追加）。メインのSHEET_ID側は
// 過去に複数回の事故（部署マスター誤上書き、注文データの巻き戻り削除、設定の競合消失）を起こしている
// ため、消えては困る履歴ログはあえて別ファイルに分離する（この実行アカウントに編集権限で共有しておくこと）
const DELIVERY_HISTORY_SHEET_ID = '';  // 発注履歴スプレッドシートのID
// 請求書テンプレート（Googleスプレッドシート版）。このファイルをmakeCopy()で複製し、
// セルに値を差し込んでからPDFエクスポートする。この実行アカウントに編集権限で共有しておくこと。
const INVOICE_TEMPLATE_ID = '1GoprcmRPLAo5A7nAd1lWCSabDa1W8MkCuYy42P852ts'; // 2026-07-11: ユーザーが直接編集していた方の実ファイルに差し替え（旧IDは編集が反映されない別ファイルだった）
// 生成した請求書PDFの保存先Driveフォルダ（名称・場所は今後変わる可能性あり。移動した場合はこのIDだけ差し替える）
const INVOICE_PDF_FOLDER_ID = '1ite8mdJR0HcSqeRdmsMNK1rnD4TydIRf';

const SHEET_ORDERS     = 'orders';
const SHEET_SETTINGS   = 'app_settings';
const SHEET_LOST       = 'lost_items';
const SHEET_CHECKSHEET = 'checksheet_data';
const SHEET_INVENTORY  = 'inventory_log';
const SHEET_INVOICE_LOG = 'invoice_log';
const SHEET_ATTENDANCE = 'attendance';
// app_settingsの上書き前の値を追記専用で残しておく履歴ログ。2026-07-14に消耗品カテゴリの
// 商品データが保存の競合で丸ごと消え、Google Driveの古いコピーから手作業で復旧する羽目に
// なったため追加。以後は同じ事故が起きても最新の履歴行から直前の値をすぐ確認・復元できる
const SHEET_SETTINGS_HISTORY = 'settings_history';
const SETTINGS_HISTORY_COLS = ['timestamp', 'key', 'old_value'];
const INVOICE_LOG_COLS = ['id', 'store_id', 'store_name', 'partner_id', 'period', 'amount', 'pdf_url', 'submitted_at', 'receipt_pdf_url'];

const ORDER_COLS = [
  'id','store_id','group_id','product','label','qty','actual_qty','unit',
  'case_unit','unit_mode','note','locked','is_new','request_date','order_date',
  'delivery_date','created_at','denied','image_url','actual_unit_mode'
];
const LOST_COLS = ['id','store_id','found_date','note','image_url','added_at'];
// マシン庫内点検写真（5カテゴリ：フィルター正面/カップ庫内/原料タンク/庫内全体/フィルター残り）。
// 店舗によってマシン台数が異なり(1台〜複数台)、カテゴリごとに台数分の写真が必要なため、
// 固定列ではなくphotos_json列に{カテゴリキー:[url,...]}のJSONで可変枚数を保持する
const SHEET_MACHINE_PHOTOS = 'machine_photos';
const MACHINE_PHOTO_COLS = ['id','store_id','machine_index','uploaded_at','photos_json'];
// 発注を「納品済み」にした際のログ。1回の操作で1行追加（append-onlyのログシート、
// ordersのような全件削除→再送信はしない。自動削除もしない——消えては困る記録のため）
const SHEET_DELIVERY_HISTORY = 'delivery_history';
const DELIVERY_HISTORY_COLS = [
  'id','store_id','group_id','product','label','qty','actual_qty','unit',
  'case_unit','unit_mode','actual_unit_mode','note','request_date','order_date',
  'delivery_date','delivered_at'
];
// 店舗×年月で1行、その月の日別データはJSON文字列として1セルに保存する
// （日ごと・項目ごとに行を分けると増え続けて管理しづらいため、月単位でまとめる）
const CHECKSHEET_COLS = ['store_id','period_label','data','updated_at'];
// 店舗×年月×商品で1行。同じ店舗×年月で再送信した場合はその行を上書きする
// anomaly_noteは2026-07-15追加。daily_count/matchedは2026-07-10に一旦廃止したものを
// 2026-07-21に「盗難・カウントミスの早期発見用に本部側の記録としても残したい」との要望で復活。
// いずれも既存の運用中シートには自動で列が増えないため、migrateInventoryColumns()で末尾に追加する
// （列の並び順を変えると位置ズレで既存データが壊れるため、新規列は必ずINVENTORY_COLSの末尾に足すこと）
// label列は2026-07-28に削除（product列との重複——PRODUCTS配列は全商品でlabel:nameと同値を入れて
// いるだけで実質常に同じ値だったため、product側だけ残した。既存シートのE列(label)は
// removeInventoryLabelColumn()のワンショット移行で物理削除済み・削除する必要がある）
const INVENTORY_COLS = ['period_label','store_id','code','product','open_stock','delivery','end_stock','consumption','disposed_qty','price','amount','remarks','updated_at','anomaly_note','daily_count','matched','store_type'];
// シート上の見出し表示専用（INVENTORY_ROLLUP_HEADERS_JAと同じパターン）。INVENTORY_COLSと同じ順序・
// 同じ長さを保つこと——列の読み書きはヘッダーのテキストではなく、この配列の「位置」を正として行う
// （新規列は必ずINVENTORY_COLSの末尾に足す運用のため、物理的な列位置と宣言順は常に一致する前提）。
// 2026-07-28、見出しを日本語表示に変更（inventory_log本体もこの前提で書き換えたため対象に含めた）
const INVENTORY_HEADERS_JA = ['期間','店舗ID','商品コード','商品名','期首在庫','当月納品','期末在庫','消費量','処分数量','単価','期末在庫額','備考','更新日時','異常メモ','デイリーカウント','一致','店舗区分'];
// 出勤打刻ログ。1回の打刻で1行追加（append-onlyのログシート、ordersのような全件削除→再送信はしない）
const ATTENDANCE_COLS = ['id','store_id','name','clocked_at','lat','lng','within_range'];
// 基準座標からこの距離(m)以内なら出勤OKと判定する（全店舗共通の固定値、2026-07-15確定）
const ATTENDANCE_THRESHOLD_M = 300;
// 休み申請ログ。1回の申請で1行追加（append-only、承認ステップなしで即時確定）
const SHEET_ATTENDANCE_LEAVE = 'attendance_leave';
const ATTENDANCE_LEAVE_COLS = ['id','store_id','name','leave_date','submitted_at'];

// エリア別店舗ID（デフォルト割り当て。フロントのREGIONS定数と同じ内容。管理者が「店舗管理」画面の
// 「店舗のエリア変更」で個別に上書きした場合は、app_settingsの'store_regions'キー(_areaForStore_内で
// 参照)の方が優先される——このデフォルト自体は基本的に変わらないため、_areaForStore_を通さない
// 単純な用途(通知グループ振り分け以外)ではこのまま直接参照してよい）
const AREA_STORES = {
  '東海': ['sasashima','chikusa','gokiso','tsuruma','kamisawa','nakamura_nisseki','midori_kofubutsu','sakurayama','akatsuka','shin_moriyama','tokoname','hamamatsu','sakae','rokubanchou','nonami','seto_iwayadou','nagakute','meieki_nishi','nadia_sakae','shinmizuhashi','eisei','hotei','kamejima','nakamura_torii','taikodori','kouta','hibino','hoshigaoka','ikeshita','toyota','hara','fujigaoka','gifu_kitagata','narumi'],
  '関西': ['tenma','higashiosaka','aikawa','minami_morimachi','abeno','tanimachi9','moriguchi','taishibashi','kyobashi_kita','shinsaibashi','kishi','umeda','kami_shinjyo','osaka_hirano','hikone','aeon_higashiosaka','gamo4'],
  '関東': ['inzai','otsuka','sugamo','umejima','shibuya','shinjuku_fc','kamisato']
};
// フロントのREGIONS定数のid('tokai'/'kansai'/'kanto')→日本語ラベルの対応（store_regions設定の値はid形式のため）
const REGION_ID_LABEL_ = { tokai: '東海', kansai: '関西', kanto: '関東' };

// 店舗ID改名の後方互換エイリアス(旧ID→新ID)。2026-08-04、御器所の店舗IDを
// 誤読み"gokaiso"から正しい"gokiso"へ改名した際に追加。各シートに既に書き込み済みの
// 過去データ(store_id列)は書き換えていないため、旧IDのまま残っている行を新IDと
// 同一店舗として扱えるよう、sheetRows()で読み込む際にstore_id列をここで正規化する。
const STORE_ID_ALIASES = { gokaiso: 'gokiso' };
function _normalizeStoreId_(id) {
  const key = String(id);
  return Object.prototype.hasOwnProperty.call(STORE_ID_ALIASES, key) ? STORE_ID_ALIASES[key] : id;
}

// 棚卸集計スプレッドシート内の店舗タブ(例:「渋谷神南」)を、エリアごとに色分け・グループ化して
// 並べるための設定(2026-08-01、ユーザーから「エリアごとに分けたい、新しい店舗ほど後ろに来て
// ほしい」と依頼を受け追加)。AREA_STORESの並び順(東海→関西→関東、各エリア内は追加された順)を
// そのままタブの正準な並び順として使う——stores.js自体が新規店舗をエリアごとの末尾に追記していく
// 運用のため、この並び順が自然と「新しい店舗ほど後ろ」になる。
const AREA_TAB_COLORS = { '東海': '#93c47d', '関西': '#6fa8dc', '関東': '#f6b26b' }; // 緑/青/オレンジ
function _storeTabCanonicalOrder_() {
  return [].concat(AREA_STORES['東海'], AREA_STORES['関西'], AREA_STORES['関東']);
}
// タブの色分け専用の軽量エリア判定。_areaForStore_()とは意図的に別実装——_areaForStore_()は
// 店舗管理画面でのエリア上書き(_storeRegionOverrides_→getSettings())を反映するため、無関係な
// メインスプレッドシート(SHEET_ID、棚卸集計とは別ファイル)を毎回丸ごと開いてapp_settingsを
// 読みに行ってしまう。2026-08-01、これが原因で棚卸完了の応答が数秒遅くなっていたことが判明
// (buildStoreInventorySheet全体で4〜6秒、うちこの部分だけで約1〜2秒)。タブの色は見た目の
// 整理用途でしかなく、店舗管理画面でのエリア変更に厳密に追従する必要は薄いと判断し、
// AREA_STORESの静的な既定値だけを見る軽量版に切り替えた(コスト高いgetSettings()呼び出しを回避)。
function _defaultAreaForStore_(storeId) {
  for (var areaName in AREA_STORES) {
    if (AREA_STORES[areaName].indexOf(String(storeId)) >= 0) return areaName;
  }
  return null;
}
// 棚卸集計スプレッドシート内の「店舗タブ」だけを対象に、エリア別の色を付け、正準な並び順に揃える。
// 全店舗棚卸集計・棚卸未提出店舗・inventory_log等の非店舗タブは対象外(現在の並びのまま触らない)。
// 既に正しい位置にあるタブはmoveActiveSheetを呼ばない(不要なAPI呼び出しを避ける、
// [[feedback_proactive_perf_flagging]]参照)。buildStoreInventorySheetから毎回呼ばれる想定に加え、
// 既存の店舗タブへ一括で反映するための?action=reorderStoreTabsとしても呼べる
function _applyStoreTabOrderAndColors_(ss) {
  const canonicalOrder = _storeTabCanonicalOrder_();
  const names = _storeNames_();
  const nameToId = {};
  Object.keys(names).forEach(id => { nameToId[names[id]] = id; });

  const sheets = ss.getSheets(); // 1回だけ取得(以前は2回呼んでいた無駄を削減)
  const utilityCount = sheets.filter(sh => !nameToId[sh.getName()]).length;
  const storeEntries = sheets
    .filter(sh => nameToId[sh.getName()])
    .map(sh => ({ sheet: sh, id: nameToId[sh.getName()] }));

  storeEntries.sort((a, b) => {
    const ia = canonicalOrder.indexOf(a.id); const ib = canonicalOrder.indexOf(b.id);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });

  storeEntries.forEach((entry, i) => {
    const area = _defaultAreaForStore_(entry.id);
    if (area && AREA_TAB_COLORS[area]) entry.sheet.setTabColor(AREA_TAB_COLORS[area]);
    const targetPos = utilityCount + i + 1; // 1-based
    if (entry.sheet.getIndex() !== targetPos) {
      ss.setActiveSheet(entry.sheet);
      ss.moveActiveSheet(targetPos);
    }
  });
}
// 既存の店舗タブすべてに一括反映するためのワンショット関数。?action=reorderStoreTabsで実行。
// 新規店舗が今後buildStoreInventorySheetで作られる際は自動的にこの処理が走るため、これは
// 「今すでにあるタブ」に遡って反映するための一度きりの手動実行用
function reorderStoreTabs() {
  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  _applyStoreTabOrderAndColors_(ss);
  return { ok: true };
}

// 店舗名マスタ。手動複製で二重管理にせず、GitHub Pagesで公開されているstores.js(フロントの
// 共有ファイル)を都度UrlFetchAppで取得・パースして使う——stores.js側を直せば自動的に反映される。
// 1回の実行(doGet/doPost/トリガー呼び出し)内ではメモリ変数でキャッシュし、何度呼ばれても
// 取得は1回だけにする。さらに実行をまたいだ分はCacheServiceで60秒だけ共有する
// （2026-08-12、getMachinePhotoStatus等が同時アクセスの多いタイミングで毎回GitHub Pagesへ
// 外部fetchし直しており、遅延・失敗の一因になっていたため追加。新規店舗追加の反映が
// 最大60秒遅れる可能性はあるが、頻度が低いため許容——60秒より長いとズレが気になるとの判断）。
// 取得・パースに失敗した場合（GitHub Pagesの一時的な障害等）は店舗名なし(IDのみ)にフォールバック
// し、通知自体は従来通り送る（名前解決の失敗で通知が止まらないようにする）
const STORES_JS_URL = 'https://selfcafe.github.io/internal-web-system/stores.js';
const STORE_NAMES_CACHE_KEY = 'store_names_v1';
let _cachedStoreNames = null;
function _storeNames_() {
  if (_cachedStoreNames) return _cachedStoreNames;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(STORE_NAMES_CACHE_KEY);
  if (cached) { try { _cachedStoreNames = JSON.parse(cached); return _cachedStoreNames; } catch (e) {} }
  try {
    const text = UrlFetchApp.fetch(STORES_JS_URL, { muteHttpExceptions: true }).getContentText();
    // stores.jsは "const STORES = {...};" という単純なJS定義のみのファイル（信頼できる自リポジトリ）
    // なので、Functionコンストラクタでその場限りの関数スコープとして実行しSTORESだけを取り出す
    _cachedStoreNames = new Function(text + '; return STORES;')();
    try { cache.put(STORE_NAMES_CACHE_KEY, JSON.stringify(_cachedStoreNames), 60); } catch (e) {}
  } catch (e) {
    console.error('stores.js取得に失敗、店舗名なしで通知します:', e.message);
    _cachedStoreNames = {};
  }
  return _cachedStoreNames;
}
// LINE WORKS通知メッセージ用：店舗IDに、分かっていれば店舗名を添えた表示用文字列を返す
// （未知のID・custom_stores等でstores.jsに無い店舗、または取得失敗時はIDのみ返す）
function _storeIdLabel_(storeId) {
  const nm = _storeNames_()[storeId];
  return nm ? storeId + '（' + nm + '）' : String(storeId);
}
// FC(フランチャイズ)店舗かどうかの判定（2026-07-25、棚卸集計スプレッドシートのstore_type列用）。
// stores.js上の表示名が「FC 」で始まるという既存の命名規則を正とする。stores.js取得に失敗した場合や
// custom_storesで追加され表示名が引けない店舗は、store_id自体の末尾"_fc"規則にフォールバックする
// （現行の唯一のFC店舗shinjuku_fcはid・表示名どちらの規則にも合致する）。該当なしは直営扱い。
function _isFcStore_(storeId) {
  const nm = _storeNames_()[storeId];
  if (nm) return nm.indexOf('FC ') === 0;
  return /_fc$/.test(String(storeId));
}

// ----------------------------------------------------------------
// エントリーポイント
// ----------------------------------------------------------------

function doGet(e) {
  try {
    const a = e.parameter.action;
    let result;
    if      (a === '_peekMainSheetTabByGid') result = _peekMainSheetTabByGid_(Number(e.parameter.gid), Number(e.parameter.rows) || 5);
    else if (a === '_provisionDeliveryHistorySheet') result = _provisionDeliveryHistorySheet_();
    else if (a === 'getOrders')         result = getOrders();
    else if (a === 'getSettings')       result = getSettings();
    else if (a === 'getLostItems')      result = getLostItems(e.parameter.month, e.parameter.storeId);
    else if (a === 'getChecksheetData') result = getChecksheetData(e.parameter.storeId);
    else if (a === 'getChecksheetStockChecks') result = getChecksheetStockChecks(e.parameter.storeId);
    else if (a === 'getInventoryHistory') result = getInventoryHistory(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'getLatestConsumptionByCode') result = getLatestConsumptionByCode(e.parameter.storeId);
    else if (a === 'getInventoryDeliveryAuto') result = getInventoryDeliveryAuto(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'getInventoryDeliveryManual') result = getInventoryDeliveryManual(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'getInventoryTabData')       result = getInventoryTabData(e.parameter.storeId, e.parameter.periodLabel, e.parameter.prevPeriodLabel);
    else if (a === 'getInvoiceLog')             result = getInvoiceLog();
    else if (a === 'migrateOrderColumns')       result = migrateOrderColumns();
    else if (a === 'migrateInventoryColumns')   result = migrateInventoryColumns();
    else if (a === 'setupInventoryDisposedHighlight') result = setupInventoryDisposedHighlight();
    else if (a === 'buildInventoryRollup')      result = buildInventoryRollup(e.parameter.periodLabel);
    else if (a === 'buildStoreInventorySheet')  result = buildStoreInventorySheet(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'reorderStoreTabs')          result = reorderStoreTabs();
    else if (a === 'removeInventoryLabelColumn') result = removeInventoryLabelColumn();
    else if (a === 'pruneBlankStoreInventoryRows') result = pruneBlankStoreInventoryRows(e.parameter.storeId);
    else if (a === 'buildSalesCategoryCostRatio') result = buildSalesCategoryCostRatio(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'buildStockCheckMonthly')    result = buildStockCheckMonthly(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'purgeOldLeaveRequests')      { purgeOldLeaveRequests(); result = { ok: true }; }
    else if (a === 'mergeInventoryLogRemarksBlocks') result = mergeInventoryLogRemarksBlocks();
    else if (a === 'getSettingHistory')         result = getSettingHistory(e.parameter.key, e.parameter.limit);
    else if (a === 'getAttendance')             result = getAttendance(e.parameter.storeId);
    else if (a === 'getLeaveRequests')          result = getLeaveRequests(e.parameter.storeId);
    else if (a === 'getAttendanceTabData')      result = getAttendanceTabData(e.parameter.storeId);
    else if (a === 'getDeliveryHistory')        result = getDeliveryHistory(e.parameter.storeId, e.parameter.month);
    else if (a === 'getMachinePhotoStatus')     result = getMachinePhotoStatus();
    else if (a === 'getMachinePhotoHistory')    result = getMachinePhotoHistory(e.parameter.storeId);
    else if (a === 'migrateMachinePhotoColumns') result = migrateMachinePhotoColumns();
    else result = { error: 'Unknown action: ' + a };
    return json(result);
  } catch(err) {
    return json({ error: err.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  // ロック待ち時間を計測してログに残す（2026-08-12、doPostが同時に何件も来た時に
  // 「ロック待ちで詰まっている」のか「処理自体が遅い」のかを次回切り分けられるようにするため）
  const _lockWaitStart = Date.now();
  lock.waitLock(30000);
  const _lockWaitMs = Date.now() - _lockWaitStart;
  let result;
  try {
    const b = JSON.parse(e.postData.contents);
    console.log('doPost action=' + (b.action || '(lineworks/kaihipay callback)') + ' storeId=' + (b.storeId || '') + ' lockWaitMs=' + _lockWaitMs);
    const isKaihipayBotCallback_ = !!(e.parameter && e.parameter.bot === 'kaihipay');
    if      (isKaihipayBotCallback_ && isLineWorksCallback_(b)) result = handleKaihipayApprovalTextReply_(b);
    else if (isLineWorksCallback_(b))           result = handleLineWorksStockInquiry_(b);
    else if (b.action === 'kaihipayRequestApproval') result = kaihipayRequestApproval(b.requestId, b.message);
    else if (b.action === 'kaihipayCheckApproval')   result = kaihipayCheckApproval(b.requestId);
    else if (b.action === 'saveOrders')         result = saveOrders(b.storeId, b.rows);
    else if (b.action === 'upsertOrders')       result = upsertOrderRows(b.storeId, b.rows);
    else if (b.action === 'deleteOrders')       result = deleteOrderRows(b.ids);
    else if (b.action === 'saveSetting')        result = saveSetting(b.key, b.value);
    else if (b.action === 'saveLostItem')       result = saveLostItem(b.item, b.imagesBase64, b.imageMime);
    else if (b.action === 'deleteLostItem')     result = deleteLostItem(b.id, b.imageUrl);
    else if (b.action === 'saveOrderImage')     result = saveOrderImage(b.imageBase64, b.imageMime, b.filename);
    else if (b.action === 'saveChecksheetData') result = saveChecksheetData(b.storeId, b.periodLabel, b.data);
    else if (b.action === 'saveInventorySnapshot') result = saveInventorySnapshot(b.storeId, b.periodLabel, b.rows, b.remarks);
    else if (b.action === 'recordInventoryDelivery') result = recordInventoryDelivery(b.storeId, b.periodLabel, b.product, b.qty);
    else if (b.action === 'importSteraOrdersCsv') result = importSteraOrdersCsv(b.csvText);
    else if (b.action === 'importSteraDailySales') result = importSteraDailySales(b.dateStr, b.csvText);
    else if (b.action === 'checkChecksheetStockMismatch') result = checkChecksheetStockMismatch(b.storeId, b.product);
    else if (b.action === 'submitInvoice')       result = submitInvoice(b.payload);
    else if (b.action === 'saveInvoiceReceiptImage') result = saveInvoiceReceiptImage(b.imageBase64, b.imageMime, b.filename);
    else if (b.action === 'saveAttendance')      result = saveAttendance(b.storeId, b.name, b.lat, b.lng);
    else if (b.action === 'saveLeaveRequest')    result = saveLeaveRequest(b.storeId, b.name, b.leaveDate);
    else if (b.action === 'deleteLeaveRequest')  result = deleteLeaveRequest(b.id);
    else if (b.action === 'saveDeliveryHistory') result = saveDeliveryHistory(b.storeId, b.row);
    else if (b.action === 'clearDeliveryHistory') result = clearDeliveryHistory(b.storeId);
    else if (b.action === 'saveMachinePhotoSet') result = saveMachinePhotoSet(b.storeId, b.machineIndex, b.imagesByCategory, b.imageMime);
    else result = { error: 'Unknown action: ' + b.action };
  } catch(err) {
    result = { error: err.message };
  } finally {
    lock.releaseLock();
  }
  // LINE WORKS通知はシートの読み書きと競合しないため、ロック解放後に送る（2026-07-24、
  // 打刻・休み申請の保存処理がロックを保持する時間を通知の通信時間分だけ短縮する狙い。
  // 各保存関数がresult._notifyに要否を積んでおき、ここで種類ごとに振り分けて送信する）
  if (result && result._notify) {
    const n = result._notify;
    delete result._notify;
    try {
      if      (n.type === 'attendanceGpsIssue')    notifyAttendanceGpsIssue_(n.storeId, n.name);
      else if (n.type === 'leaveRequestTomorrow')  notifyLeaveRequestTomorrow_(n.storeId, n.name, n.leaveDate);
      else if (n.type === 'leaveRequestCancelled') notifyLeaveRequestCancelled_(n.storeId, n.name, n.leaveDate);
      else if (n.type === 'stockInquiryReply')     sendStockBotNotification_(n.message, n.userId);
      else if (n.type === 'kaihipayApprovalAck')   sendKaihipayApprovalNotification_(n.message, n.userId);
    } catch (e) {
      console.error('LINE WORKS通知エラー(ロック解放後):', e.message);
    }
  }
  return json(result);
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------------
// シートヘルパー
// ----------------------------------------------------------------

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// DELIVERY_HISTORY_SHEET_IDが一度も設定されず、「納品済み」操作がdelivery_historyへの保存に
// 常に失敗してlocalStorageへのフォールバックになっていた問題(2026-07-28発覚)への対応。
// 実行アカウント自身の所有としてスプレッドシートを新規作成する(この方法なら追加の共有設定が不要)。
// 一度だけ実行し、返ってきたspreadsheetIdをデプロイ用のDELIVERY_HISTORY_SHEET_IDに設定すること。
// 既に同名のファイルが無いか一応確認してから作る(何度も誤って複数作成しないための軽い安全策)。
function _provisionDeliveryHistorySheet_() {
  const existing = DriveApp.getFilesByName('delivery_history（納品済み履歴・自動作成）');
  if (existing.hasNext()) {
    const f = existing.next();
    return { ok: true, alreadyExisted: true, spreadsheetId: f.getId(), url: f.getUrl() };
  }
  const ss = SpreadsheetApp.create('delivery_history（納品済み履歴・自動作成）');
  const sheet = ss.getSheets()[0];
  sheet.setName(SHEET_DELIVERY_HISTORY);
  sheet.appendRow(DELIVERY_HISTORY_COLS);
  return { ok: true, alreadyExisted: false, spreadsheetId: ss.getId(), url: ss.getUrl() };
}

// 調査用の一時的な読み取り専用ヘルパー(2026-07-28、「納品済み履歴」の実データがどのタブ・列構成
// かを確認するため)。書き込みは一切行わない。用が済んだら削除してよい。
function _peekMainSheetTabByGid_(gid, numRows) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === gid);
  if (!sheet) return { error: `gid ${gid} のタブが見つかりません` };
  const lastRow = Math.min(sheet.getLastRow(), numRows + 1);
  const lastCol = sheet.getLastColumn();
  const values = lastRow > 0 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  return { name: sheet.getName(), totalRows: sheet.getLastRow(), totalCols: lastCol, sample: values };
}

function ensureHeaders(sheet, cols) {
  if (sheet.getLastRow() === 0) sheet.appendRow(cols);
}

// ensureHeadersは空シートにしか列を作らないため、既存の運用中シートへ後から
// 列を足す場合はこちらを一度だけ叩く。ORDER_COLSのうち既存ヘッダーに無いものだけを
// 末尾に追加する（既存列の並び・データには一切触れない、何度実行しても安全）。
// actual_unit_mode列追加(2026-07-14)のためのワンショット移行用
function migrateOrderColumns() {
  const sheet = getSheet(SHEET_ORDERS);
  if (sheet.getLastRow() === 0) { ensureHeaders(sheet, ORDER_COLS); return { ok: true, added: ORDER_COLS }; }
  const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const missing = ORDER_COLS.filter(c => hdrs.indexOf(c) < 0);
  if (missing.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
  }
  return { ok: true, added: missing };
}

// "YYYY-MM-DD"のような文字列を書き込むと、スプレッドシートが自動的に
// 日付型セルへ変換してしまい、読み出し時にDate型がUTCへ変換されて
// 1日ずれることがある（JSTでは日付が1日前になる）。読み出し時にDate型を
// 検出し、正しいタイムゾーンの文字列へ戻す。
// ※Session.getScriptTimeZone()はスクリプトプロジェクトの設定であり、
//   スプレッドシート自体のタイムゾーンと一致するとは限らないため、
//   日付型への変換が実際に発生したスプレッドシート側のタイムゾーンを使う。
// リクエスト内で使い回すため、スプレッドシートのタイムゾーンは初回のみ取得してキャッシュする
// （_dateStrは行ごとに呼ばれるため、毎回openByIdし直すと行数分だけ無駄な呼び出しが発生し遅くなる）
let _cachedTz = null;
function _sheetTz() {
  if (!_cachedTz) _cachedTz = SpreadsheetApp.openById(SHEET_ID).getSpreadsheetTimeZone();
  return _cachedTz;
}

function _dateStr(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, _sheetTz(), 'yyyy-MM-dd');
  }
  return v || null;
}

function sheetRows(sheet, cols) {
  if (sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  return data.slice(1).map(row => {
    const obj = {};
    cols.forEach(c => { const i = hdrs.indexOf(c); obj[c] = i >= 0 ? row[i] : null; });
    // 店舗ID改名の後方互換: 過去データに残る旧IDを新IDへ正規化(STORE_ID_ALIASES参照)
    if (obj.store_id !== undefined && obj.store_id !== null && obj.store_id !== '') {
      obj.store_id = _normalizeStoreId_(obj.store_id);
    }
    return obj;
  });
}

// ----------------------------------------------------------------
// orders
// ----------------------------------------------------------------

function getOrders() {
  return sheetRows(getSheet(SHEET_ORDERS), ORDER_COLS).map(r => ({
    id:            r.id,
    store_id:      r.store_id,
    group_id:      r.group_id      || null,
    product:       r.product       || null,
    label:         r.label         || null,
    qty:           (r.qty !== '' && r.qty !== null) ? Number(r.qty) : null,
    actual_qty:    (r.actual_qty !== '' && r.actual_qty !== null) ? Number(r.actual_qty) : null,
    unit:          r.unit          || null,
    case_unit:     r.case_unit     || null,
    unit_mode:     r.unit_mode     || null,
    note:          r.note          || null,
    locked:        r.locked === true || r.locked === 'TRUE',
    is_new:        r.is_new  === true || r.is_new  === 'TRUE',
    request_date:  _dateStr(r.request_date),
    order_date:    _dateStr(r.order_date),
    delivery_date: _dateStr(r.delivery_date),
    created_at:    r.created_at    || null,
    denied:        r.denied === true || r.denied === 'TRUE',
    image_url:     r.image_url     || null,
    actual_unit_mode: r.actual_unit_mode || null,
  }));
}

function saveOrders(storeId, rows) {
  const sheet = getSheet(SHEET_ORDERS);
  ensureHeaders(sheet, ORDER_COLS);

  if (sheet.getLastRow() > 1) {
    const data   = sheet.getDataRange().getValues();
    const sidIdx = data[0].indexOf('store_id');
    const toDel  = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][sidIdx]) === String(storeId)) toDel.push(i + 1);
    }
    for (let i = toDel.length - 1; i >= 0; i--) sheet.deleteRow(toDel[i]);
  }

  if (rows.length > 0) {
    const newRows = rows.map(r =>
      ORDER_COLS.map(c => (r[c] === undefined || r[c] === null) ? '' : r[c])
    );
    const startRow = sheet.getLastRow() + 1;
    // request_date/order_date/delivery_dateが自動的に日付型セルへ
    // 変換され、後で読み出す際に1日ずれるのを防ぐため、書き込み前に
    // 該当列をプレーンテキスト形式に固定しておく
    ['request_date', 'order_date', 'delivery_date'].forEach(c => {
      const colIdx = ORDER_COLS.indexOf(c) + 1;
      sheet.getRange(startRow, colIdx, newRows.length, 1).setNumberFormat('@');
    });
    sheet.getRange(startRow, 1, newRows.length, ORDER_COLS.length).setValues(newRows);
  }

  return { ok: true };
}

// saveOrdersの「その店舗の行を全削除してから書き込む」という2段階方式は、削除と
// 書き込みの間に一瞬「空」の状態ができてしまい、その瞬間に別のリクエスト（getOrders）が
// 割り込むと、本当は行があるのに0件に見えてしまう（実際にこの隙間が原因でデータが
// 消える事故が発生した）。idで一致する行だけを個別に更新・追加し、他の行には一切
// 触れないため、この種の空白状態が構造的に発生しない。
function upsertOrderRows(storeId, rows) {
  const sheet = getSheet(SHEET_ORDERS);
  ensureHeaders(sheet, ORDER_COLS);
  if (!rows || !rows.length) return { ok: true };

  const idIdx = ORDER_COLS.indexOf('id');
  const idToRowNum = {};
  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach((r, i) => { if (r[0] !== '') idToRowNum[String(r[0])] = i + 2; });
  }

  const dateCols = ['request_date', 'order_date', 'delivery_date'];
  const toAppend = [];
  rows.forEach(r => {
    const values = ORDER_COLS.map(c => (r[c] === undefined || r[c] === null) ? '' : r[c]);
    const rowNum = idToRowNum[String(r.id)];
    if (rowNum) {
      sheet.getRange(rowNum, 1, 1, ORDER_COLS.length).setValues([values]);
      dateCols.forEach(c => sheet.getRange(rowNum, ORDER_COLS.indexOf(c) + 1).setNumberFormat('@'));
    } else {
      toAppend.push(values);
    }
  });

  if (toAppend.length) {
    const startRow = sheet.getLastRow() + 1;
    dateCols.forEach(c => {
      const colIdx = ORDER_COLS.indexOf(c) + 1;
      sheet.getRange(startRow, colIdx, toAppend.length, 1).setNumberFormat('@');
    });
    sheet.getRange(startRow, 1, toAppend.length, ORDER_COLS.length).setValues(toAppend);
  }

  return { ok: true };
}

// 指定したidの行だけを個別に削除する。他の行（他店舗はもちろん、同じ店舗の
// 他の行も）には一切触れない
function deleteOrderRows(ids) {
  if (!ids || !ids.length) return { ok: true };
  const sheet = getSheet(SHEET_ORDERS);
  if (sheet.getLastRow() <= 1) return { ok: true };
  const idSet = new Set(ids.map(String));
  const data = sheet.getDataRange().getValues();
  const idIdx = ORDER_COLS.indexOf('id');
  const toDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (idSet.has(String(data[i][idIdx]))) toDelete.push(i + 1);
  }
  toDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  return { ok: true };
}

// ----------------------------------------------------------------
// app_settings
// ----------------------------------------------------------------

// ログイン時・getMachinePhotoStatus内の台数設定取得等、複数箇所から毎回シート全体を
// 読み直していたため60秒だけCacheServiceで共有する（2026-08-12、同時アクセスが多い時の
// 負荷軽減のため追加。設定はsaveSetting経由の変更なら即キャッシュ破棄されるので、
// 反映漏れは最大60秒のみ）
const SETTINGS_CACHE_KEY = 'settings_rows_v1';
function getSettings() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(SETTINGS_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  const sheet = getSheet(SHEET_SETTINGS);
  if (sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const ki = data[0].indexOf('key'), vi = data[0].indexOf('value');
  const rows = data.slice(1).map(r => ({ key: r[ki], value: r[vi] }));
  try { cache.put(SETTINGS_CACHE_KEY, JSON.stringify(rows), 60); } catch (e) {}
  return rows;
}
function _invalidateSettingsCache_() {
  try { CacheService.getScriptCache().remove(SETTINGS_CACHE_KEY); } catch (e) {}
}

function saveSetting(key, value) {
  const sheet = getSheet(SHEET_SETTINGS);
  ensureHeaders(sheet, ['key', 'value']);
  const data = sheet.getDataRange().getValues();
  const ki = data[0].indexOf('key'), vi = data[0].indexOf('value');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][ki]) === String(key)) {
      _logSettingHistory(key, data[i][vi]);
      sheet.getRange(i + 1, vi + 1).setValue(value);
      _invalidateSettingsCache_();
      return { ok: true };
    }
  }
  _logSettingHistory(key, '');
  sheet.appendRow([key, value]);
  _invalidateSettingsCache_();
  return { ok: true };
}

// 上書き前の値を追記専用ログに残す（削除・上書きは一切しない）。事故発生時はこのシートを
// 新しい順に見て、壊れる直前の正しい値をold_valueからそのまま復元できる
function _logSettingHistory(key, oldValue) {
  const sheet = getSheet(SHEET_SETTINGS_HISTORY);
  ensureHeaders(sheet, SETTINGS_HISTORY_COLS);
  sheet.appendRow([new Date(), key, oldValue]);
}

// 指定キーの履歴を新しい順にlimit件返す（デフォルト20件）。復旧作業時に直接APIを叩いて確認する用途
function getSettingHistory(key, limit) {
  const sheet = getSheet(SHEET_SETTINGS_HISTORY);
  if (sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const hdr = data[0];
  const ti = hdr.indexOf('timestamp'), ki = hdr.indexOf('key'), vi = hdr.indexOf('old_value');
  const n = Number(limit) > 0 ? Number(limit) : 20;
  return data.slice(1)
    .filter(r => String(r[ki]) === String(key))
    .map(r => ({ timestamp: _dateTimeStr(r[ti]), key: r[ki], old_value: r[vi] }))
    .reverse()
    .slice(0, n);
}

// _dateStr()は日付のみ（発注日等）向けのため、履歴ログでは何時何分の保存かも分かるよう
// 日時まで含めて文字列化する専用ヘルパー
function _dateTimeStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, _sheetTz(), 'yyyy-MM-dd HH:mm:ss');
  return v || null;
}

// ----------------------------------------------------------------
// lost_items
// ----------------------------------------------------------------

// 全店舗分の忘れ物データ(整形済み)を短時間(25秒)だけCacheServiceに保持する（2026-07-24、
// attendance/leave_requestsと同じ狙い——1店舗・1ヶ月分だけの絞り込みでも毎回シート全体を
// 読み直していたのを緩和）。書き込み側(saveLostItem/deleteLostItem/purgeOldLostItems)が
// 都度キャッシュを無効化するので、自分自身の直後の再読み込みは必ず最新の状態になる
const LOST_ITEMS_CACHE_KEY = 'lost_items_rows_v1';
function _lostItemsRowsCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(LOST_ITEMS_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = sheetRows(getSheet(SHEET_LOST), LOST_COLS).map(r => ({ ...r, found_date: _dateStr(r.found_date) }));
  try { cache.put(LOST_ITEMS_CACHE_KEY, JSON.stringify(rows), 25); } catch (e) {}
  return rows;
}
function _invalidateLostItemsCache_() {
  try { CacheService.getScriptCache().remove(LOST_ITEMS_CACHE_KEY); } catch (e) {}
}

// ※以前はここでpurgeOldLostItems()を毎回実行していたが、attendanceと同じ理由(全件スキャン＋
// Drive削除を読み取りのたびに行うのは無駄)で、日次バッチ(sendDailyOrderNotification内)側で
// のみ実行するよう移動した
function getLostItems(month, storeId) {
  let rows = _lostItemsRowsCached_();
  if (month)   rows = rows.filter(r => r.found_date && String(r.found_date).startsWith(month));
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  return rows;
}

// 発見日から30日経過した忘れ物を自動削除（紐づく画像もDriveから削除）
function purgeOldLostItems() {
  const sheet = getSheet(SHEET_LOST);
  if (sheet.getLastRow() <= 1) return;
  const limitStr = Utilities.formatDate(new Date(Date.now() - 30*24*60*60*1000), _sheetTz(), 'yyyy-MM-dd');
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const dateIdx = hdrs.indexOf('found_date');
  const urlIdx  = hdrs.indexOf('image_url');
  if (dateIdx < 0) return;
  for (let i = data.length - 1; i >= 1; i--) {
    const found = _dateStr(data[i][dateIdx]);
    if (!found || found >= limitStr) continue;
    const imgUrl = urlIdx >= 0 ? data[i][urlIdx] : '';
    _trashDriveImages(imgUrl);
    sheet.deleteRow(i + 1);
  }
  _invalidateLostItemsCache_();
}

// imagesBase64: 画像0枚以上の配列（複数枚添付対応）。DriveにアップロードしたURLを
// カンマ区切りで既存のimage_url列にそのまま格納する（シート列追加のマイグレーション不要）。
function saveLostItem(item, imagesBase64, imageMime) {
  const sheet = getSheet(SHEET_LOST);
  ensureHeaders(sheet, LOST_COLS);
  let imageUrl = item.image_url || null;
  if (imagesBase64 && imagesBase64.length && IMAGE_FOLDER_ID) {
    imageUrl = imagesBase64
      .map((b64, i) => saveImageToDrive(b64, imageMime || 'image/jpeg', item.id + '_' + i))
      .join(',');
  }
  sheet.appendRow(LOST_COLS.map(c =>
    c === 'image_url' ? (imageUrl || '') : (item[c] === undefined || item[c] === null ? '' : item[c])
  ));
  _invalidateLostItemsCache_();
  return { ok: true, image_url: imageUrl };
}

// imageUrl: カンマ区切りの複数URLを想定（後方互換で単一URLでも動作）
function deleteLostItem(id, imageUrl) {
  const sheet = getSheet(SHEET_LOST);
  if (sheet.getLastRow() <= 1) return { ok: true };
  const data  = sheet.getDataRange().getValues();
  const idIdx = data[0].indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) { sheet.deleteRow(i + 1); break; }
  }
  _invalidateLostItemsCache_();
  _trashDriveImages(imageUrl);
  return { ok: true };
}

function _trashDriveImages(imageUrlList) {
  if (!imageUrlList) return;
  String(imageUrlList).split(',').forEach(url => {
    url = url.trim();
    if (!url || !url.includes('drive.google.com')) return;
    try {
      const m = url.match(/[?&]id=([^&]+)/);
      if (m) DriveApp.getFileById(m[1]).setTrashed(true);
    } catch(e) {}
  });
}

// ----------------------------------------------------------------
// machine_photos（マシン庫内点検写真、毎月5/10/15/20/25/30日を目安に
// パートナーが5点セットをアップロードし、フィルター/材料/カップ切れ等を早期発見する）
// ----------------------------------------------------------------

const MACHINE_PHOTOS_CACHE_KEY = 'machine_photos_rows_v3';
function _machinePhotosRowsCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(MACHINE_PHOTOS_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = sheetRows(getSheet(SHEET_MACHINE_PHOTOS), MACHINE_PHOTO_COLS)
    .map(r => ({
      ...r,
      uploaded_at: _dateTimeStr(r.uploaded_at),
      photosByCategory: (() => { try { return JSON.parse(r.photos_json || '{}'); } catch (e) { return {}; } })(),
    }));
  try { cache.put(MACHINE_PHOTOS_CACHE_KEY, JSON.stringify(rows), 25); } catch (e) {}
  return rows;
}
function _invalidateMachinePhotosCache_() {
  try { CacheService.getScriptCache().remove(MACHINE_PHOTOS_CACHE_KEY); } catch (e) {}
}

// ワンショット移行用（2026-08-12）。2026-08-11に「1行=1店舗×1マシン」化した際、
// appendRowは[id,store_id,machine_index,uploaded_at,photos_json]の5値を書くようになったが、
// ヘッダー行は旧4列[id,store_id,uploaded_at,photos_json]のまま更新されておらず、
// C列以降が1列ずつズレて読めていなかった（machine_indexが常にnull、photos_jsonが
// 日時文字列を指してJSON.parse失敗→{}になる不具合）。8/11より前の旧形式行（4値のみ）は
// C列に日時が入っているので、これだけC列を空にしてD,Eへ1列右にずらし、ヘッダーを
// 正しい5列に直す。新形式行（C列が数値のmachine_index）はデータ位置はそのままでよい。
function migrateMachinePhotoColumns() {
  const sheet = getSheet(SHEET_MACHINE_PHOTOS);
  if (sheet.getLastRow() <= 1) { ensureHeaders(sheet, MACHINE_PHOTO_COLS); return { ok: true, fixedOldFormatRows: 0, totalRows: 0 }; }
  const data = sheet.getDataRange().getValues();
  let fixedCount = 0;
  const fixedRows = data.slice(1).map(row => {
    const c = row[2];
    const looksLikeDate = (c instanceof Date) || (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c));
    if (looksLikeDate) {
      fixedCount++;
      return [row[0], row[1], '', row[2], row[3]];
    }
    return [row[0], row[1], row[2], row[3], row[4] === undefined ? '' : row[4]];
  });
  sheet.getRange(1, 1, 1, MACHINE_PHOTO_COLS.length).setValues([MACHINE_PHOTO_COLS]);
  if (fixedRows.length) sheet.getRange(2, 1, fixedRows.length, 5).setValues(fixedRows);
  _invalidateMachinePhotosCache_();
  return { ok: true, fixedOldFormatRows: fixedCount, totalRows: fixedRows.length };
}

// 店舗ごとのマシン台数設定（app_settingsの'machine_photo_machine_counts'、{storeId:count}のJSON）。
// フロント側のデフォルト値(3台)と合わせておく
function _machinePhotoMachineCounts_() {
  try {
    const s = getSettings().find(x => x.key === 'machine_photo_machine_counts');
    return s ? JSON.parse(s.value || '{}') : {};
  } catch (e) { return {}; }
}
function _machinePhotoMachineCount_(storeId, counts) {
  const n = (counts || _machinePhotoMachineCounts_())[storeId];
  return (n && n >= 1) ? n : 3;
}

// マシン1台単位で1回のアップロード。imagesByCategory: { カテゴリキー: base64 }（1カテゴリ1枚）。
// 台数が違う店舗でも「入力を終えたマシンだけ」個別に送信できるようにするため、
// 以前の「1回の提出=店舗の全マシン分」という単位をやめ、1行=1店舗×1マシン×1回の点検にした
// （2026-08-11、3台無い店舗が全マシン分埋めないと送信できなかった問題への対応。
// 副次効果として1回の送信で扱う画像が最大15枚→5枚に減り、アップロード時間も短縮される）
function saveMachinePhotoSet(storeId, machineIndex, imagesByCategory, imageMime) {
  const sheet = getSheet(SHEET_MACHINE_PHOTOS);
  ensureHeaders(sheet, MACHINE_PHOTO_COLS);
  const id = Utilities.getUuid();
  const uploadedAt = Utilities.formatDate(new Date(), _sheetTz(), 'yyyy-MM-dd HH:mm:ss');
  const urlsByCategory = {};
  Object.keys(imagesByCategory || {}).forEach(catKey => {
    const b64 = imagesByCategory[catKey];
    urlsByCategory[catKey] = b64
      ? saveImageToDrive(b64, imageMime || 'image/jpeg', 'machine_' + storeId + '_' + machineIndex + '_' + id + '_' + catKey)
      : '';
  });
  sheet.appendRow([id, storeId, machineIndex, uploadedAt, JSON.stringify(urlsByCategory)]);
  _invalidateMachinePhotosCache_();
  return { ok: true, urlsByCategory, uploadedAt };
}

// 管理者一覧用：店舗×マシンごとに最新の1回分を返す（そのマシンが一度も提出されていなければ
// uploadedAt=nullの「未提出」行として返す）。台数は_machinePhotoMachineCounts_の設定に従う
function getMachinePhotoStatus() {
  const rows = _machinePhotosRowsCached_();
  const latestByStoreMachine = {};
  rows.forEach(r => {
    const key = r.store_id + '|' + r.machine_index;
    const prev = latestByStoreMachine[key];
    if (!prev || String(r.uploaded_at) > String(prev.uploaded_at)) latestByStoreMachine[key] = r;
  });
  const machineCounts = _machinePhotoMachineCounts_();
  const todayStr = Utilities.formatDate(new Date(), _sheetTz(), 'yyyy-MM-dd');
  const result = [];
  Object.keys(_storeNames_()).forEach(storeId => {
    const count = _machinePhotoMachineCount_(storeId, machineCounts);
    for (let m = 0; m < count; m++) {
      const r = latestByStoreMachine[storeId + '|' + m];
      if (!r) { result.push({ storeId, machineIndex: m, uploadedAt: null, daysSince: null, photoUrls: [] }); continue; }
      const uploadedDate = String(r.uploaded_at).slice(0, 10);
      const daysSince = Math.round((new Date(todayStr) - new Date(uploadedDate)) / (24 * 60 * 60 * 1000));
      result.push({
        storeId,
        machineIndex: m,
        uploadedAt: r.uploaded_at,
        daysSince,
        photoUrls: Object.values(r.photosByCategory || {}).filter(Boolean),
      });
    }
  });
  return result;
}

// パートナー側「前回提出日」表示用：自店舗の過去アップロード履歴（マシンごとに新しい順で使う）
function getMachinePhotoHistory(storeId) {
  return _machinePhotosRowsCached_()
    .filter(r => String(r.store_id) === String(storeId))
    .map(r => ({ id: r.id, store_id: r.store_id, machine_index: r.machine_index, uploaded_at: r.uploaded_at, photosByCategory: r.photosByCategory }))
    .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
}

// アップロードから30日経過したセットを自動削除（found_dateではなくuploaded_at基準。
// 忘れ物のpurgeOldLostItemsと同じ形だが、判定列だけ異なる）
function purgeOldMachinePhotos() {
  const sheet = getSheet(SHEET_MACHINE_PHOTOS);
  if (sheet.getLastRow() <= 1) return;
  const limitStr = Utilities.formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), _sheetTz(), 'yyyy-MM-dd HH:mm:ss');
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const uploadedIdx = hdrs.indexOf('uploaded_at');
  const jsonIdx = hdrs.indexOf('photos_json');
  if (uploadedIdx < 0) return;
  for (let i = data.length - 1; i >= 1; i--) {
    const uploadedAt = _dateTimeStr(data[i][uploadedIdx]);
    if (!uploadedAt || uploadedAt >= limitStr) continue;
    let urls = '';
    try {
      const photosByCategory = JSON.parse((jsonIdx >= 0 ? data[i][jsonIdx] : '') || '{}');
      urls = Object.values(photosByCategory).filter(Boolean).join(',');
    } catch (e) {}
    _trashDriveImages(urls);
    sheet.deleteRow(i + 1);
  }
  _invalidateMachinePhotosCache_();
}

// 店舗ごとの提出タイミングがずれるため、店舗別の未提出督促はせず、6日おき(6/12/18/24/30日)に
// セルフカフェ社員（全国）グループへ「管理者ポータルで確認してください」と定期的に知らせるだけに留める
// （2026-08-11、ユーザー要望により店舗別・エリア別の督促ロジックから変更）
const MACHINE_PHOTO_CHANNEL_PROP_ = 'LW_CHANNEL_ID_MACHINEPHOTO'; // セルフカフェ社員（全国）グループのチャンネルID。Script Propertiesに設定すること
function _machinePhotoChannel_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(MACHINE_PHOTO_CHANNEL_PROP_) || props.getProperty('LW_CHANNEL_ID');
}

function sendMachinePhotoReminder() {
  if (new Date().getDate() % 6 !== 0) return; // 6,12,18,24,30日のみ送信
  sendLineWorksNotification('管理者ポータル内にてマシン点検画像を確認してください', _machinePhotoChannel_());
}

// ----------------------------------------------------------------
// checksheet_data（チェックシートの日別入力）
// ----------------------------------------------------------------

function getChecksheetData(storeId) {
  let rows = sheetRows(getSheet(SHEET_CHECKSHEET), CHECKSHEET_COLS);
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  return rows.map(r => ({
    store_id: r.store_id,
    period_label: _monthLabelStr(r.period_label),
    data: r.data ? JSON.parse(r.data) : {},
  }));
}

// "2026-07"のような年月文字列を書き込むと、Sheetsが日付型セルへ自動変換し、
// 読み出し時にUTC変換で日付がずれる（_dateStrと同じ問題）。period_label用に同様の変換を行う。
function _monthLabelStr(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, _sheetTz(), 'yyyy-MM');
  }
  return v || null;
}

// dayDataの中身が変わったかどうかを、パートナーポータルには一切表示されない予約キー
// `_enteredAt`を除いて比較する(このキー自体を比較に含めると常に「変化あり」になってしまうため)。
function _checksheetDayChanged_(oldDay, newDay) {
  const strip = d => { const c = Object.assign({}, d); delete c._enteredAt; return c; };
  return JSON.stringify(strip(oldDay || {})) !== JSON.stringify(strip(newDay || {}));
}

// 日付ごとの入力時刻(_enteredAt)をdataに埋め込む。パートナーポータル側はprod:接頭辞以外の
// キーを表示に使わないため画面には一切出ない(2026-08-05、実地カウントとの時刻突き合わせ用)。
// クライアントは毎回その月の全日データを丸ごと送ってくる(自分のlocalStorageに_enteredAtの
// 存在を知らない)ため、値が変わっていない日は旧タイムスタンプをこちらでマージして保持する。
function _stampChecksheetEntryTimes_(oldData, newData) {
  const oldD = oldData || {};
  Object.keys(newData || {}).forEach(dayKey => {
    const oldDay = oldD[dayKey];
    if (_checksheetDayChanged_(oldDay, newData[dayKey])) {
      newData[dayKey]._enteredAt = new Date().toISOString();
    } else if (oldDay && oldDay._enteredAt) {
      newData[dayKey]._enteredAt = oldDay._enteredAt;
    }
  });
  return newData;
}

function saveChecksheetData(storeId, periodLabel, data) {
  const sheet = getSheet(SHEET_CHECKSHEET);
  ensureHeaders(sheet, CHECKSHEET_COLS);
  const now  = new Date().toISOString();
  if (sheet.getLastRow() > 1) {
    const values = sheet.getDataRange().getValues();
    const sidIdx = values[0].indexOf('store_id'), pidIdx = values[0].indexOf('period_label');
    const dataIdx = values[0].indexOf('data'), updIdx = values[0].indexOf('updated_at');
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][sidIdx]) === String(storeId) && _monthLabelStr(values[i][pidIdx]) === String(periodLabel)) {
        const oldData = values[i][dataIdx] ? JSON.parse(values[i][dataIdx]) : {};
        const merged = _stampChecksheetEntryTimes_(oldData, data || {});
        sheet.getRange(i + 1, dataIdx + 1).setValue(JSON.stringify(merged));
        sheet.getRange(i + 1, updIdx + 1).setValue(now);
        return { ok: true };
      }
    }
  }
  // period_labelが"YYYY-MM"のまま日付型に自動変換されないよう、書き込み前にプレーンテキスト形式へ固定する
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, CHECKSHEET_COLS.indexOf('period_label') + 1).setNumberFormat('@');
  const merged = _stampChecksheetEntryTimes_({}, data || {});
  sheet.appendRow([storeId, periodLabel, JSON.stringify(merged), now]);
  return { ok: true };
}

// ----------------------------------------------------------------
// attendance（出勤打刻）
// ----------------------------------------------------------------

// 全店舗分の打刻データ(整形済み)を短時間(25秒)だけCacheServiceに保持し、1店舗だけがアクセスする
// 場合でも毎回シート全体を読み直さずに済むようにする（2026-07-24、1店舗だけの利用でも業務開始履歴の
// 表示が遅いとの指摘を受けて追加）。書き込み側(saveAttendance/purgeOldAttendance)が保存・削除の
// たびにこのキャッシュを明示的に無効化するので、自分自身の直後の再読み込みは必ず最新の状態になる。
// ※Date型のままキャッシュするとJSON化でUTC文字列に化けてしまうため、_dateTimeStrで
//   タイムゾーン変換した後の文字列としてキャッシュする（Date型を保持したままキャッシュしない）
const ATTENDANCE_CACHE_KEY = 'attendance_rows_v1';
function _attendanceRowsCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(ATTENDANCE_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = sheetRows(getSheet(SHEET_ATTENDANCE), ATTENDANCE_COLS)
    .map(r => Object.assign({}, r, { clocked_at: _dateTimeStr(r.clocked_at) }));
  try { cache.put(ATTENDANCE_CACHE_KEY, JSON.stringify(rows), 25); } catch (e) {} // 100KB上限超過時は諦めて次回も都度読む
  return rows;
}
function _invalidateAttendanceCache_() {
  try { CacheService.getScriptCache().remove(ATTENDANCE_CACHE_KEY); } catch (e) {}
}

// storeIdを渡すと自店舗分のみ、省略すると全店舗分を返す（パートナー/管理者で共通利用）
// ※以前はここでpurgeOldAttendance()を毎回実行していたが、全打刻を毎回スキャンする重い処理を
// パートナー/管理者が画面を開くたびの読み取りパスに乗せるのは無駄なので、日次バッチ
// （sendDailyAttendanceCheck、1日1回8:30）側でのみ実行するよう移動した
function getAttendance(storeId) {
  let rows = _attendanceRowsCached_();
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  return rows.slice().sort((a, b) => String(b.clocked_at).localeCompare(String(a.clocked_at)));
}

// 打刻日時から3ヶ月経過した出勤履歴を自動削除（全店舗運用時のシート肥大化・一覧描画の重さ対策）
function purgeOldAttendance() {
  const sheet = getSheet(SHEET_ATTENDANCE);
  if (sheet.getLastRow() <= 1) return;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const limitStr = Utilities.formatDate(cutoff, _sheetTz(), 'yyyy-MM-dd HH:mm:ss');
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const dateIdx = hdrs.indexOf('clocked_at');
  if (dateIdx < 0) return;
  for (let i = data.length - 1; i >= 1; i--) {
    const clocked = _dateTimeStr(data[i][dateIdx]);
    if (!clocked || clocked >= limitStr) continue;
    sheet.deleteRow(i + 1);
  }
  _invalidateAttendanceCache_();
}

// 2点の緯度経度間の距離をメートルで返す（Haversine formula）
function _haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 店舗の基準座標（app_settingsの'attendance_store_coords'キー、{storeId:{lat,lng}}のJSON）と
// 打刻位置の距離を計算し、ATTENDANCE_THRESHOLD_M以内かどうかを判定した上で1行追加/更新する。
// 記録は「出勤のみ・退勤なし」の1日1回想定の機能なので、同じ店舗・同じ名前で当日既に打刻済みの
// 行があれば新規追加せず上書き更新する（判定外の場所で押した後、判定内の場所で押し直した場合等に
// 対応。連打や複数端末からのほぼ同時押しで別々の行が2つできてしまう問題も、この「当日1人1行」への
// 統一で結果的に解消される——クライアント側の連打防止(doAttendanceClockInのボタン無効化)は
// あくまで補助で、こちらがデータ上の最終防御）
function saveAttendance(storeId, name, lat, lng) {
  const sheet = getSheet(SHEET_ATTENDANCE);
  ensureHeaders(sheet, ATTENDANCE_COLS);

  const coordsSetting = getSettings().find(s => s.key === 'attendance_store_coords');
  const coordsMap = coordsSetting ? JSON.parse(coordsSetting.value || '{}') : {};
  const base = coordsMap[storeId];
  let withinRange = '';
  if (base && base.lat != null && base.lng != null && lat != null && lng != null) {
    const dist = _haversineMeters(Number(lat), Number(lng), Number(base.lat), Number(base.lng));
    withinRange = dist <= ATTENDANCE_THRESHOLD_M;
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, _sheetTz(), 'yyyy-MM-dd');
  let updatedExisting = false;
  if (sheet.getLastRow() > 1) {
    const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const idIdx = hdrs.indexOf('id'), storeIdx = hdrs.indexOf('store_id'), nameIdx = hdrs.indexOf('name'), dateIdx = hdrs.indexOf('clocked_at');
    // 該当行の絞り込みに使う列(id/store_id/name/clocked_at)までだけを読む(2026-08-01追加)。
    // lat/lng/within_range列は判定に不要なので読まない——inventory_logと同じ理由で列を絞った
    // (出勤履歴は3ヶ月パージがあるため無限には増えないが、店舗数が増えるほど直近3ヶ月分の
    // 行数も比例して増えるため、同じ最適化を適用する)
    const narrowCols = Math.max(idIdx, storeIdx, nameIdx, dateIdx) + 1;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, narrowCols).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (String(data[i][storeIdx]) !== String(storeId)) continue;
      if ((data[i][nameIdx] || '') !== (name || '')) continue;
      const clocked = _dateTimeStr(data[i][dateIdx]);
      if (!clocked || clocked.slice(0, 10) !== todayStr) continue;
      sheet.getRange(i + 2, 1, 1, ATTENDANCE_COLS.length).setValues([[data[i][idIdx], storeId, name, now, lat, lng, withinRange]]);
      updatedExisting = true;
      break;
    }
  }
  if (!updatedExisting) sheet.appendRow([Utilities.getUuid(), storeId, name, now, lat, lng, withinRange]);
  _invalidateAttendanceCache_();
  // 通知の送信はここでは行わず、_notifyに要否だけ載せてdoPostへ返す（doPostがLockService解放後に送信する。
  // 通知はシートの読み書きと競合しない独立した処理なので、他店舗の書き込みをブロックする理由が無い）
  const result = { ok: true, withinRange, updated: updatedExisting };
  if (withinRange === false) result._notify = { type: 'attendanceGpsIssue', storeId, name };
  return result;
}

// GPS要確認（基準座標から離れた場所での打刻）は翌朝のバッチを待たずその場で通知する
function notifyAttendanceGpsIssue_(storeId, name) {
  try {
    const who = name ? name + 'さん' : '担当者';
    sendLineWorksNotification('【GPS要確認】' + who + 'の業務開始打刻が、店舗から離れた場所として記録されました。（店舗ID: ' + _storeIdLabel_(storeId) + '）', _attendanceLineWorksChannel_(storeId));
  } catch(e) {
    console.error('LINE WORKS通知エラー:', e.message);
  }
}

// ----------------------------------------------------------------
// attendance_leave（休み申請）
// ----------------------------------------------------------------

// storeIdを渡すと自店舗分のみ、省略すると全店舗分を返す（パートナー/管理者で共通利用）
// getAttendanceと同じ狙い(2026-07-24)。全店舗分の休み申請(整形済み)を短時間(25秒)だけキャッシュし、
// 1店舗だけのアクセスでも毎回シート全体を読み直さずに済むようにする。書き込み側
// (saveLeaveRequest/deleteLeaveRequest)が都度キャッシュを無効化するので、自分自身の直後の
// 再読み込みは必ず最新の状態になる
const LEAVE_REQUESTS_CACHE_KEY = 'leave_requests_rows_v1';
function _leaveRequestsRowsCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(LEAVE_REQUESTS_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = sheetRows(getSheet(SHEET_ATTENDANCE_LEAVE), ATTENDANCE_LEAVE_COLS)
    .map(r => Object.assign({}, r, { leave_date: _dateStr(r.leave_date), submitted_at: _dateTimeStr(r.submitted_at) }));
  try { cache.put(LEAVE_REQUESTS_CACHE_KEY, JSON.stringify(rows), 25); } catch (e) {}
  return rows;
}
function _invalidateLeaveRequestsCache_() {
  try { CacheService.getScriptCache().remove(LEAVE_REQUESTS_CACHE_KEY); } catch (e) {}
}

// 休み申請の日時(leave_date)から3ヶ月経過した行を自動削除する(2026-08-01追加、purgeOldAttendanceと
// 同じパターン)。休み申請はinventory_logと違い「過去分の恒久保存が必要な記録」ではなく、出勤履歴と
// 同じ運用ログという位置付けでよいとユーザーが明言したため、無期限蓄積をやめて3ヶ月でパージする。
// 読み取りのたびではなく日次バッチ(sendDailyAttendanceCheck)側でのみ呼ぶ(attendanceと同じ理由)
function purgeOldLeaveRequests() {
  const sheet = getSheet(SHEET_ATTENDANCE_LEAVE);
  if (sheet.getLastRow() <= 1) return;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const limitStr = Utilities.formatDate(cutoff, _sheetTz(), 'yyyy-MM-dd');
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const dateIdx = hdrs.indexOf('leave_date');
  if (dateIdx < 0) return;
  let deleted = false;
  for (let i = data.length - 1; i >= 1; i--) {
    const d = _dateStr(data[i][dateIdx]);
    if (!d || d >= limitStr) continue;
    sheet.deleteRow(i + 1);
    deleted = true;
  }
  if (deleted) _invalidateLeaveRequestsCache_();
}

function getLeaveRequests(storeId) {
  let rows = _leaveRequestsRowsCached_();
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  return rows.slice().sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
}

// 「業務開始」タブを開いた時、getAttendance/getLeaveRequestsを別々に2往復させず1回にまとめる。
// クライアント側は既にPromise.allで並列取得していたが、Apps Script呼び出し自体の起動
// オーバーヘッドは並列化しても1回分減らせないため、getInventoryTabDataと同じ狙いで
// 往復回数を2回→1回に減らすのが目的（各データの中身・絞り込みロジックは変えていない）。
// 片方が例外を投げても他方を巻き添えにしないよう個別にtry/catchする
function getAttendanceTabData(storeId) {
  const result = { history: [], leaveRequests: [] };
  try { result.history = getAttendance(storeId); }
  catch (e) { result.historyError = e.message; }
  try { result.leaveRequests = getLeaveRequests(storeId); }
  catch (e) { result.leaveRequestsError = e.message; }
  return result;
}

// 承認ステップなし、申請した瞬間に即時確定（2026-07-23確定仕様）。
// 申請日が「申請時点の翌日」の場合のみ、翌朝8:30の日次通知を待たずその場でLINE WORKS通知する
// （代打調整等の対応余地を残すため）。翌々日以降の申請は日次まとめ通知(sendDailyAttendanceCheck)に含める。
function saveLeaveRequest(storeId, name, leaveDate) {
  const sheet = getSheet(SHEET_ATTENDANCE_LEAVE);
  ensureHeaders(sheet, ATTENDANCE_LEAVE_COLS);
  sheet.appendRow([Utilities.getUuid(), storeId, name, leaveDate, new Date()]);
  _invalidateLeaveRequestsCache_();

  // 通知の送信はここでは行わず、_notifyに要否だけ載せてdoPostへ返す（doPostがLockService解放後に送信する）
  const result = { ok: true };
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 24*60*60*1000), _sheetTz(), 'yyyy-MM-dd');
  if (leaveDate === tomorrow) result._notify = { type: 'leaveRequestTomorrow', storeId, name, leaveDate };
  return result;
}

function notifyLeaveRequestTomorrow_(storeId, name, leaveDate) {
  try {
    const who = name ? name + 'さん' : 'パートナーさん';
    const md = leaveDate.slice(5).replace('-', '/');
    sendLineWorksNotification('【休み申請】' + who + 'が明日(' + md + ')休み申請をしました。（店舗ID: ' + _storeIdLabel_(storeId) + '）\n当日の現地対応方針の確定が必要です。', _leaveLineWorksChannel_(storeId));
  } catch(e) {
    console.error('LINE WORKS通知エラー:', e.message);
  }
}

// キャンセル（取り消し）。承認ステップが無いのと同様、取り消しも即時反映（確認ステップ無し）。
// 取り消し対象が「取り消し時点の翌日」の休みだった場合のみ、既に翌日分として即時通知済み
// である可能性が高いため、取り消しもLINE WORKSで即時通知する（それ以外は日次まとめ通知止まりのため不要）。
function deleteLeaveRequest(id) {
  const sheet = getSheet(SHEET_ATTENDANCE_LEAVE);
  if (sheet.getLastRow() <= 1) return { ok: true };
  const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idIdx = hdrs.indexOf('id'), storeIdx = hdrs.indexOf('store_id'),
        nameIdx = hdrs.indexOf('name'), dateIdx = hdrs.indexOf('leave_date');
  const result = { ok: true };
  // id列だけを先に読んで該当行を絞り込む(2026-08-01追加)。休み申請は出勤履歴と違い
  // 定期パージが無く無期限に蓄積するシートのため、inventory_logと同じ理由で列を絞った——
  // 該当行が見つかってから、その行だけ残りの列(store_id/name/leave_date)を読む
  const idVals = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues();
  let matchRow = -1;
  for (let i = 0; i < idVals.length; i++) {
    if (String(idVals[i][0]) === String(id)) { matchRow = i + 2; break; }
  }
  if (matchRow > 0) {
    const rowVals = sheet.getRange(matchRow, 1, 1, hdrs.length).getValues()[0];
    const storeId = rowVals[storeIdx];
    const name = rowVals[nameIdx];
    const leaveDate = _dateStr(rowVals[dateIdx]);
    sheet.deleteRow(matchRow);
    _invalidateLeaveRequestsCache_();
    const tomorrow = Utilities.formatDate(new Date(Date.now() + 24*60*60*1000), _sheetTz(), 'yyyy-MM-dd');
    if (leaveDate === tomorrow) result._notify = { type: 'leaveRequestCancelled', storeId, name, leaveDate };
  }
  return result;
}

function notifyLeaveRequestCancelled_(storeId, name, leaveDate) {
  try {
    const who = name ? name + 'さん' : 'パートナーさん';
    const md = leaveDate.slice(5).replace('-', '/');
    sendLineWorksNotification('【休み申請取消】' + who + 'の明日(' + md + ')の休み申請が取り消されました。（店舗ID: ' + _storeIdLabel_(storeId) + '）', _leaveLineWorksChannel_(storeId));
  } catch(e) {
    console.error('LINE WORKS通知エラー:', e.message);
  }
}

// ----------------------------------------------------------------
// delivery_history（発注を「納品済み」にした際の履歴ログ）
// ----------------------------------------------------------------
// メインのSHEET_ID側とは別スプレッドシート（DELIVERY_HISTORY_SHEET_ID）に追記専用で記録する
// （INVENTORY_SHEET_IDへの相乗りも検討したが、棚卸機能自体がまだ未着手でこのIDが存在しない
// ため、2026-07-18時点では独立した専用スプレッドシートとする）。
// ordersのような全件削除→再送信ではなく1行追記のみのため、複数リクエストが競合しても
// 既存データを巻き添えで消すことがない。自動削除もしない（消えては困る記録のため）——
// 取得側はgetLostItemsと同じ「month指定で絞り込み」に対応しつつ、month省略時はデフォルトで
// 直近3ヶ月分のみ返す（店舗の運用年数が経つにつれ全件取得・描画が重くなるのを防ぐため。
// データ自体は消えないので、古い分を見たい時はmonthを指定して呼び出せばよい）。
function getDeliveryHistorySheet() {
  const ss = SpreadsheetApp.openById(DELIVERY_HISTORY_SHEET_ID);
  return ss.getSheetByName(SHEET_DELIVERY_HISTORY) || ss.insertSheet(SHEET_DELIVERY_HISTORY);
}
// タイムゾーンはSHEET_ID側と共有せず、発注履歴スプレッドシート自体のものを使う
// （_invSheetTzと同じ理由。別Driveのスプレッドシートなのでタイムゾーンが異なる可能性がある）
let _cachedDelHistTz = null;
function _delHistSheetTz() {
  if (!_cachedDelHistTz) _cachedDelHistTz = SpreadsheetApp.openById(DELIVERY_HISTORY_SHEET_ID).getSpreadsheetTimeZone();
  return _cachedDelHistTz;
}
function _delHistDateStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, _delHistSheetTz(), 'yyyy-MM-dd');
  return v || null;
}
function _delHistDateTimeStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, _delHistSheetTz(), 'yyyy-MM-dd HH:mm:ss');
  return v || null;
}

// 納品確認日（delivered_at）から30日経過した履歴を自動削除する
// （2026-07-18時点でのユーザー指示：以前のlocalStorage版purgeHistoryと同じ「1ヶ月保存→自動削除」の
// 仕様を維持する。ただし今回はGAS側の共有スプレッドシートに対して行うため、どの端末から見ても
// 同じ基準で削除・表示される）
function purgeOldDeliveryHistory() {
  const sheet = getDeliveryHistorySheet();
  if (sheet.getLastRow() <= 1) return;
  const limit = Date.now() - 30*24*60*60*1000;
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const idx = hdrs.indexOf('delivered_at');
  if (idx < 0) return;
  for (let i = data.length - 1; i >= 1; i--) {
    const v = data[i][idx];
    const t = v instanceof Date ? v.getTime() : Number(v);
    if (t && t > limit) continue;
    sheet.deleteRow(i + 1);
  }
  _invalidateDeliveryHistoryCache_();
}

// 全店舗分の納品履歴(整形済み)を短時間(25秒)だけCacheServiceに保持する（2026-07-24、
// attendance/leave_requests/lost_itemsと同じ狙い）。書き込み側
// (saveDeliveryHistory/clearDeliveryHistory/purgeOldDeliveryHistory)が都度キャッシュを
// 無効化するので、自分自身の直後の再読み込みは必ず最新の状態になる
const DELIVERY_HISTORY_CACHE_KEY = 'delivery_history_rows_v1';
function _deliveryHistoryRowsCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(DELIVERY_HISTORY_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = sheetRows(getDeliveryHistorySheet(), DELIVERY_HISTORY_COLS).map(r => ({
    ...r,
    request_date: _delHistDateStr(r.request_date),
    order_date: _delHistDateStr(r.order_date),
    delivery_date: _delHistDateStr(r.delivery_date),
    delivered_at_str: _delHistDateTimeStr(r.delivered_at),
    delivered_at: r.delivered_at instanceof Date ? r.delivered_at.getTime() : (Number(r.delivered_at) || null),
  }));
  try { cache.put(DELIVERY_HISTORY_CACHE_KEY, JSON.stringify(rows), 25); } catch (e) {}
  return rows;
}
function _invalidateDeliveryHistoryCache_() {
  try { CacheService.getScriptCache().remove(DELIVERY_HISTORY_CACHE_KEY); } catch (e) {}
}

// ※以前はここでpurgeOldDeliveryHistory()を毎回実行していたが、attendance/lost_itemsと同じ理由で
// 日次バッチ(sendDailyOrderNotification内)側でのみ実行するよう移動した
function getDeliveryHistory(storeId, month) {
  let rows = _deliveryHistoryRowsCached_();
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  if (month) rows = rows.filter(r => String(r.delivered_at_str || '').startsWith(month));
  return rows.slice().sort((a, b) => (b.delivered_at||0) - (a.delivered_at||0));
}

function saveDeliveryHistory(storeId, row) {
  const sheet = getDeliveryHistorySheet();
  ensureHeaders(sheet, DELIVERY_HISTORY_COLS);
  sheet.appendRow(DELIVERY_HISTORY_COLS.map(c => {
    if (c === 'store_id') return storeId;
    if (c === 'delivered_at') return new Date();
    const v = row ? row[c] : null;
    return (v === undefined || v === null) ? '' : v;
  }));
  _invalidateDeliveryHistoryCache_();
  return { ok: true };
}

// 全店舗一括削除（clearAllOrders）からのみ呼ばれる想定。対象店舗の行をすべて削除する
function clearDeliveryHistory(storeId) {
  const sheet = getDeliveryHistorySheet();
  if (sheet.getLastRow() <= 1) return { ok: true };
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const sidIdx = hdrs.indexOf('store_id');
  if (sidIdx < 0) return { ok: true };
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][sidIdx]) === String(storeId)) sheet.deleteRow(i + 1);
  }
  _invalidateDeliveryHistoryCache_();
  return { ok: true };
}

// 修正前のperiod_label自動変換バグにより、同じ店舗×年月の行が複数重複してしまったものを
// 統合するための一度限りのメンテナンス関数。Web公開はしておらず、Apps Scriptエディタから
// 直接（関数を選んでRunボタンで）実行する想定。updated_atが最新の行だけを残し、他は削除する。
function compactChecksheetData() {
  const sheet = getSheet(SHEET_CHECKSHEET);
  if (sheet.getLastRow() <= 1) return;
  const values = sheet.getDataRange().getValues();
  const sidIdx = values[0].indexOf('store_id'), pidIdx = values[0].indexOf('period_label');
  const updIdx = values[0].indexOf('updated_at');
  const keep = {}; // key -> { rowIndex, updatedAt }
  const toDelete = [];
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][sidIdx]) + '|' + _monthLabelStr(values[i][pidIdx]);
    const raw = values[i][updIdx];
    const updatedAt = raw instanceof Date ? raw.getTime() : (Date.parse(raw) || 0);
    if (!keep[key] || updatedAt >= keep[key].updatedAt) {
      if (keep[key]) toDelete.push(keep[key].rowIndex);
      keep[key] = { rowIndex: i + 1, updatedAt };
    } else {
      toDelete.push(i + 1);
    }
  }
  toDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  // 残った行のperiod_labelも、念のためプレーンテキストへ固定し直す
  const pidCol = pidIdx + 1;
  Object.values(keep).forEach(({ rowIndex }) => {
    const cell = sheet.getRange(rowIndex, pidCol);
    const clean = _monthLabelStr(cell.getValue());
    cell.setNumberFormat('@').setValue(clean);
  });
  Logger.log('重複削除: %s行削除、%s件のユニークな店舗×年月が残りました', toDelete.length, Object.keys(keep).length);
}

// ----------------------------------------------------------------
// inventory_log（棚卸完了：期首/期末/消費量/デイリーカウントの月次送信）
// ----------------------------------------------------------------
// 棚卸集計は別スプレッドシート（別Driveの場合あり）のため、SHEET_IDとは別に開く。
// あらかじめこの実行アカウントに編集権限で共有しておくこと。
function getInventorySheet() {
  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  return ss.getSheetByName(SHEET_INVENTORY) || ss.insertSheet(SHEET_INVENTORY);
}
// タイムゾーンはSHEET_ID側と共有せず、棚卸集計スプレッドシート自体のものを使う
// （_sheetTzと同じ理由。別Driveのスプレッドシートなのでタイムゾーンが異なる可能性がある）
let _cachedInvTz = null;
function _invSheetTz() {
  if (!_cachedInvTz) _cachedInvTz = SpreadsheetApp.openById(INVENTORY_SHEET_ID).getSpreadsheetTimeZone();
  return _cachedInvTz;
}
// "2026-06"のような年月文字列がSheetsに日付型セルへ自動変換されるのを防ぐ
// （_monthLabelStrと同じ問題。棚卸集計側のタイムゾーンを使う点だけが異なる）
function _invMonthLabelStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, _invSheetTz(), 'yyyy-MM');
  return v || null;
}

// inventory_log全体(生の2次元配列)を短時間(25秒)だけCacheServiceに保持する
// （2026-08-01、getInventoryHistory/buildStoreInventorySheet/buildStockCheckMonthly等、
// 棚卸完了1回につき複数の関数がそれぞれ独立にinventory_log全体を読み直しており、店舗数・
// 蓄積期間が増えるほど遅くなる設計だった——ユーザーから「店舗数が増えると遅くなるなら困る」と
// 指摘を受けて追加。attendance/leave_requests/lost_itemsで既に実績のある同じキャッシュパターン
// （[[project_internal_web_system]]の2026-07-24対応）をinventory_logにも適用した）。
// ⚠️ inventory_logは出勤ログ等と違い定期パージが無く際限なく蓄積するシートのため、
// CacheServiceの1キー100KB上限を超える規模になった時点でキャッシュが効かなくなり
// 都度読み直しに自然劣化する(エラーにはならない、その場合は今まで通りの動作に戻るだけ)。
// 将来的にデータ量がその規模に達したら、店舗×期間で読む範囲を絞り込む設計(別途検討)が必要になる。
const INVENTORY_LOG_CACHE_KEY = 'inventory_log_rows_v1';
function _inventoryLogRowsCached_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(INVENTORY_LOG_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const sheet = getInventorySheet();
  const data = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  // Date型セルはJSON化でUTC文字列に化けてしまうため、キャッシュに入れる前に文字列化しておく
  // （_invMonthLabelStr等が期待する形に later 変換できるよう、素朴なISO風文字列に揃える）
  const safe = data.map(row => row.map(v =>
    v instanceof Date ? Utilities.formatDate(v, _invSheetTz(), "yyyy-MM-dd'T'HH:mm:ss") : v
  ));
  try { cache.put(INVENTORY_LOG_CACHE_KEY, JSON.stringify(safe), 25); } catch (e) {} // 100KB超過時は諦めて次回も都度読む
  return safe;
}
function _invalidateInventoryLogCache_() {
  try { CacheService.getScriptCache().remove(INVENTORY_LOG_CACHE_KEY); } catch (e) {}
}

function getInventoryHistory(storeId, periodLabel) {
  const data = _inventoryLogRowsCached_();
  if (data.length <= 1) return [];
  const rows = data.slice(1).map(row => {
    const obj = {};
    // ヘッダーの表示テキスト(日本語)ではなく、INVENTORY_COLSの宣言順=物理列位置として読む
    INVENTORY_COLS.forEach((c, i) => { obj[c] = i < row.length ? row[i] : null; });
    obj.period_label = _invMonthLabelStr(obj.period_label);
    return obj;
  });
  return rows.filter(r =>
    (!storeId || String(r.store_id) === String(storeId)) &&
    (!periodLabel || r.period_label === String(periodLabel))
  );
}

// 発注タブでの発注数量の初期提案に使う(2026-08-11追加)。指定店舗について商品コードごとに
// 直近(period_labelが最も新しい)棚卸の消費量を返す。商品名ではなく商品コードをキーにするのは、
// 発注側のPRODUCTS(商品名)と棚卸側のinventory_log(商品名+商品コード)を突き合わせる際、
// 表記ゆれではなく一意な商品コードで結びつけたいというユーザー要望による。
// 消費量が空欄(未入力)や0以下の行は候補から除外する(発注数量の提案としては意味を持たないため)。
function getLatestConsumptionByCode(storeId) {
  const data = _inventoryLogRowsCached_();
  const result = {};
  if (data.length <= 1) return result;
  const codeIdx   = INVENTORY_COLS.indexOf('code');
  const sidIdx     = INVENTORY_COLS.indexOf('store_id');
  const periodIdx  = INVENTORY_COLS.indexOf('period_label');
  const consIdx    = INVENTORY_COLS.indexOf('consumption');
  const latestPeriodByCode = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[sidIdx]) !== String(storeId)) continue;
    const code = row[codeIdx];
    if (!code) continue;
    const consumption = row[consIdx];
    if (consumption === '' || consumption === null || consumption === undefined) continue;
    const n = Number(consumption);
    if (!(n > 0)) continue;
    const period = _invMonthLabelStr(row[periodIdx]);
    if (!latestPeriodByCode[code] || period > latestPeriodByCode[code]) {
      latestPeriodByCode[code] = period;
      result[code] = n;
    }
  }
  return result;
}

// 同じ店舗×年月の既存行を全て削除してから送信内容を書き直す（当月分は何度でも上書き修正できる）。
// ⚠️2026-07-31、マージ方式に変更(ユーザー指摘で発覚した事故を受けての修正)：
// パートナーがPCとスマホ等、複数端末で棚卸を入力する場合(例: PCでドリンク類、スマホでお菓子類を
// それぞれ入力)、期末在庫などの入力状態はブラウザのlocalStorageに端末ごとに保持されるため、
// 片方の端末では他方の端末で入力した商品の値を知らない。そのまま従来の「全削除→丸ごと書き直し」
// をすると、後から送信した端末が「未入力(空欄)」で送ってきた商品を、既に別端末で入力・保存済み
// だった値までまとめて空欄に上書きしてしまう事故が起きていた(渋谷神南店・2026年7月で発生)。
// 対策：今回送信された値が空欄(未入力)の項目は、既存のシート上の値をそのまま残す。値が明示的に
// 入っている項目(0や実際の数値・文字列)は今回の送信内容で正しく上書きする。「rowsを空配列で送って
// 削除する」という既存の使い方([[feature_inventory_phase1]]参照)は、削除自体は送信内容に関わらず
// 常に行われる(そのままの挙動)ため影響しない。
// この店舗×期間に該当する行番号(1-based、データ行のみ)だけをまず特定する。store_id・period_labelの
// 2列だけを読んで絞り込み、該当しない大多数の行は他の列も含めて一切読まない(2026-08-01追加)。
// ユーザーから「inventory_log全体を毎回読む設計は店舗数・年数が増えると重くなるのでは」と指摘を受け、
// saveInventorySnapshot(棚卸完了ボタンが実際に待つ処理)のこの部分だけ読み込み範囲を絞った。
// ※getInventoryHistory等の参照系はCacheServiceでの25秒キャッシュ(_inventoryLogRowsCached_)で対応済み
// だが、ここは複数端末での同時送信の正しいマージに直結するため、キャッシュ(最大25秒古い可能性)は
// 使わず常に最新のシートを直接読む——正確性を優先し、代わりに読む「列数」を絞ることで高速化する。
function _matchingInventoryLogRowNumbers_(sheet, storeId, periodLabel) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const sidCol = INVENTORY_COLS.indexOf('store_id') + 1;
  const pidCol = INVENTORY_COLS.indexOf('period_label') + 1;
  const sidVals = sheet.getRange(2, sidCol, lastRow - 1, 1).getValues();
  const pidVals = sheet.getRange(2, pidCol, lastRow - 1, 1).getValues();
  const matchRows = [];
  for (let i = 0; i < sidVals.length; i++) {
    if (String(sidVals[i][0]) === String(storeId) && _invMonthLabelStr(pidVals[i][0]) === String(periodLabel)) {
      matchRows.push(i + 2); // 1-based行番号(見出し行の分+1)
    }
  }
  return matchRows;
}

function saveInventorySnapshot(storeId, periodLabel, rows, remarks) {
  const sheet = getInventorySheet();
  ensureHeaders(sheet, INVENTORY_HEADERS_JA);
  const now = new Date().toISOString();

  // 削除前に、この店舗×期間の既存行を商品名(product)をキーに保持しておく(マージに使う)
  const existingByProduct = {};
  const remarksIdx = INVENTORY_COLS.indexOf('remarks');
  const prodIdx = INVENTORY_COLS.indexOf('product');
  const matchRows = _matchingInventoryLogRowNumbers_(sheet, storeId, periodLabel);
  if (matchRows.length) {
    // 該当行は同じ送信でまとめて追記された連続ブロックであることが多いため、連続区間ごとに
    // まとめて1回のgetRangeで読む(該当行がバラバラでも正しく動くが、連続していれば読み込み回数が減る)
    const runs = [];
    let runStart = matchRows[0], runPrev = matchRows[0];
    for (let i = 1; i <= matchRows.length; i++) {
      const cur = matchRows[i];
      if (cur !== runPrev + 1) {
        runs.push([runStart, runPrev]);
        runStart = cur;
      }
      runPrev = cur;
    }
    runs.forEach(([start, end]) => {
      const vals = sheet.getRange(start, 1, end - start + 1, INVENTORY_COLS.length).getValues();
      vals.forEach(v => { existingByProduct[v[prodIdx]] = v; });
    });
    // 末尾側から削除して行番号ズレを避ける(既存の削除順ルールを踏襲)
    matchRows.slice().sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  }

  if (rows && rows.length) {
    // remarksは店舗×期間で1つだけの値(全商品行に同じ値を複製する仕様)。今回の送信が空欄なら、
    // 既存行のうちどれか1つに残っている値を引き継ぐ(remarksを消した端末の送信で他端末の備考を消さない)
    const anyExisting = Object.values(existingByProduct)[0];
    const effectiveRemarks = remarks || (anyExisting ? anyExisting[remarksIdx] : '');
    const newRows = rows.map(r => {
      const existing = existingByProduct[r.product];
      return INVENTORY_COLS.map((c, i) => {
        if (c === 'period_label') return periodLabel;
        if (c === 'store_id')     return storeId;
        if (c === 'remarks')      return effectiveRemarks;
        if (c === 'updated_at')   return now;
        if (c === 'store_type')   return _isFcStore_(storeId) ? 'FC' : '直営';
        const v = r[c];
        if (v === undefined || v === null || v === '') {
          // 今回未入力(空欄)の項目は、既存のシート上の値をそのまま残す(他端末の入力を消さない)
          return existing ? existing[i] : '';
        }
        return v;
      });
    });
    const startRow = sheet.getLastRow() + 1;
    // period_labelが"YYYY-MM"のまま日付型に自動変換されないよう、書き込み前にプレーンテキスト形式へ固定する
    sheet.getRange(startRow, INVENTORY_COLS.indexOf('period_label') + 1, newRows.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 1, newRows.length, INVENTORY_COLS.length).setValues(newRows);
    // 備考(remarks)は店舗×期間で1つの「棚卸備考」を全商品行に同じ値として複製しているだけなので、
    // 同一値が並ぶ見た目の重複感を減らすため月ブロック内で縦結合する(2026-07-28、ユーザー指摘)。
    // 結合すると先頭行以外は空になる(Sheetsの結合セル仕様)——remarksはgetInventoryHistory経由で
    // 「先月実績参考」表示にも使われているが、いずれかの商品行に値があれば拾う実装なので実害は
    // 小さいと判断した上で結合する
    if (newRows.length > 1) {
      const remarksCol = INVENTORY_COLS.indexOf('remarks') + 1;
      sheet.getRange(startRow, remarksCol, newRows.length, 1).setVerticalAlignment('middle').merge();
      // 更新日時(M列)も備考と同じ理由(見た目の重複感を減らす)で縦結合する(2026-08-11、ユーザー指摘)。
      // 全商品行に同じnowを書き込む処理自体は変えず、表示だけ月ブロック先頭行の1か所にまとめる
      const updatedAtCol = INVENTORY_COLS.indexOf('updated_at') + 1;
      sheet.getRange(startRow, updatedAtCol, newRows.length, 1).setVerticalAlignment('middle').merge();
    }
    // 渋谷神南タブへの自動反映(buildStoreInventorySheet)はここでは呼ばない——doPostは同期実行のため
    // ここで呼ぶと「棚卸完了」ボタンの応答がその処理時間分遅くなり、送信中の表示が長引く原因になった
    // (2026-07-28、ユーザー指摘で発覚)。代わりにindex.html側(_submitInventoryInner)がこの保存の
    // 成功後に別リクエストとして(結果を待たずに)呼び出す形にした
  }
  // inventory_logの内容が変わったため、getInventoryHistory/buildStoreInventorySheet等が使う
  // キャッシュを無効化する(2026-08-01追加)。これを忘れると、直後にbuildStoreInventorySheetが
  // 別リクエストとして走った際に25秒以内は古いデータのままになってしまう
  _invalidateInventoryLogCache_();
  return { ok: true };
}

// inventory_logの既存データ(saveInventorySnapshotのL列結合対応より前に書かれた行)に遡って
// 備考(remarks)列の結合を適用するワンショット移行用。店舗ID+期間が連続する行をひとまとまりの
// ブロックとみなして結合する(inventory_logは店舗×期間ごとに連続して書き込まれる運用のため、
// 通常は連続しているはずだが、手動並び替え等で連続性が崩れている場合はブロックが分断されうる)。
// ?action=mergeInventoryLogRemarksBlocks で実行、何度でも安全に再実行可(既存の結合はunmerge
// してから組み直す)。
function mergeInventoryLogRemarksBlocks() {
  const sheet = getInventorySheet();
  if (sheet.getLastRow() <= 1) return { ok: true, merged: 0 };
  const remarksCol = INVENTORY_COLS.indexOf('remarks') + 1;
  const sidIdx = INVENTORY_COLS.indexOf('store_id'), pidIdx = INVENTORY_COLS.indexOf('period_label');
  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(2, 1, lastRow - 1, INVENTORY_COLS.length).getValues();

  sheet.getRange(2, remarksCol, lastRow - 1, 1).breakApart(); // 既存の結合を一旦解除してから組み直す

  let merged = 0;
  let blockStart = 0;
  const keyOf = i => `${values[i][sidIdx]} ${_invMonthLabelStr(values[i][pidIdx])}`;
  for (let i = 1; i <= values.length; i++) {
    if (i === values.length || keyOf(i) !== keyOf(blockStart)) {
      const blockLen = i - blockStart;
      if (blockLen > 1) {
        sheet.getRange(2 + blockStart, remarksCol, blockLen, 1).setVerticalAlignment('middle').merge();
        merged++;
      }
      blockStart = i;
    }
  }
  return { ok: true, merged };
}

// ----------------------------------------------------------------
// inventory_delivery_auto（発注タブの「納品済み」から自動集計する当月納品）
// ----------------------------------------------------------------
// saveInventorySnapshotのような全件削除→再送信ではなく、追記のみのログにする。
// 複数店舗・端末から同時に「納品済み」が押されても、他の記録を消してしまう事故が起きない。
// 同じ棚卸集計スプレッドシート（INVENTORY_SHEET_ID）内に新規シートとして持つ
const SHEET_DELIVERY_AUTO  = 'inventory_delivery_auto';
const DELIVERY_AUTO_COLS   = ['period_label', 'store_id', 'product', 'qty', 'recorded_at'];

function getDeliveryAutoSheet() {
  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  return ss.getSheetByName(SHEET_DELIVERY_AUTO) || ss.insertSheet(SHEET_DELIVERY_AUTO);
}

function recordInventoryDelivery(storeId, periodLabel, product, qty) {
  const sheet = getDeliveryAutoSheet();
  ensureHeaders(sheet, DELIVERY_AUTO_COLS);
  const row = DELIVERY_AUTO_COLS.map(c => {
    if (c === 'period_label') return periodLabel;
    if (c === 'store_id')     return storeId;
    if (c === 'product')      return product;
    if (c === 'qty')          return qty;
    if (c === 'recorded_at')  return new Date().toISOString();
    return '';
  });
  const startRow = sheet.getLastRow() + 1;
  // period_labelが"YYYY-MM"のまま日付型に自動変換されないよう固定
  sheet.getRange(startRow, DELIVERY_AUTO_COLS.indexOf('period_label') + 1, 1, 1).setNumberFormat('@');
  sheet.getRange(startRow, 1, 1, DELIVERY_AUTO_COLS.length).setValues([row]);
  return { ok: true };
}

// 店舗×期間の当月納品（自動）を商品名ごとに合計して返す
function getInventoryDeliveryAuto(storeId, periodLabel) {
  const sheet = getDeliveryAutoSheet();
  if (sheet.getLastRow() <= 1) return {};
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const pIdx = hdrs.indexOf('period_label'), sIdx = hdrs.indexOf('store_id'),
        prIdx = hdrs.indexOf('product'), qIdx = hdrs.indexOf('qty');
  const totals = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[sIdx]) !== String(storeId)) continue;
    if (_invMonthLabelStr(row[pIdx]) !== String(periodLabel)) continue;
    const product = row[prIdx];
    totals[product] = (totals[product] || 0) + Number(row[qIdx] || 0);
  }
  return totals;
}

// ----------------------------------------------------------------
// inventory_delivery_manual（月初納品分など、アプリを通さない納品を本部が手入力）
// ----------------------------------------------------------------
// 本部が直接編集する外部スプレッドシート。読み取りのみ（appは書き込まない）。
// 商品は「商品コード」列で持つ（商品名は表記ゆれの元になるため使わない）。
// 商品コード→商品名の変換は、商品設定画面で保存されている値（app_settingsシートの
// all_productsキー、JSON文字列）を正とする。ハードコードされたPRODUCTS配列は
// クライアント側にしかないため、GAS側では必ずこちらを見る
const SHEET_DELIVERY_MANUAL = '手動納品';
const DELIVERY_MANUAL_COLS  = ['期間ラベル', '店舗ID', '商品コード', '数量'];

function getDeliveryManualSheet() {
  const ss = SpreadsheetApp.openById(MANUAL_DELIVERY_SHEET_ID);
  return ss.getSheetByName(SHEET_DELIVERY_MANUAL) || ss.insertSheet(SHEET_DELIVERY_MANUAL);
}

let _cachedManualDeliveryTz = null;
function _manualDeliverySheetTz() {
  if (!_cachedManualDeliveryTz) _cachedManualDeliveryTz = SpreadsheetApp.openById(MANUAL_DELIVERY_SHEET_ID).getSpreadsheetTimeZone();
  return _cachedManualDeliveryTz;
}
function _manualDeliveryMonthLabelStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, _manualDeliverySheetTz(), 'yyyy-MM');
  return v || null;
}

function getProductCodeMap() {
  const entry = getSettings().find(s => s.key === 'all_products');
  if (!entry || !entry.value) return {};
  let products;
  try { products = JSON.parse(entry.value); } catch (e) { return {}; }
  const map = {};
  products.forEach(p => { if (p.code) map[String(p.code)] = p.name; });
  return map;
}

// 店舗×期間の当月納品（手動）を商品名ごとに合計して返す。商品コードが商品設定の
// どれとも一致しない行はskippedへ積んで返す（サイレントに数量を捨てない）
function getInventoryDeliveryManual(storeId, periodLabel) {
  if (!MANUAL_DELIVERY_SHEET_ID) return { totals: {}, skipped: [] };
  const sheet = getDeliveryManualSheet();
  if (sheet.getLastRow() <= 1) return { totals: {}, skipped: [] };
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const pIdx = hdrs.indexOf('期間ラベル'), sIdx = hdrs.indexOf('店舗ID'),
        cIdx = hdrs.indexOf('商品コード'), qIdx = hdrs.indexOf('数量');
  const codeToName = getProductCodeMap();
  const totals = {};
  const skipped = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[sIdx]) !== String(storeId)) continue;
    if (_manualDeliveryMonthLabelStr(row[pIdx]) !== String(periodLabel)) continue;
    const code = String(row[cIdx]);
    const name = codeToName[code];
    if (!name) { skipped.push({ sheetRow: i + 1, code: code, qty: row[qIdx] }); continue; }
    totals[name] = (totals[name] || 0) + Number(row[qIdx] || 0);
  }
  return { totals, skipped };
}

// 棚卸表タブを開いた時に必要な4種類の読み取り（前月履歴／当月納品自動／当月納品手動／
// チェックシート）を1回のHTTPリクエストにまとめる複合エンドポイント（2026-07-15追加）。
// クライアント側の並列fetch自体は既にPromise.allで並列化済みだったため、往復回数（＝
// Apps Script呼び出しごとの起動オーバーヘッド）を4回→1回に減らすことが主目的。
// 各データの絞り込み・集計ロジック自体は既存の各関数をそのまま呼ぶだけで変えていない。
// 4つを1つのtryでまとめて呼ぶと、INVENTORY_SHEET_ID/MANUAL_DELIVERY_SHEET_ID未設定など
// どれか1つが例外を投げただけで残り3つの正常なデータまで巻き添えでエラーになってしまう
// （統合前は4本の独立したリクエストだったため、1つの失敗が他に影響しなかった）。
// それぞれ個別にtry/catchし、失敗した項目だけ空データ＋エラーメッセージを返す
function getInventoryTabData(storeId, periodLabel, prevPeriodLabel) {
  const result = { history: [], deliveryAuto: {}, deliveryManual: { totals: {}, skipped: [] }, checksheet: [] };
  try { result.history = getInventoryHistory(storeId, prevPeriodLabel); }
  catch (e) { result.historyError = e.message; }
  try { result.deliveryAuto = getInventoryDeliveryAuto(storeId, periodLabel); }
  catch (e) { result.deliveryAutoError = e.message; }
  try { result.deliveryManual = getInventoryDeliveryManual(storeId, periodLabel); }
  catch (e) { result.deliveryManualError = e.message; }
  try { result.checksheet = getChecksheetData(storeId); }
  catch (e) { result.checksheetError = e.message; }
  return result;
}

// label列(E列)の削除ワンショット移行。2026-07-28、product列(D列)と常に同値で重複していたため統合した。
// migrateInventoryColumns(見出しの日本語化・末尾列追加)より必ず先に実行すること——先に見出しだけ日本語化
// すると列数の食い違いで整合性が崩れる。何度実行しても5列目が既にlabel/表示名でなければ何もしない安全設計。
// ?action=removeInventoryLabelColumn で実行。
function removeInventoryLabelColumn() {
  const sheet = getInventorySheet();
  if (sheet.getLastRow() === 0) return { ok: true, removed: false, reason: 'シートが空です' };
  const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const labelColIdx1based = 5; // period_label,store_id,code,product,label の5列目
  const headerAtCol5 = hdrs[labelColIdx1based - 1];
  if (headerAtCol5 !== 'label' && headerAtCol5 !== '表示名') {
    return { ok: true, removed: false, reason: `5列目のヘッダーが${JSON.stringify(headerAtCol5)}でlabel列ではないため、既に削除済みか想定外の状態です` };
  }
  sheet.deleteColumn(labelColIdx1based);
  _invalidateInventoryLogCache_();
  return { ok: true, removed: true };
}

// INVENTORY_COLSに新規列（anomaly_note、daily_count/matchedなど）を追加した際のワンショット移行用。
// ensureHeadersは空シートにしか列を作らないため、既存の運用中「棚卸集計」シートには手動で一度叩く必要がある
// （migrateOrderColumnsと同じパターン。既存データには一切触れない、何度実行しても安全。
// INVENTORY_COLSとの差分(末尾に足りない列)を見て不足分だけ足すので、今後列を追加してもこの関数自体は
// 変更不要。列位置はINVENTORY_COLSの宣言順を正としているため、不足分は必ず末尾に追加する。
// 2026-07-28、見出しテキストを日本語(INVENTORY_HEADERS_JA)に統一する処理も兼ねる——既存の英語見出しの
// シートに対して実行すると、既存列の見出しも含めて全て日本語に上書きされる（データ行には触れない））
function migrateInventoryColumns() {
  const sheet = getInventorySheet();
  if (sheet.getLastRow() === 0) { ensureHeaders(sheet, INVENTORY_HEADERS_JA); return { ok: true, added: INVENTORY_COLS }; }
  const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const missing = INVENTORY_COLS.slice(hdrs.length);
  if (missing.length) {
    const missingHeadersJa = INVENTORY_HEADERS_JA.slice(hdrs.length);
    sheet.getRange(1, hdrs.length + 1, 1, missingHeadersJa.length).setValues([missingHeadersJa]);
  }
  // 既存分の見出しテキストも(英語のままなら)日本語に揃える
  sheet.getRange(1, 1, 1, hdrs.length).setValues([INVENTORY_HEADERS_JA.slice(0, hdrs.length)]);
  _invalidateInventoryLogCache_();
  return { ok: true, added: missing };
}

// 処分数量(disposed_qty)が入力されている行をスプレッドシート上で目立たせる条件付き書式を設定する。
// 範囲ベースのルールとして設定するため一度実行すればよく、以降saveInventorySnapshotが行を
// 削除・追記してもルールは自動的に効き続ける（migrateInventoryColumnsと同じ「一度だけ叩く」運用）。
// ?action=setupInventoryDisposedHighlight で実行する。migrateInventoryColumnsで
// disposed_qty列を追加済みであること（列が無ければエラーを返す）。
function setupInventoryDisposedHighlight() {
  const sheet = getInventorySheet();
  const colCount = Math.max(sheet.getLastColumn(), INVENTORY_COLS.length);
  const colIdx = INVENTORY_COLS.indexOf('disposed_qty'); // 列位置はINVENTORY_COLSの宣言順が正(見出しテキストには依存しない)
  if (colIdx < 0) return { error: 'disposed_qty列が見つかりません。先にmigrateInventoryColumnsを実行してください' };
  const colLetter = String.fromCharCode(65 + colIdx);
  const numRows = 5000; // 想定データ行数に余裕を持たせた固定値（将来これを超える見込みなら数値を増やして再実行）
  const range = sheet.getRange(2, 1, numRows, colCount);
  const formula = '=$' + colLetter + '2>0';

  // 同じ条件のルールが既にあれば入れ替え、無関係な既存ルールはそのまま残す
  const rules = sheet.getConditionalFormatRules().filter(r => {
    const c = r.getBooleanCondition();
    return !(c && c.getCriteriaType() === SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA && c.getCriteriaValues()[0] === formula);
  });
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula)
      .setBackground('#ffe0b2')
      .setRanges([range])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
  return { ok: true, column: colLetter, rows: numRows };
}

// ----------------------------------------------------------------
// 全店舗棚卸集計（ロールアップ）2026-07-25追加。
// ユーザー要望：各パートナーが棚卸で入力したデータを集計して全店分の棚卸表にしたい
// （売上ではなく在庫管理の観点）。ロールモデルとして見せられた既存の手動集計シートは
// 店舗ごとにブロックをコピーする構成で結合セル・空行・不要な列が多く整理されていなかったため、
// 店舗を列ではなく行として並べる「縦持ち（tidy）」な表にする——Sheets標準のフィルタ/ピボットを
// 使って自由に絞り込める形にする狙い。migrateInventoryColumns等と同じ「呼ばれる度に作り直す」
// ワンショット関数（?action=buildInventoryRollup&periodLabel=2026-07で実行）。
// ----------------------------------------------------------------
const SHEET_INVENTORY_ROLLUP = '全店舗棚卸集計';
const SHEET_INVENTORY_MISSING = '棚卸未提出店舗';
const INVENTORY_ROLLUP_COLS = ['period_label','store_type','store_name','store_id','product_code','product','open_stock','delivery','end_stock','consumption','disposed_qty','low_stock'];
// シート上の見出し表示専用（英語キーのINVENTORY_ROLLUP_COLSとは順序を揃えるだけの対応関係）。
// 内部の列参照(indexOf等)は引き続き上のCOLSキーで行い、書き込み時の1行目だけこちらに差し替える
const INVENTORY_ROLLUP_HEADERS_JA = ['期間','店舗区分','店舗名','店舗ID','商品コード','商品名','期首在庫','当月納品','期末在庫','消費量','処分数量','在庫僅少'];
const INVENTORY_MISSING_HEADERS_JA = ['期間','店舗ID','店舗名'];

// 全店舗ID一覧（stores.js＋custom_stores、deleted_storesを除外）。「棚卸未提出店舗」の
// 判定に必要——inventory_logは提出があった店舗の行しか持たないため、提出そのものが
// 無い店舗を見つけるには別途「本来存在するはずの店舗一覧」が要る
function _allStoreIds_() {
  const names = _storeNames_();
  const ids = Object.keys(names);
  try {
    const raw = (getSettings().find(s => s.key === 'custom_stores') || {}).value;
    const custom = raw ? JSON.parse(raw) : {};
    Object.keys(custom).forEach(id => { if (ids.indexOf(id) < 0) ids.push(id); });
  } catch (e) { /* custom_stores未設定・パース失敗時はstores.js分のみで続行 */ }
  try {
    const raw = (getSettings().find(s => s.key === 'deleted_stores') || {}).value;
    const deleted = raw ? JSON.parse(raw) : [];
    deleted.forEach(id => { const i = ids.indexOf(id); if (i >= 0) ids.splice(i, 1); });
  } catch (e) { /* deleted_stores未設定・パース失敗時は除外なしで続行 */ }
  return ids;
}

// 商品名→{caseOnly, casePieces}のマップ。「ケース単価の物は残り1ケース以下で少ない」判定用に
// 商品設定(all_products)のcaseUnit文字列（例:"1ケース/25袋"）から個数だけを抜き出す
// （当月納品(手動)機能のcasePiecesFromUnitと同じ発想、GAS側には無かったので同等ロジックを複製）
function _productCaseInfo_() {
  const map = {};
  const entry = getSettings().find(s => s.key === 'all_products');
  if (!entry || !entry.value) return map;
  let products;
  try { products = JSON.parse(entry.value); } catch (e) { return map; }
  products.forEach(p => {
    if (!p.name) return;
    let casePieces = null;
    if (p.caseUnit) {
      const m = String(p.caseUnit).match(/\d+/);
      if (m) casePieces = Number(m[0]);
    }
    map[p.name] = { caseOnly: !!p.caseOnly, casePieces: casePieces };
  });
  return map;
}

// inventory_delivery_auto（納品済みボタン押下のたびrecordInventoryDeliveryが追記するログ）を
// 指定期間について店舗×商品で合計する。inventory_logのdelivery列は棚卸完了送信時点の
// スナップショットで古くなりうるため、ロールアップでは常にこちらの生ログから集計し直す
// （ユーザー要望：「納品済みボタン押されたら自動的にこのシート側で納品カウントもする」に対応）
function _deliveryAutoTotalsForPeriod_(periodLabel) {
  const sheet = getDeliveryAutoSheet();
  const totals = {};
  if (sheet.getLastRow() <= 1) return totals;
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const pIdx = hdrs.indexOf('period_label'), sIdx = hdrs.indexOf('store_id'),
        prIdx = hdrs.indexOf('product'), qIdx = hdrs.indexOf('qty');
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (_invMonthLabelStr(row[pIdx]) !== String(periodLabel)) continue;
    const sid = String(row[sIdx]), prod = String(row[prIdx]);
    if (!totals[sid]) totals[sid] = {};
    totals[sid][prod] = (totals[sid][prod] || 0) + Number(row[qIdx] || 0);
  }
  return totals;
}

function buildInventoryRollup(periodLabel) {
  if (!periodLabel) return { error: 'periodLabelは必須です（例: 2026-07）' };
  const data = _inventoryLogRowsCached_();
  const hasData = data.length > 1;
  const idx = {};
  // 列位置はヘッダーの表示テキスト(日本語)ではなく、INVENTORY_COLSの宣言順を正として読む
  INVENTORY_COLS.forEach((c, i) => { idx[c] = i; });

  const storeNames = _storeNames_();
  const deliveryTotals = _deliveryAutoTotalsForPeriod_(periodLabel);
  const caseInfo = _productCaseInfo_();

  const submitted = {};
  const outRows = [];
  if (hasData) {
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (_invMonthLabelStr(r[idx.period_label]) !== String(periodLabel)) continue;
      const storeId = String(r[idx.store_id]);
      submitted[storeId] = true;
      const product = r[idx.product];
      const endStock = r[idx.end_stock];
      const liveDelivery = (deliveryTotals[storeId] && deliveryTotals[storeId][product]) || 0;
      const info = caseInfo[product] || {};
      const low = !!(info.caseOnly && info.casePieces && endStock !== '' && endStock !== null && Number(endStock) <= info.casePieces);
      outRows.push([
        periodLabel,
        _isFcStore_(storeId) ? 'FC' : '直営',
        storeNames[storeId] || storeId,
        storeId,
        r[idx.code],
        product,
        r[idx.open_stock],
        liveDelivery,
        endStock,
        r[idx.consumption],
        r[idx.disposed_qty],
        low ? '要確認' : ''
      ]);
    }
  }

  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_INVENTORY_ROLLUP) || ss.insertSheet(SHEET_INVENTORY_ROLLUP);
  sheet.clearContents();
  sheet.clearConditionalFormatRules();
  sheet.getRange(1, 1, 1, INVENTORY_ROLLUP_COLS.length).setValues([INVENTORY_ROLLUP_HEADERS_JA]);
  if (outRows.length) {
    sheet.getRange(2, 1, outRows.length, INVENTORY_ROLLUP_COLS.length).setValues(outRows);
    const lowColIdx = INVENTORY_ROLLUP_COLS.indexOf('low_stock') + 1;
    const lowColLetter = String.fromCharCode(64 + lowColIdx);
    const range = sheet.getRange(2, 1, outRows.length, INVENTORY_ROLLUP_COLS.length);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + lowColLetter + '2="要確認"')
        .setBackground('#ffcdd2')
        .setRanges([range])
        .build()
    ]);
  }

  const allIds = _allStoreIds_();
  const missing = allIds.filter(id => !submitted[id]);
  const missingSheet = ss.getSheetByName(SHEET_INVENTORY_MISSING) || ss.insertSheet(SHEET_INVENTORY_MISSING);
  missingSheet.clearContents();
  missingSheet.getRange(1, 1, 1, 3).setValues([INVENTORY_MISSING_HEADERS_JA]);
  if (missing.length) {
    missingSheet.getRange(2, 1, missing.length, 3).setValues(missing.map(id => [periodLabel, id, storeNames[id] || id]));
  }

  return { ok: true, rows: outRows.length, missingStores: missing.length };
}

// 店舗タブ(buildStoreInventorySheet)の期間列は表示専用のプレーンテキストとして「2026年6月」のような
// 日本語表記で持つ（日付型セルにはしない——inventory_log等で繰り返し問題になってきた自動日付変換・
// タイムゾームずれを避けるため）。"2026-06" -> "2026年6月"
function _periodLabelJa_(periodLabel) {
  const [y, m] = String(periodLabel).split('-').map(Number);
  return `${y}年${m}月`;
}

// 商品名 -> {vendor, order, caseOnly, casePieces} のマップ。all_products設定(PRODUCTS配列のJSON)を
// 1回だけパースし、buildStoreInventorySheetで使う商品分類(vendor)・並び順(order)・ケース単位情報を
// まとめて引けるようにする（_productCaseInfo_と同じ発想だが、こちらはvendor/orderも持つ拡張版）
function _productMeta_() {
  const map = {};
  const entry = getSettings().find(s => s.key === 'all_products');
  if (!entry || !entry.value) return map;
  let products;
  try { products = JSON.parse(entry.value); } catch (e) { return map; }
  products.forEach((p, i) => {
    if (!p.name) return;
    let casePieces = null;
    if (p.caseUnit) {
      const m = String(p.caseUnit).match(/\d+/);
      if (m) casePieces = Number(m[0]);
    }
    map[p.name] = { vendor: p.vendor || '', order: i, caseOnly: !!p.caseOnly, casePieces: casePieces };
  });
  return map;
}

// 2026-07-28、デイリーカウント・差異列を追加(ユーザーが先に手動でデイリーカウント列を渋谷神南タブに
// 追加していたため、それに揃える形でコードを更新)。ヘッダー行は毎回書き直す(下記参照)ため、
// 手動で追加された列があっても次の実行でこの並び順に揃い直す
// 単価(price)は末尾に追加(2026-08-01、ユーザーから「関数が無いと計算根拠が分からない」と指摘を受け、
// 期首在庫額等をこの単価セルを参照する実際のスプレッドシート数式に変更した際に追加)。
// 新規列は必ず末尾に追加する既存ルールに従う(途中に挿入すると過去期間の既存データ行が列ズレする)。
// 2026-08-01、ユーザーがシート上で単価をD列付近へ手動移動 → 最終的に「単価はD列に固定してほしい」と
// 指示を受け、コード側の並び順もD列(4番目)に変更した。列数は変わらず16列のまま(A〜P)なので、
// この後ろに続くステラ関連ブロック(STOCK_CHECK_START_COL等)の列位置には影響しない。
const STORE_INVENTORY_COLS = ['period_label','code','product','price','opening_amount','closing_amount','consumption_amount','cost_rate','open_stock','end_stock','delivery','consumption','disposed_qty','daily_count','count_diff','low_stock'];
const STORE_INVENTORY_HEADERS_JA = ['期間','商品コード','商品名','単価','期首在庫額','期末在庫額','月消費額','原価率','期首在庫','期末在庫','当月納品','消費量','処分数量','デイリーカウント','差異(消費量-デイリーカウント)','在庫僅少'];
// 列名→列文字(A,B,C...)の変換ヘルパー。STORE_INVENTORY_COLSの並び順を単一の情報源として、
// 数式内のセル参照(例:$P2)を組み立てる際に使う——列順を変える場合はSTORE_INVENTORY_COLSを直すだけでよい
function _storeInvColLetter_(name) {
  return String.fromCharCode(64 + STORE_INVENTORY_COLS.indexOf(name) + 1);
}

// 店舗単体の棚卸表シート（店舗の表示名タブ、例:「渋谷神南」）を1店舗分だけ生成・更新するワンショット関数。
// ?action=buildStoreInventorySheet&storeId=shibuya&periodLabel=2026-07 で実行。
// 全店舗棚卸集計(buildInventoryRollup)と違い、このシートは月をまたいで蓄積していく想定のため、
// 毎回全消しはせず「対象期間の行だけ削除してから末尾に追記」する。全店舗への展開は
// 「渋谷神南」タブでの動作確認後に別途行う（2026-07-28時点ではこの1店舗のみ対応）。
//
// 棚卸表対象外の「その他」商品名を除く全商品について、期首在庫額(今期の期首在庫×今期の単価)/
// 期末在庫額(今期の期末在庫×今期の単価)/月消費額(期首−期末)/原価率(月消費額÷期首在庫額、実質は
// 在庫消費率であって売上ベースの真の原価率ではない点に注意)の金額4列を計算する。期首在庫・期末在庫の
// いずれかが未入力(初月・記入漏れ等)の場合や期首在庫額が0の場合は該当列を空欄にする(0除算回避)。
// 2026-07-28、前期のinventory_log保存済みamountに依存する方式から変更——前期が単価0円等の不完全な
// データだと今期の期首在庫額まで計算不能になる問題があったため、この行(今期分)だけで自己完結して
// 計算する方式にした。前期と単価が変わっていた場合の historical accuracy は失うが、常に計算できる
// ことを優先する。
// 2026-07-28、対象をvendor:'other'限定から全vendorに拡大した——単価(仕入原価)×在庫数量という
// 計算自体はエリア別販売価格と無関係で、アペックス/トーヨーでも問題なく出せるとユーザー指摘で判明
// (エリア別価格が問題になるのは売上ベースの真の原価率(buildSalesCategoryCostRatio側)の話であり、
// この在庫消費率とは無関係)。
function buildStoreInventorySheet(storeId, periodLabel) {
  if (!storeId) return { error: 'storeIdは必須です' };
  if (!periodLabel) return { error: 'periodLabelは必須です（例: 2026-07）' };

  const data = _inventoryLogRowsCached_();
  if (data.length <= 1) return { error: '棚卸データがまだありません' };
  const idx = {};
  // 列位置はヘッダーの表示テキスト(日本語)ではなく、INVENTORY_COLSの宣言順を正として読む
  INVENTORY_COLS.forEach((c, i) => { idx[c] = i; });

  const deliveryTotals = (_deliveryAutoTotalsForPeriod_(periodLabel)[storeId]) || {};
  const meta = _productMeta_();

  const curRows = {}; // product -> この期間の行
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (String(r[idx.store_id]) !== String(storeId)) continue;
    if (_invMonthLabelStr(r[idx.period_label]) === String(periodLabel)) curRows[r[idx.product]] = r;
  }

  const products = Object.keys(curRows);
  if (!products.length) return { error: `${storeId}の${periodLabel}分の棚卸データが見つかりません` };
  products.sort((a, b) => ((meta[a] && meta[a].order) || 0) - ((meta[b] && meta[b].order) || 0));

  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  const sheetName = _storeNames_()[storeId] || storeId;
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  // エリア別の色分け・正準な並び順(新しい店舗ほど後ろ)への反映(2026-08-01追加)。
  // このシートが今回新規作成された場合も含め、毎回のbuildStoreInventorySheet実行時に揃え直す
  _applyStoreTabOrderAndColors_(ss);
  // 見出し行は毎回書き直す(空シートの時だけでなく)。手動で列を挿入された場合等、コード側の
  // 正しい並びに毎回揃え直す狙い——データ行は期間ブロック単位でしか書き直さないため、
  // 見出しだけこの実行のたびに同期しておかないと、コードとシートの列がずれたままになる
  sheet.getRange(1, 1, 1, STORE_INVENTORY_HEADERS_JA.length).setValues([STORE_INVENTORY_HEADERS_JA]);

  // 店舗タブは月をまたいで蓄積していく想定のため、全店舗棚卸集計のような毎回全消し方式ではなく、
  // 対象期間の行(同じ期間で再実行した場合の重複)だけ削除してから最新版を末尾に追記する。
  // 期間列は同一期間ブロック内でmerge()して見た目だけ結合しているため、ブロック2行目以降は
  // 列A自体が空になる——非空行を新しいブロックの開始とみなし、続く空欄行を同じブロックとして束ねる
  const existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  const periodLabelJa = _periodLabelJa_(periodLabel);
  const blocks = []; // { periodText, startIdx, endIdx }(existing配列上の0-based index、両端含む)
  existing.forEach((row, i) => {
    const raw = row[0];
    if (raw !== '' && raw !== null) {
      // 2026-07-28にA列をプレーンテキスト("2026年6月")化する前は、"2026-06"という文字列がSheetsに
      // 日付型セルへ自動変換されてしまっていた行が残っている可能性がある(_invSheetTzと同じ問題)。
      // Date型ならyyyy-MM文字列に戻してから比較し、新旧どちらの表記のブロックも確実に一致させる
      const periodText = raw instanceof Date ? Utilities.formatDate(raw, _invSheetTz(), 'yyyy-MM') : String(raw);
      blocks.push({ periodText, startIdx: i, endIdx: i });
    } else if (blocks.length) {
      blocks[blocks.length - 1].endIdx = i;
    }
  });
  blocks
    .filter(b => b.periodText === periodLabelJa || b.periodText === String(periodLabel))
    .sort((a, b) => b.startIdx - a.startIdx) // 末尾側から消して行番号ズレを避ける
    .forEach(b => sheet.deleteRows(b.startIdx + 2, b.endIdx - b.startIdx + 1));

  // 期首在庫額等を実セル参照の数式にするため、書き込み先の絶対行番号を先に確定させる
  // (削除処理より後で確定させないと、数式が指す行番号が実際の書き込み位置とズレる)
  const startRow = sheet.getLastRow() + 1;
  const colOpening = _storeInvColLetter_('opening_amount');
  const colClosing = _storeInvColLetter_('closing_amount');
  const colConsumption = _storeInvColLetter_('consumption_amount');
  const colOpenStock = _storeInvColLetter_('open_stock');
  const colEndStock = _storeInvColLetter_('end_stock');
  const colPrice = _storeInvColLetter_('price');

  const outRows = products.map((product, i) => {
    const r = curRows[product];
    const info = meta[product] || {};
    const endStock = r[idx.end_stock];
    const liveDelivery = deliveryTotals[product] || 0;
    const low = !!(info.caseOnly && info.casePieces && endStock !== '' && endStock !== null && Number(endStock) <= info.casePieces);
    const price = Number(r[idx.price]) || 0;
    const rowNum = startRow + i;

    // 期首在庫額・期末在庫額・月消費額・原価率は、単価列($P列)と期首在庫/期末在庫列を参照する
    // 実際のスプレッドシート数式として書き込む(2026-08-01、ユーザーから「関数が無いと計算根拠が
    // セルを見ても分からない」と指摘を受け、単価をこのシートにも列として出した上で数式化した)。
    // 「その他」商品は元々単価の概念が無いため、これまで通り空欄のまま(数式にしない)。
    // 期首在庫/期末在庫セル自体が空欄(初月・記入漏れ等)の場合はIF()で空文字を返し、0除算も回避する。
    let openingAmount = '', closingAmount = '', consumptionAmount = '', costRate = '';
    if (product !== 'その他') {
      openingAmount = `=IF($${colOpenStock}${rowNum}="","",$${colPrice}${rowNum}*$${colOpenStock}${rowNum})`;
      closingAmount = `=IF($${colEndStock}${rowNum}="","",$${colPrice}${rowNum}*$${colEndStock}${rowNum})`;
      consumptionAmount = `=IF(OR($${colOpening}${rowNum}="",$${colClosing}${rowNum}=""),"",$${colOpening}${rowNum}-$${colClosing}${rowNum})`;
      costRate = `=IF(OR($${colOpening}${rowNum}="",$${colOpening}${rowNum}=0),"",$${colConsumption}${rowNum}/$${colOpening}${rowNum})`;
    }

    const dailyCount = r[idx.daily_count];
    const consumption = r[idx.consumption];
    // 差異=消費量(棚卸ベース)-デイリーカウント(チェックシート補充ベース)。既存の
    // 「消費量とデイリーカウントが一致しない」という参考表示(mismatch)の数値版
    const countDiff = (consumption !== '' && consumption !== null && dailyCount !== '' && dailyCount !== null)
      ? Number(consumption) - Number(dailyCount) : '';

    return [
      _periodLabelJa_(periodLabel), r[idx.code], product,
      price,
      openingAmount, closingAmount, consumptionAmount, costRate,
      r[idx.open_stock], endStock, liveDelivery, consumption, r[idx.disposed_qty],
      dailyCount, countDiff,
      low ? '要確認' : ''
    ];
  });

  // 日付型への自動変換を防ぐため、書き込み前に必ずプレーンテキスト形式に固定する
  sheet.getRange(startRow, 1, outRows.length, 1).setNumberFormat('@');
  sheet.getRange(startRow, 1, outRows.length, STORE_INVENTORY_COLS.length).setValues(outRows);
  // 期間列はこのブロック内で同じ値が続くため、見た目だけ縦結合する（このシートはbuildStoreInventorySheetが
  // 都度作り直すレポート専用タブであり、他の処理がここを期間列で読み返すことは無いため結合して問題ない）。
  // 結合セルは既定だと下揃えになるため、中央揃え(横・縦とも)にする
  const periodRange = sheet.getRange(startRow, 1, outRows.length, 1);
  periodRange.setHorizontalAlignment('center').setVerticalAlignment('middle');
  if (outRows.length > 1) periodRange.merge();
  const rateCol = STORE_INVENTORY_COLS.indexOf('cost_rate') + 1;
  sheet.getRange(startRow, rateCol, outRows.length, 1).setNumberFormat('0.0%');
  ['opening_amount', 'closing_amount', 'consumption_amount', 'price'].forEach(c => {
    sheet.getRange(startRow, STORE_INVENTORY_COLS.indexOf(c) + 1, outRows.length, 1).setNumberFormat(INVOICE_YEN_FORMAT);
  });

  return { ok: true, store: sheetName, period: periodLabel, rows: outRows.length };
}

// ----------------------------------------------------------------
// 販売品類(vendor:'sales')の原価率(ステラスマートワン実売上ベース) 2026-07-28
// ----------------------------------------------------------------
// vendor:'other'向けの在庫消費率(期首在庫額ベースの疑似指標、buildStoreInventorySheet本体)とは
// 別物の指標——ここは実売上に対する真の原価率なので、意味を混同しないよう別ブロックとして出力する。
// ステラの商品コード(STE0xx)⇔PRODUCTS配列の名寄せ表(2026-07-28、実CSV2件・67件と3855件から確定、
// ユーザー確認済み。詳細は[[reference_stera_smart_one_api]]メモ参照)。商品コード列が空の行があるため
// 商品ID(prd_xxxxxxxx)を主キーにする。レディーボーデン各種・プリングルス各種はステラ側が味を
// 区別しないため、当方の複数商品(ourProducts)をグループとして合算比較する。
// 対象外(このマッピングに無いステラ商品コードは想定内・エラーではない): STE003ポコテインアイス
// (天満店限定、PRODUCTSに存在しない)、STE009 GABAチョコ(取り扱い終了)、tokai_snack(東海限定、
// そもそもステラ管理外)
const STERA_SALES_MAPPING = [
  { prdId: 'prd_223df30ea1f511d1df19c6c', label: '水', ourProducts: ['水'] },
  { prdId: 'prd_12fd82ee35d41bcef497baa', label: 'レディーボーデン各種', ourProducts: ['アイス　チョコ　レディーボーデン', 'アイス　バニラ　レディーボーデン', 'アイス　プレミアムミルク　レディーボーデン', 'アイス　クッキーアンドクリーム　レディーボーデン'] },
  { prdId: 'prd_535430d421048c6d58de73e', label: 'プリングルス各種', ourProducts: ['プリングルス', 'プリングルス　チーズ', 'プリングルス　サワークリーム＆オニオン'] },
  { prdId: 'prd_db5c32edaf3cba6889315ce', label: 'プチシリーズ', ourProducts: ['プチシリーズ'] },
  { prdId: 'prd_e5beda23225e76774172fe8', label: 'ソイジョイ', ourProducts: ['ソイジョイ'] },
  { prdId: 'prd_57998f0bdebf586bcd3e51c', label: '大粒ラムネ', ourProducts: ['大粒ラムネ'] },
  { prdId: 'prd_7603e1635070498fefa4a85', label: '果汁グミ', ourProducts: ['果汁グミ'] },
  { prdId: 'prd_ea6c0ebc5bf327d051ad172', label: 'クランキーアーモンドチョコレート', ourProducts: ['クランキーアーモンドチョコレートプチパック'] },
];
const SHEET_STERA_ORDERS = 'ステラ注文詳細'; // ユーザーが注文詳細CSVを手動インポートするタブ(File>インポート)
const STERA_ORDER_HEADERS = ['注文番号', '店舗名', '店舗番号', '支払金額', '返金金額', '決済方法', '端末名', 'ステータス', '作成日時', '支払日時', '最終返金日時', '商品ID', '商品コード', '商品名（日本語）', 'カテゴリ名', 'オプション', '商品価格', '原価', '商品価格(割引後)', '商品数量', '商品合計金額', '商品割引合計', 'タイプ', '発生日時'];

// 動作確認用: 手動でのFile>インポートの代わりに、注文詳細CSVのテキストをそのままPOSTして
// 「ステラ注文詳細」タブへ書き込む(将来Playwright自動化に置き換える前提の暫定手段)。
// 既存内容は毎回全消し→書き直し(このタブは生データの置き場でしかないため)。
function importSteraOrdersCsv(csvText) {
  const rows = Utilities.parseCsv(csvText);
  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_STERA_ORDERS) || ss.insertSheet(SHEET_STERA_ORDERS);
  sheet.clearContents();
  // 日付・日時に見える列("2026-07-01 12:44:56"等)をSheetsが自動で日付型セルに変換してしまうため、
  // 書き込み前にプレーンテキスト形式へ固定する(inventory_log等で繰り返し起きてきたのと同じ問題)
  const dateLikeCols = ['作成日時', '支払日時', '最終返金日時', '発生日時'].map(h => rows[0].indexOf(h) + 1).filter(c => c > 0);
  dateLikeCols.forEach(c => sheet.getRange(1, c, rows.length, 1).setNumberFormat('@'));
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  return { ok: true, rows: rows.length - 1 };
}

// storeId+periodLabelについて、ステラ「ステラ注文詳細」タブの実売上とinventory_logの消費額(原価)を
// 商品ID単位(グループはourProducts合算)で突き合わせ、販売品類の原価率を計算してstoreシートに書き込む。
// ?action=buildSalesCategoryCostRatio&storeId=shibuya&periodLabel=2026-07 で実行。
function buildSalesCategoryCostRatio(storeId, periodLabel) {
  if (!storeId) return { error: 'storeIdは必須です' };
  if (!periodLabel) return { error: 'periodLabelは必須です（例: 2026-07）' };

  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  const ordersSheet = ss.getSheetByName(SHEET_STERA_ORDERS);
  if (!ordersSheet) return { error: `「${SHEET_STERA_ORDERS}」タブが見つかりません。ステラの注文詳細CSVを手動インポートしてください` };
  const ordersData = ordersSheet.getDataRange().getValues();
  const ordersHdrs = ordersData[0].map(String);
  const oIdx = {};
  STERA_ORDER_HEADERS.forEach(h => { oIdx[h] = ordersHdrs.indexOf(h); });
  if (Object.values(oIdx).some(i => i < 0)) {
    return { error: `「${SHEET_STERA_ORDERS}」タブの列見出しが想定と異なります(注文詳細CSVそのままの見出しでインポートしてください)` };
  }

  const storeName = _storeNames_()[storeId] || storeId;
  // ステラの店舗名は「セルフカフェ」接頭辞・「店」接尾辞の付き方が店舗によって不統一
  // (例: 当方「渋谷神南」⇔ステラ「渋谷神南店」、当方「ナディアパーク栄」⇔ステラ「ナディアパーク栄店」)。
  // 厳密な店舗名マッピング表はまだ無いため、両接頭辞・接尾辞を剥がした正規化文字列で比較する
  const normalizeStoreLabel = s => String(s).replace(/^セルフカフェ/, '').replace(/店$/, '');
  const storeNameNorm = normalizeStoreLabel(storeName);
  const revenueByPrdId = {}; // prd_id -> 商品合計金額の合計(この店舗・この期間)
  for (let i = 1; i < ordersData.length; i++) {
    const r = ordersData[i];
    if (normalizeStoreLabel(r[oIdx['店舗名']]) !== storeNameNorm) continue;
    const occurredAtRaw = r[oIdx['発生日時']];
    // CSVインポート時にSheetsが「発生日時」列を日付型セルへ自動変換することがある
    // (setValuesで書き込んだ直後は文字列でも、日付らしい文字列は自動的に日付型になる。
    // inventory_log等で繰り返し起きてきたのと同じ問題)。Date型ならyyyy-MM文字列に戻して比較する
    const occurredAt = occurredAtRaw instanceof Date ? Utilities.formatDate(occurredAtRaw, _invSheetTz(), 'yyyy-MM') : String(occurredAtRaw);
    if (!occurredAt.startsWith(periodLabel)) continue;
    const prdId = r[oIdx['商品ID']];
    revenueByPrdId[prdId] = (revenueByPrdId[prdId] || 0) + Number(r[oIdx['商品合計金額']] || 0);
  }

  const invData = _inventoryLogRowsCached_();
  const idx = {};
  INVENTORY_COLS.forEach((c, i) => { idx[c] = i; });
  const costByProduct = {}; // product名 -> price×consumption(この店舗・この期間の消費額=原価)
  invData.slice(1).forEach(r => {
    if (String(r[idx.store_id]) !== String(storeId)) return;
    if (_invMonthLabelStr(r[idx.period_label]) !== String(periodLabel)) return;
    const price = Number(r[idx.price]) || 0;
    const consumption = Number(r[idx.consumption]) || 0;
    costByProduct[r[idx.product]] = price * consumption;
  });

  const outRows = STERA_SALES_MAPPING.map(m => {
    const revenue = revenueByPrdId[m.prdId];
    const cost = m.ourProducts.reduce((sum, name) => sum + (costByProduct[name] || 0), 0);
    const hasCost = m.ourProducts.some(name => costByProduct[name] !== undefined);
    const rate = (revenue && hasCost) ? cost / revenue : '';
    return [m.label, hasCost ? cost : '', revenue === undefined ? '' : revenue, rate];
  });

  const sheetName = storeName;
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  const startCol = 16; // P列(既存のO列=在庫僅少より右に間隔を空ける。vendor:'other'の在庫消費率とは別集計)
  const headerRow = [`販売品類原価率(ステラ実売上ベース・${periodLabel})`, '消費額(原価)', 'ステラ売上', '原価率'];
  sheet.getRange(1, startCol, 1, headerRow.length).setValues([headerRow]);
  sheet.getRange(2, startCol, outRows.length, outRows[0].length).setValues(outRows);
  sheet.getRange(2, startCol + 1, outRows.length, 2).setNumberFormat(INVOICE_YEN_FORMAT);
  sheet.getRange(2, startCol + 3, outRows.length, 1).setNumberFormat('0.0%');

  return { ok: true, store: sheetName, period: periodLabel, rows: outRows.length };
}

// ----------------------------------------------------------------
// ステラ日次売上の蓄積(盗難検知機能の基盤) 2026-07-31
// ----------------------------------------------------------------
// 「ステラ注文詳細」タブ(SHEET_STERA_ORDERS)は原価率計算のため毎回まるごと上書きする使い捨て設計
// (importSteraOrdersCsv参照、ユーザー確認済み「見たい期間をカバーするCSVを都度まるごとインポート」)。
// 盗難検知機能ではチェックシートへの入力タイミングごとに「前回入力からの累積売上」を求める必要があり、
// そのためには日々の売上数量を上書きせずに蓄積し続けるシートが別途必要。混同を避けるため
// 明確に別タブ・別関数として持つ(ステラ注文詳細とは一切連動しない)。
const SHEET_STERA_DAILY = 'stera_daily_sales';
const STERA_DAILY_COLS = ['date', 'store_id', 'prd_id', 'qty'];

function getSteraDailySheet_() {
  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_STERA_DAILY) || ss.insertSheet(SHEET_STERA_DAILY);
  ensureHeaders(sheet, STERA_DAILY_COLS);
  return sheet;
}

// ステラCSVの「店舗名」(セルフカフェ接頭辞・店接尾辞の表記ゆれあり)→store_idの逆引き表。
// buildSalesCategoryCostRatioのnormalizeStoreLabelと同じ正規化ロジック(表記ゆれの対処自体は
// 1関数に共通化していないが、正規化のルール文字列は完全に同じものを複製している——どちらか
// を変更したら他方も変えること)
function _steraStoreNameToId_() {
  const normalize = s => String(s).replace(/^セルフカフェ/, '').replace(/店$/, '');
  const names = _storeNames_();
  const map = {};
  Object.keys(names).forEach(id => { map[normalize(names[id])] = id; });
  return map;
}

// Playwrightが取得した「注文詳細CSV」のテキストを、指定日(dateStr、"YYYY-MM-DD")分としてそのまま渡すと、
// 店舗×商品ID別の売上数量を集計してstera_daily_salesへ書き込む。CSVは全店舗分をまとめて含む前提
// (店舗名列で店舗を判定するだけなので、日付範囲は呼び出し側でその日1日分に絞ってダウンロードしてから渡すこと)。
// 同じdateStrの既存行があれば削除してから書き直す(取り直し・再送信に対応、他日の行には一切触れない)。
// ?action=importSteraDailySales(POST、{dateStr, csvText})で実行。
function importSteraDailySales(dateStr, csvText) {
  if (!dateStr) return { error: 'dateStrは必須です(例: 2026-07-30)' };
  const rows = Utilities.parseCsv(csvText);
  if (!rows.length) return { error: 'CSVが空です' };
  const hdrs = rows[0].map(String);
  const idx = {};
  STERA_ORDER_HEADERS.forEach(h => { idx[h] = hdrs.indexOf(h); });
  if (Object.values(idx).some(i => i < 0)) {
    return { error: '注文詳細CSVの列見出しが想定と異なります(そのままの見出しでインポートしてください)' };
  }
  const nameToId = _steraStoreNameToId_();
  const normalize = s => String(s).replace(/^セルフカフェ/, '').replace(/店$/, '');

  const totals = {}; // `${storeId}|${prdId}` -> qty合計
  const unmatchedStores = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[idx['商品ID']]) continue; // 商品コード/商品IDどちらも空の行(明細以外の空行等)は無視
    const storeNameRaw = r[idx['店舗名']];
    const storeId = nameToId[normalize(storeNameRaw)];
    if (!storeId) { unmatchedStores[storeNameRaw] = true; continue; }
    const prdId = r[idx['商品ID']];
    const qty = Number(r[idx['商品数量']] || 0);
    const key = storeId + '|' + prdId;
    totals[key] = (totals[key] || 0) + qty;
  }

  const sheet = getSteraDailySheet_();
  // 同じdateStrの既存行を全削除してから書き直す(取り直し対応、他日には一切触れない)
  if (sheet.getLastRow() > 1) {
    const values = sheet.getDataRange().getValues();
    const dIdx = STERA_DAILY_COLS.indexOf('date');
    const toDel = [];
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][dIdx]) === String(dateStr)) toDel.push(i + 1);
    }
    for (let i = toDel.length - 1; i >= 0; i--) sheet.deleteRow(toDel[i]);
  }

  const newRows = Object.keys(totals).map(key => {
    const parts = key.split('|');
    return [dateStr, parts[0], parts[1], totals[key]];
  });
  if (newRows.length) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, STERA_DAILY_COLS.indexOf('date') + 1, newRows.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 1, newRows.length, STERA_DAILY_COLS.length).setValues(newRows);
  }
  return { ok: true, date: dateStr, rows: newRows.length, unmatchedStores: Object.keys(unmatchedStores) };
}

// storeId×prdId(単一)について、(fromDateExclusive, toDateInclusive]の範囲でstera_daily_salesの
// qtyを合計する。日付はどちらも"YYYY-MM-DD"文字列(fromDateExclusiveはnull可=下限無し)。①②共通で使う。
// グループ(STERA_SALES_MAPPINGのourProducts)単位で合算したい場合は、そのグループのprdIdでこの関数を
// 呼ぶだけでよい(1グループ=1prdIdのマッピングのため、呼び出し側でのグループ内合算は不要)
function getSteraDailyTotal_(storeId, prdId, fromDateExclusive, toDateInclusive) {
  const rows = sheetRows(getSteraDailySheet_(), STERA_DAILY_COLS);
  let total = 0;
  rows.forEach(r => {
    if (String(r.store_id) !== String(storeId) || String(r.prd_id) !== String(prdId)) return;
    if (fromDateExclusive && String(r.date) <= fromDateExclusive) return;
    if (toDateInclusive && String(r.date) > toDateInclusive) return;
    total += Number(r.qty) || 0;
  });
  return total;
}

// ----------------------------------------------------------------
// 盗難検知①: チェックシート入力欄の「前回入力からの実売上」表示(読み取り専用) 2026-07-31
// ----------------------------------------------------------------
// STERA_SALES_MAPPINGに載っている商品(販売品類の一部)について、グループ(ourProducts)内のどれかの
// 商品に最後に入力があった日を基準に、その翌日から今日までの実売上数量を返す。表示専用で通知は
// 一切行わない(通知はcheckChecksheetStockMismatch側で別途行う)。チェックシートタブを開くたびに
// 1回まとめて呼ぶ想定(タップごとに毎回呼ばない)。?action=getChecksheetStockChecks&storeId=... で実行。
// 戻り値は{商品名: {label, sinceDate, qty} または null(まだ前回入力が無い商品)}
function getChecksheetStockChecks(storeId) {
  if (!storeId) return { error: 'storeIdは必須です' };
  const periods = getChecksheetData(storeId);
  // 全期間の{dayKey:{itemKey:value}}を1つにまとめる(月をまたいだ「前回入力日」検索に対応するため。
  // 通常は同じdayKeyが複数期間に重複することは無いが、念のためObject.assignで安全側に扱う)
  const allDays = {};
  periods.forEach(p => Object.keys(p.data || {}).forEach(dayKey => {
    allDays[dayKey] = Object.assign(allDays[dayKey] || {}, p.data[dayKey]);
  }));
  const today = Utilities.formatDate(new Date(), _invSheetTz(), 'yyyy-MM-dd');
  const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), _invSheetTz(), 'yyyy-MM-dd');
  const priorDays = Object.keys(allDays).filter(d => d < today).sort().reverse();

  const result = {};
  STERA_SALES_MAPPING.forEach(m => {
    const itemKeys = m.ourProducts.map(name => 'prod:' + name);
    let sinceDate = null;
    for (let i = 0; i < priorDays.length; i++) {
      const dayData = allDays[priorDays[i]];
      if (itemKeys.some(k => dayData[k] !== undefined && dayData[k] !== '' && dayData[k] !== null)) {
        sinceDate = priorDays[i];
        break;
      }
    }
    // steraQtyはstera_daily_salesに取り込み済みの前日分までで揃える(当日分はまだ取込み前で
    // 必ず0のため、todayを上限にすると「前日まで確定」の補充量比較が崩れる。2026-08-04発覚)
    const entry = sinceDate
      ? { label: m.label, sinceDate, qty: getSteraDailyTotal_(storeId, m.prdId, sinceDate, yesterday) }
      : null;
    m.ourProducts.forEach(name => { result[name] = entry; });
  });
  return result;
}

// ----------------------------------------------------------------
// 盗難検知①: 補充数量入力時の自動突き合わせ通知 2026-07-31
// ----------------------------------------------------------------
// saveChecksheetDataとは完全に独立した読み取り専用アクション(書き込みロックを取らないため、既存の
// チェックシート保存フロー・データには一切触れない・影響しない)。クライアント側はデバウンス(既定3秒)
// してから呼ぶことで、連続タップのたびに通知が連投されることを防ぐ(index.html側で対応)。
// ?action=checkChecksheetStockMismatch(POST、{storeId, product})で実行。
// 差異(グループ合算の補充量-ステラ売上数量)が閾値以上ならLINE WORKSへ通知する(既存Bot
// 「社内ポータル通知」の既定チャンネル、2026-07-31時点でテスト運用としてこの形。
// channelIdOverride省略で既定チャンネルへ送る)。通知文言は断定しない中立表現にする
// (パートナーの数え間違い・処分・店舗間移動等でも同じ差異が出るため、盗難と決めつけない)
const CHECKSHEET_STOCK_MISMATCH_THRESHOLD = 2;
function checkChecksheetStockMismatch(storeId, product) {
  if (!storeId || !product) return { error: 'storeId/productは必須です' };
  const group = STERA_SALES_MAPPING.find(m => m.ourProducts.indexOf(product) >= 0);
  if (!group) return { ok: true, skipped: 'not_tracked' }; // 盗難検知の対象商品ではない

  const periods = getChecksheetData(storeId);
  const allDays = {};
  periods.forEach(p => Object.keys(p.data || {}).forEach(dayKey => {
    allDays[dayKey] = Object.assign(allDays[dayKey] || {}, p.data[dayKey]);
  }));
  const today = Utilities.formatDate(new Date(), _invSheetTz(), 'yyyy-MM-dd');
  const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), _invSheetTz(), 'yyyy-MM-dd');
  const itemKeys = group.ourProducts.map(name => 'prod:' + name);

  const priorDays = Object.keys(allDays).filter(d => d < today).sort().reverse();
  let sinceDate = null;
  for (let i = 0; i < priorDays.length; i++) {
    const dayData = allDays[priorDays[i]];
    if (itemKeys.some(k => dayData[k] !== undefined && dayData[k] !== '' && dayData[k] !== null)) {
      sinceDate = priorDays[i];
      break;
    }
  }
  if (!sinceDate) return { ok: true, skipped: 'no_prior_entry' }; // 今回が初回入力、比較対象が無い

  // 補充量(inputQty)とステラ実売上(steraQty)を同じ「sinceDate(除く)〜前日(含む)」の期間で揃える。
  // stera_daily_salesは前日分までしか取り込まれていない(SteraDailySalesImportが毎日06:00に
  // 前日分を取込む設計)ため、上限をtodayにすると当日分の補充だけが一方的に加算され、ラグ由来の
  // 見せかけの差異が出てしまう(2026-08-04発覚)。当日分の補充入力は次回の比較サイクルへ自然に繰り越す。
  let inputQty = 0;
  Object.keys(allDays).forEach(dayKey => {
    if (!(dayKey > sinceDate && dayKey <= yesterday)) return;
    itemKeys.forEach(k => { inputQty += Number(allDays[dayKey][k]) || 0; });
  });

  const steraQty = getSteraDailyTotal_(storeId, group.prdId, sinceDate, yesterday);
  const diff = inputQty - steraQty;
  if (diff >= CHECKSHEET_STOCK_MISMATCH_THRESHOLD) {
    try {
      // 2026-08-03: 既存の「社内ポータル通知」Botから分離し、専用Bot経由(1:1トーク)で送る
      sendStockBotNotification_(
        '【在庫差異検知】' + _storeIdLabel_(storeId) + '・' + group.label +
        'で在庫差異(補充' + inputQty + '個／ステラ実売上' + steraQty + '個、差' + diff + '個)を検知しました。ご確認ください。' +
        '(' + sinceDate + '〜' + yesterday + '分)'
      );
    } catch (e) { console.error('LINE WORKS通知エラー(在庫差異検知):', e.message); }
  }
  return { ok: true, sinceDate, throughDate: yesterday, inputQty, steraQty, diff };
}

// ----------------------------------------------------------------
// 盗難検知②: 月次バックストップ(消費量とステラ月間売上数量の突き合わせ) 2026-07-31
// ----------------------------------------------------------------
// パートナーがチェックシートに触れない期間があっても、棚卸完了のたびに必ず全対象商品分をカバーする
// 最後の安全網。パートナー向けindex.htmlには一切表示しない(この店舗タブはバックエンド側のみ)。
// buildSalesCategoryCostRatioと同じ店舗タブ・同じSTERA_SALES_MAPPINGを使うが、売上データの取得元が
// 違う点に注意——buildSalesCategoryCostRatioは使い捨てタブ「ステラ注文詳細」(都度まるごとインポート)
// を読むが、こちらは蓄積型のstera_daily_salesを月間分合計する(①の日次照会と同じ関数を再利用)。
// ?action=buildStockCheckMonthly&storeId=shibuya&periodLabel=2026-07 で実行。
const STOCK_CHECK_START_COL = 21; // U列(P〜S列=販売品類原価率ブロックの右に間隔を空ける、別ブロックとして分離)
const STOCK_CHECK_HEADERS = ['ステラ数量(月間)', '差異(消費量-処分数量-ステラ数量)', '確認状況(手入力可)'];
function buildStockCheckMonthly(storeId, periodLabel) {
  if (!storeId) return { error: 'storeIdは必須です' };
  if (!periodLabel) return { error: 'periodLabelは必須です（例: 2026-07）' };

  const invData = _inventoryLogRowsCached_();
  const idx = {};
  INVENTORY_COLS.forEach((c, i) => { idx[c] = i; });
  const consumptionByProduct = {}, disposedByProduct = {};
  invData.slice(1).forEach(r => {
    if (String(r[idx.store_id]) !== String(storeId)) return;
    if (_invMonthLabelStr(r[idx.period_label]) !== String(periodLabel)) return;
    consumptionByProduct[r[idx.product]] = Number(r[idx.consumption]) || 0;
    disposedByProduct[r[idx.product]] = Number(r[idx.disposed_qty]) || 0;
  });

  // "YYYY-MM-00"/"YYYY-MM-32"は実在しない日付だが、文字列比較上は必ずその月の1日より前/末日より後に
  // なるため、月初・月末を求めるための日付計算をせずに範囲指定できる(getSteraDailyTotal_は文字列比較のみ)
  const fromDateExclusive = periodLabel + '-00';
  const toDateInclusive = periodLabel + '-32';

  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  const storeName = _storeNames_()[storeId] || storeId;
  const sheet = ss.getSheetByName(storeName) || ss.insertSheet(storeName);
  const statusCol = STOCK_CHECK_START_COL + STOCK_CHECK_HEADERS.length - 1;
  // 確認状況は管理者が手入力するメモなので、再実行のたびに消してしまわないよう既存値を読んでおき、
  // 新しい行にもそのまま引き継ぐ(他の2列=ステラ数量・差異は毎回の再計算値で上書きしてよい)
  const existingStatus = sheet.getLastRow() >= 2
    ? sheet.getRange(2, statusCol, STERA_SALES_MAPPING.length, 1).getValues().map(r => r[0])
    : [];

  const outRows = STERA_SALES_MAPPING.map((m, i) => {
    const hasConsumption = m.ourProducts.some(name => consumptionByProduct[name] !== undefined);
    const netConsumption = m.ourProducts.reduce((sum, name) =>
      sum + (consumptionByProduct[name] || 0) - (disposedByProduct[name] || 0), 0);
    const steraQty = getSteraDailyTotal_(storeId, m.prdId, fromDateExclusive, toDateInclusive);
    const diff = hasConsumption ? netConsumption - steraQty : '';
    return [steraQty, diff, existingStatus[i] || ''];
  });

  sheet.getRange(1, STOCK_CHECK_START_COL, 1, STOCK_CHECK_HEADERS.length).setValues([STOCK_CHECK_HEADERS]);
  sheet.getRange(2, STOCK_CHECK_START_COL, outRows.length, outRows[0].length).setValues(outRows);

  return { ok: true, store: storeName, period: periodLabel, rows: outRows.length };
}

// 店舗タブに手作業で作った下書き行(期間・数量等が空欄のまま、商品コード/商品名だけ入っている行)を
// 削除するワンショット掃除用。当月納品(delivery)列は常に0以上の数値が入る(buildStoreInventorySheetが
// 生成した実データ行なら空欄になり得ない)ため、この列が空欄の行だけを「下書き行」とみなして削除する。
// ?action=pruneBlankStoreInventoryRows&storeId=shibuya で実行。
function pruneBlankStoreInventoryRows(storeId) {
  if (!storeId) return { error: 'storeIdは必須です' };
  const ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  const sheetName = _storeNames_()[storeId] || storeId;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: `${sheetName}シートが見つかりません` };
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { ok: true, deleted: 0 };
  const deliveryCol = STORE_INVENTORY_COLS.indexOf('delivery') + 1;
  const values = sheet.getRange(2, deliveryCol, lastRow - 1, 1).getValues();
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] === '') { sheet.deleteRow(i + 2); deleted++; }
  }
  return { ok: true, deleted };
}

// ----------------------------------------------------------------
// 発注画像
// ----------------------------------------------------------------

function saveOrderImage(imageBase64, imageMime, filename) {
  if (!IMAGE_FOLDER_ID) return { error: 'IMAGE_FOLDER_IDが設定されていません' };
  const imageUrl = saveImageToDrive(imageBase64, imageMime || 'image/jpeg', filename || 'order_img');
  return { ok: true, image_url: imageUrl };
}

// ----------------------------------------------------------------
// 画像 (Drive)
// ----------------------------------------------------------------

// 請求書「その他」項目の領収書写真。請求書PDF本体とは別ファイルとして扱うため、
// アップロードした時点でDriveに保存し、file_id（後で領収書まとめPDFに埋め込む用）と
// image_url（プレビュー表示用）の両方を返す。
function saveInvoiceReceiptImage(imageBase64, imageMime, filename) {
  if (!IMAGE_FOLDER_ID) return { error: 'IMAGE_FOLDER_IDが設定されていません' };
  const folder = DriveApp.getFolderById(IMAGE_FOLDER_ID);
  const blob = Utilities.newBlob(Utilities.base64Decode(imageBase64), imageMime || 'image/jpeg', (filename || 'invoice_receipt') + '.jpg');
  // IMAGE_FOLDER_ID自体が「リンクを知っている全員：閲覧者」共有のため、ファイル個別のsetSharingは不要
  // （2026-08-12、Drive API呼び出しを1枚あたり2回→1回に削減。IMAGE_FOLDER_IDのコメント参照）
  const file = folder.createFile(blob);
  return { ok: true, image_url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800', file_id: file.getId() };
}

function saveImageToDrive(base64, mimeType, filename) {
  const folder = DriveApp.getFolderById(IMAGE_FOLDER_ID);
  const blob   = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, filename + '.jpg');
  // IMAGE_FOLDER_ID自体が「リンクを知っている全員：閲覧者」共有のため、ファイル個別のsetSharingは不要
  // （2026-08-12、Drive API呼び出しを1枚あたり2回→1回に削減。IMAGE_FOLDER_IDのコメント参照）
  const file   = folder.createFile(blob);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

// ----------------------------------------------------------------
// LINE WORKS 通知
// ----------------------------------------------------------------

function notifyNewOrder_(storeId) {
  try {
    var area = _areaForStore_(storeId);
    var msg = area
      ? area + 'エリアにて発注依頼があります。'
      : '発注依頼があります。（店舗ID: ' + _storeIdLabel_(storeId) + '）';
    sendLineWorksNotification(msg);
  } catch(e) {
    // 通知失敗は保存結果に影響させない
    console.error('LINE WORKS通知エラー:', e.message);
  }
}

function createLineWorksJWT_() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('LW_CLIENT_ID');
  var serviceAccount = props.getProperty('LW_SERVICE_ACCT');
  var rawKey = props.getProperty('LW_PRIVATE_KEY');
  var base64Body = rawKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  var lines = [];
  var i = 0;
  while (i < base64Body.length) {
    lines.push(base64Body.substring(i, i + 64));
    i += 64;
  }
  var privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----';
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({alg:'RS256',typ:'JWT'})).replace(/=+$/, '');
  var now = Math.floor(new Date().getTime() / 1000);
  var payload = JSON.stringify({iss:clientId, sub:serviceAccount, iat:now, exp:now+3600});
  var claim = Utilities.base64EncodeWebSafe(payload).replace(/=+$/, '');
  var sigInput = header + '.' + claim;
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(sigInput, privateKey)).replace(/=+$/, '');
  return sigInput + '.' + sig;
}

// アクセストークンは短時間で失効するものではないため、CacheServiceに50分キャッシュして使い回す
// （2026-07-24、発注・出勤・休み申請など全通知でJWT署名＋認証リクエストの往復が毎回発生し
// 保存操作の応答が遅く感じられるとの指摘を受けて追加）。失効していた場合はsendLineWorksNotification
// 側で401検知時に自動で取り直すので、キャッシュが古くても実害は無い
function getLineWorksAccessToken_(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var cached = cache.get('LW_ACCESS_TOKEN');
    if (cached) return cached;
  }
  var props = PropertiesService.getScriptProperties();
  var jwt = createLineWorksJWT_();
  var payload = 'assertion=' + encodeURIComponent(jwt)
    + '&grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
    + '&client_id=' + encodeURIComponent(props.getProperty('LW_CLIENT_ID'))
    + '&client_secret=' + encodeURIComponent(props.getProperty('LW_CLIENT_SECRET'))
    + '&scope=bot.message';
  var res = UrlFetchApp.fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    payload: payload
  });
  var token = JSON.parse(res.getContentText()).access_token;
  try { cache.put('LW_ACCESS_TOKEN', token, 3000); } catch (e) {} // 50分。CacheServiceの上限21600秒以内
  return token;
}

// channelIdOverrideを渡すとそのチャンネルへ、省略時は従来通りLW_CHANNEL_ID（発注等の既定チャンネル）へ送信する
function sendLineWorksNotification(message, channelIdOverride) {
  var props = PropertiesService.getScriptProperties();
  var botId     = props.getProperty('LW_BOT_ID');
  var channelId = channelIdOverride || props.getProperty('LW_CHANNEL_ID');
  var url = 'https://www.worksapis.com/v1.0/bots/' + botId + '/channels/' + channelId + '/messages';
  var body = JSON.stringify({content: {type: 'text', text: message}});
  var token = getLineWorksAccessToken_();
  var res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    payload: body,
    muteHttpExceptions: true
  });
  // キャッシュされたトークンが失効していた場合のみ、1回だけ新規取得して再送する
  if (res.getResponseCode() === 401) {
    token = getLineWorksAccessToken_(true);
    UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
      payload: body
    });
  }
}

function testLineWorksNotification() {
  sendLineWorksNotification('【テスト】LINE WORKS通知の接続テストです。');
}

// ----------------------------------------------------------------
// 在庫差異検知専用Bot（2026-08-03、既存の「社内ポータル通知」Botとは完全に独立）
// ----------------------------------------------------------------
// 既存のcreateLineWorksJWT_/getLineWorksAccessToken_/sendLineWorksNotificationと同じ仕組みだが、
// 認証情報一式(LW_CLIENT_ID_STOCK/LW_CLIENT_SECRET_STOCK/LW_SERVICE_ACCT_STOCK/
// LW_PRIVATE_KEY_STOCK/LW_BOT_ID_STOCK)を別のScript Propertiesキーで持つ専用Bot
// （名称「佐藤テスト」、[[project_stock_mismatch_notification_bot]]参照）。
// 送信先は1:1トーク(userId宛)——グループのchannelIdではない点に注意。
// ユーザーから「今後グループにも送れるようにしておいて」と要望済みのため、将来channelId宛の
// 分岐を足す場合はここに追加すること（現時点ではuserId宛のみ実装）。
function createStockBotJWT_() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('LW_CLIENT_ID_STOCK');
  var serviceAccount = props.getProperty('LW_SERVICE_ACCT_STOCK');
  var rawKey = props.getProperty('LW_PRIVATE_KEY_STOCK');
  // Script Propertiesへの貼り付け時に改行が消えたり余分な文字が混入するケースがあるため
  // (2026-08-03に実際発生: 1行に潰れた上に末尾に余分な"--"が付着していた)、まずヘッダー/フッター文字列
  // を(前後のダッシュの数に関わらず)正規表現で除去し、そのうえでbase64として有効な文字だけを残す
  var base64Body = rawKey
    .replace(/-*BEGIN PRIVATE KEY-*/gi, '')
    .replace(/-*END PRIVATE KEY-*/gi, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  var lines = [];
  var i = 0;
  while (i < base64Body.length) {
    lines.push(base64Body.substring(i, i + 64));
    i += 64;
  }
  var privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----';
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({alg:'RS256',typ:'JWT'})).replace(/=+$/, '');
  var now = Math.floor(new Date().getTime() / 1000);
  var payload = JSON.stringify({iss:clientId, sub:serviceAccount, iat:now, exp:now+3600});
  var claim = Utilities.base64EncodeWebSafe(payload).replace(/=+$/, '');
  var sigInput = header + '.' + claim;
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(sigInput, privateKey)).replace(/=+$/, '');
  return sigInput + '.' + sig;
}

function getStockBotAccessToken_(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var cached = cache.get('LW_STOCK_ACCESS_TOKEN');
    if (cached) return cached;
  }
  var props = PropertiesService.getScriptProperties();
  var jwt = createStockBotJWT_();
  var payload = 'assertion=' + encodeURIComponent(jwt)
    + '&grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')
    + '&client_id=' + encodeURIComponent(props.getProperty('LW_CLIENT_ID_STOCK'))
    + '&client_secret=' + encodeURIComponent(props.getProperty('LW_CLIENT_SECRET_STOCK'))
    + '&scope=bot'; // このBot用Appには「bot」スコープのみ許可しているため、既存の'bot.message'とは異なる
  var res = UrlFetchApp.fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    payload: payload
  });
  var token = JSON.parse(res.getContentText()).access_token;
  try { cache.put('LW_STOCK_ACCESS_TOKEN', token, 3000); } catch (e) {}
  return token;
}

// userIdOverride省略時はLW_USER_ID_STOCK(既定の通知先、Bot作成者本人)宛に送る
function sendStockBotNotification_(message, userIdOverride) {
  var props = PropertiesService.getScriptProperties();
  var botId  = props.getProperty('LW_BOT_ID_STOCK');
  var userId = userIdOverride || props.getProperty('LW_USER_ID_STOCK');
  var url = 'https://www.worksapis.com/v1.0/bots/' + botId + '/users/' + userId + '/messages';
  var body = JSON.stringify({content: {type: 'text', text: message}});
  var token = getStockBotAccessToken_();
  var res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    payload: body,
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 401) {
    token = getStockBotAccessToken_(true);
    UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
      payload: body
    });
  }
}

function testStockBotNotification() {
  sendStockBotNotification_('【テスト】在庫差異検知Botの接続テストです。');
}

// ----------------------------------------------------------------
// 会費ペイ承認Bot（2026-08-05、[[project_kaihipay_remote_approval_design]]参照）
// ----------------------------------------------------------------
// 認証情報一式(Client ID/Secret/Service Account/秘密鍵)は在庫差異検知Bot「佐藤テスト」と同じApp
// (OAuth Scope: bot)を共有しているため、getStockBotAccessToken_()をそのまま再利用する。
// このBot専用に必要なScript Propertiesは LW_BOT_ID_KAIHIPAY と LW_USER_ID_KAIHIPAY の2つ(必須)。
// 値自体は在庫差異検知Bot側のLW_USER_ID_STOCKと同じ人物(Bot作成者本人)になる想定だが、
// 用途(内容)が全く異なるため意図的にプロパティを分離している——フォールバックは行わない。
// LW_BOT_SECRET_KAIHIPAYは現状未使用（GAS doPost(e)はカスタムHTTPヘッダーを読めないため
// X-WORKS-Signatureでの署名検証ができず、Bot Secretを使う場面が無い。将来の拡張用に保存だけしておく）。
//
// 承認フローは「ボタン(承認/拒否)=最速の確定判定」「自由テキスト返信=例外の余地」のハイブリッド。
// ボタンはtype:'message'アクション(button_templateはtype:'postback'未対応——2026-08-05実機で
// "content.actions[0].postback is not supported"と判明)にし、タップ時にlabelと同じテキストが
// 通常のメッセージとして送られてくるため、テキスト返信(handleKaihipayApprovalTextReply_)と
// 全く同じ経路で処理される(専用のpostbackハンドラは無し)。
// Callback URL自体を ?bot=kaihipay 付きでDeveloper Consoleに登録し、doPost側でこのBotからの
// 返信だと判別する(メッセージ受信イベントにBot識別フィールドが無いため)。
// テキスト返信は「承認/はい/OK」「拒否/いいえ/NG」の決まった語のみ実行トリガーとして扱い、
// それ以外の自由文は「未承認のまま保留」として記録するだけで、自由文の意味解釈は行わない
// ([[project_kaihipay_remote_approval_design]]の合意方針そのまま)。

function _kaihipayApprovalPropKey_(requestId) {
  return 'KAIHIPAY_APPROVAL_' + requestId;
}

function _setKaihipayApprovalState_(requestId, status, message, note) {
  var props = PropertiesService.getScriptProperties();
  var existing = _getKaihipayApprovalState_(requestId) || {};
  var state = {
    status: status,
    message: message !== undefined ? message : (existing.message || null),
    note: note !== undefined ? note : (existing.note || null),
    createdAt: existing.createdAt || new Date().toISOString(),
    respondedAt: (status === 'approved' || status === 'rejected') ? new Date().toISOString() : (existing.respondedAt || null)
  };
  props.setProperty(_kaihipayApprovalPropKey_(requestId), JSON.stringify(state));
  return state;
}

function _getKaihipayApprovalState_(requestId) {
  var raw = PropertiesService.getScriptProperties().getProperty(_kaihipayApprovalPropKey_(requestId));
  return raw ? JSON.parse(raw) : null;
}

// 自由テキスト返信はrequestIdを含まないため、現在pending状態の中で最新の1件を対象にする
// (テスト段階のシンプル実装——同時に複数件pendingになる運用が始まったら見直しが必要)
function _findPendingKaihipayApprovalRequestId_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var latestId = null, latestCreatedAt = null;
  Object.keys(props).forEach(function (key) {
    if (key.indexOf('KAIHIPAY_APPROVAL_') !== 0) return;
    var state;
    try { state = JSON.parse(props[key]); } catch (e) { return; }
    if (state.status !== 'pending') return;
    if (!latestCreatedAt || state.createdAt > latestCreatedAt) {
      latestCreatedAt = state.createdAt;
      latestId = key.substring('KAIHIPAY_APPROVAL_'.length);
    }
  });
  return latestId;
}

// デバッグ用に最後の送信結果(ステータスコード・レスポンス本文)を保持する(2026-08-05、
// 「届いていない」原因調査用の一時的な措置。原因判明後は消してよい)
function _postKaihipayBotMessage_(contentObj, userIdOverride) {
  var props = PropertiesService.getScriptProperties();
  var botId  = props.getProperty('LW_BOT_ID_KAIHIPAY');
  var userId = userIdOverride || props.getProperty('LW_USER_ID_KAIHIPAY');
  var url = 'https://www.worksapis.com/v1.0/bots/' + botId + '/users/' + userId + '/messages';
  var body = JSON.stringify({ content: contentObj });
  var token = getStockBotAccessToken_();
  var res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: body,
    muteHttpExceptions: true
  });
  var debugInfo = { botId: botId, userId: userId, code: res.getResponseCode(), responseText: res.getContentText() };
  if (res.getResponseCode() === 401) {
    token = getStockBotAccessToken_(true);
    var res2 = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: body,
      muteHttpExceptions: true
    });
    debugInfo.retryCode = res2.getResponseCode();
    debugInfo.retryResponseText = res2.getContentText();
  }
  return debugInfo;
}

// button_templateのactionsはtype:'postback'に対応していない(2026-08-05、実機で
// "content.actions[0].postback is not supported"と判明——ドキュメント上は存在するtypeだが
// このcontent typeでは使えない)。type:'message'にするとタップ時にlabelと同じ内容が
// 通常のテキストメッセージとして送られてくるため、テキスト返信(handleKaihipayApprovalTextReply_)
// と全く同じ経路で処理できる——postback用の別ハンドラは不要。
function sendKaihipayApprovalRequest_(requestId, message, userIdOverride) {
  _setKaihipayApprovalState_(requestId, 'pending', message);
  return _postKaihipayBotMessage_({
    type: 'button_template',
    contentText: message,
    actions: [
      { type: 'message', label: '承認', text: '承認' },
      { type: 'message', label: '拒否', text: '拒否' }
    ]
  }, userIdOverride);
}

function sendKaihipayApprovalNotification_(message, userIdOverride) {
  _postKaihipayBotMessage_({ type: 'text', text: message }, userIdOverride);
}

function handleKaihipayApprovalTextReply_(body) {
  const userId = body.source && body.source.userId;
  const text = (body.content && body.content.text || '').trim();
  const requestId = _findPendingKaihipayApprovalRequestId_();
  if (!requestId) return { ok: true, skipped: 'no_pending_request' };

  if (/^(承認|はい|OK)$/i.test(text)) {
    _setKaihipayApprovalState_(requestId, 'approved');
    return { ok: true, requestId, decision: 'approved',
      _notify: { type: 'kaihipayApprovalAck', userId, message: '承認しました。(ID: ' + requestId + ')' } };
  }
  if (/^(拒否|いいえ|NG)$/i.test(text)) {
    _setKaihipayApprovalState_(requestId, 'rejected');
    return { ok: true, requestId, decision: 'rejected',
      _notify: { type: 'kaihipayApprovalAck', userId, message: '拒否しました。(ID: ' + requestId + ')' } };
  }
  // 決まった語以外の自由文は、承認/拒否を確定させず「保留中の一言」として記録するだけ
  _setKaihipayApprovalState_(requestId, 'pending', undefined, text);
  return { ok: true, requestId, held: true };
}

// Python側(kaihipayパイプライン)からこのWeb Appへ {action:'kaihipayRequestApproval', requestId, message}
// をPOSTすると承認依頼が送信される。ポーリングは {action:'kaihipayCheckApproval', requestId} で行う。
function kaihipayRequestApproval(requestId, message) {
  var debugInfo = sendKaihipayApprovalRequest_(requestId, message);
  return { ok: true, requestId: requestId, status: 'pending', debug: debugInfo };
}

function kaihipayCheckApproval(requestId) {
  var state = _getKaihipayApprovalState_(requestId);
  return state
    ? Object.assign({ ok: true, requestId: requestId }, state)
    : { ok: true, requestId: requestId, status: 'unknown' };
}

function testKaihipayApprovalBot() {
  sendKaihipayApprovalRequest_('test-' + new Date().getTime(), '【テスト】会費ペイ承認Botの接続テストです。承認/拒否を押してください。');
}

// ----------------------------------------------------------------
// 在庫差異検知Bot: LINE WORKSからの返信を受けて任意の期間を再調査する機能（2026-08-04、シンプル版）
// ----------------------------------------------------------------
// LINE WORKS Developer ConsoleでこのBotのCallback URLをこのWebアプリのURLに設定すると、
// スタッフが在庫差異通知に対して1:1トークで返信した際、doPostへLINE WORKSからのメッセージが
// 届くようになる。シンプル版のため会話の文脈保持はせず、1メッセージに店舗名・商品名・日付範囲を
// 全て含めてもらう想定（例:「御器所 水 8/1〜8/4で調べて」）。
// 注意: Google Apps ScriptのdoPost(e)はカスタムHTTPヘッダーを取得できないため、
// LINE WORKSのX-WORKS-Signatureによる署名検証は実装できない(GASの既知の制約)。
// このアプリの他のdoPostアクションも同様に認証なしで動いており、既存のリスク水準と同等。
function isLineWorksCallback_(body) {
  return !!(body && body.source && body.content && body.content.type === 'text' && !body.action);
}

function handleLineWorksStockInquiry_(body) {
  const userId = body.source && body.source.userId;
  const text = body.content && body.content.text || '';
  if (!userId || !text) return { ok: true, skipped: 'no_text_or_user' };

  const parsed = _parseStockInquiryText_(text);
  if (!parsed) {
    return { ok: true, parsed: false, _notify: { type: 'stockInquiryReply', userId,
      message: '店舗名・商品名・日付範囲が読み取れませんでした。「店舗名 商品名 M/D〜M/Dで調べて」の形式で送ってください。' } };
  }

  const { storeId, storeName, group, fromDate, toDate } = parsed;
  const periods = getChecksheetData(storeId);
  const allDays = {};
  periods.forEach(p => Object.keys(p.data || {}).forEach(dayKey => {
    allDays[dayKey] = Object.assign(allDays[dayKey] || {}, p.data[dayKey]);
  }));
  const itemKeys = group.ourProducts.map(name => 'prod:' + name);
  let inputQty = 0;
  Object.keys(allDays).forEach(dayKey => {
    if (!(dayKey > fromDate && dayKey <= toDate)) return; // fromDateは前日扱い(exclusive)、toDateはinclusive。getSteraDailyTotal_と同じ規約
    itemKeys.forEach(k => { inputQty += Number(allDays[dayKey][k]) || 0; });
  });
  const steraQty = getSteraDailyTotal_(storeId, group.prdId, fromDate, toDate);
  const diff = inputQty - steraQty;

  return {
    ok: true, storeId, group: group.label, fromDate, toDate, inputQty, steraQty, diff,
    _notify: { type: 'stockInquiryReply', userId,
      message: storeName + '・' + group.label + '(' + fromDate + '〜' + toDate + ')\n'
        + '補充: ' + inputQty + '個\nステラ実売上: ' + steraQty + '個\n差異: ' + diff + '個' }
  };
}

// 「御器所 水 8/1〜8/4で調べて」のようなテキストから店舗名・商品ラベル・日付範囲を抜き出す。
// 店舗名・商品名は日付範囲より前の部分文字列から検索する(stores.js表示名・STERA_SALES_MAPPINGの
// labelそのままの表記を要求——表記ゆれの吸収はシンプル版では行わない)。
function _parseStockInquiryText_(text) {
  const dateRe = /(\d{4}[-/])?(\d{1,2})[-/](\d{1,2})\s*[〜~\-−ー]\s*(\d{4}[-/])?(\d{1,2})[-/](\d{1,2})/;
  const m = text.match(dateRe);
  if (!m) return null;
  const tz = _invSheetTz();
  const currentYear = Number(Utilities.formatDate(new Date(), tz, 'yyyy'));
  const yearFrom = m[1] ? Number(m[1].replace(/[-/]/, '')) : currentYear;
  const yearTo   = m[4] ? Number(m[4].replace(/[-/]/, '')) : currentYear;
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const toDate = yearTo + '-' + pad(Number(m[5])) + '-' + pad(Number(m[6]));
  // fromDateはexclusive比較のため前日にする(getSteraDailyTotal_・checkChecksheetStockMismatchと同じ規約)
  const fromDateInclusive = new Date(yearFrom, Number(m[2]) - 1, Number(m[3]));
  fromDateInclusive.setDate(fromDateInclusive.getDate() - 1);
  const fromDate = Utilities.formatDate(fromDateInclusive, tz, 'yyyy-MM-dd');

  const beforeDate = text.slice(0, m.index);
  const names = _storeNames_();
  let storeId = null, storeName = null;
  Object.keys(names).forEach(id => {
    if (storeId) return;
    if (beforeDate.indexOf(names[id]) >= 0) { storeId = id; storeName = names[id]; }
  });
  if (!storeId) return null;

  let group = null;
  STERA_SALES_MAPPING.forEach(g => {
    if (group) return;
    if (beforeDate.indexOf(g.label) >= 0) group = g;
  });
  if (!group) return null;

  return { storeId, storeName, group, fromDate, toDate };
}

// 業務開始（未打刻/GPS要確認/休み申請）の通知は発注とは別のLINE WORKSグループへ送る。
// さらにnotifyNewOrder_/sendDailyOrderNotificationと同様、東海/関西/関東のエリアごとに
// 別グループへ振り分ける。スクリプトプロパティに各エリアのチャンネルIDを設定して使う:
//   LW_CHANNEL_ID_ATTENDANCE_TOKAI / _KANSAI / _KANTO
// エリア別が未設定の間はLW_CHANNEL_ID_ATTENDANCE（業務開始共通チャンネル）、
// それも未設定なら従来の発注用チャンネル(LW_CHANNEL_ID)にフォールバックする。
const ATTENDANCE_AREA_CHANNEL_PROP_ = { '東海': 'LW_CHANNEL_ID_ATTENDANCE_TOKAI', '関西': 'LW_CHANNEL_ID_ATTENDANCE_KANSAI', '関東': 'LW_CHANNEL_ID_ATTENDANCE_KANTO' };

// 管理者が「店舗管理」画面の「店舗のエリア変更」で行った上書き(app_settingsの'store_regions'キー、
// {storeId:'tokai'|'kansai'|'kanto'}のJSON)を1回の実行内でのみキャッシュして取得
let _cachedStoreRegionOverrides = null;
function _storeRegionOverrides_() {
  if (_cachedStoreRegionOverrides) return _cachedStoreRegionOverrides;
  try {
    const s = getSettings().find(x => x.key === 'store_regions');
    _cachedStoreRegionOverrides = s ? JSON.parse(s.value || '{}') : {};
  } catch (e) {
    _cachedStoreRegionOverrides = {};
  }
  return _cachedStoreRegionOverrides;
}
// 店舗のエリアを判定する。管理者が「店舗管理」画面でエリア変更していればその上書きを優先し、
// 無ければAREA_STORESのデフォルト割り当てにフォールバックする
function _areaForStore_(storeId) {
  const override = _storeRegionOverrides_()[String(storeId)];
  if (override && REGION_ID_LABEL_[override]) return REGION_ID_LABEL_[override];
  for (var areaName in AREA_STORES) {
    if (AREA_STORES[areaName].indexOf(String(storeId)) >= 0) return areaName;
  }
  return null;
}
function _attendanceChannelForArea_(area) {
  var props = PropertiesService.getScriptProperties();
  var propKey = area && ATTENDANCE_AREA_CHANNEL_PROP_[area];
  return (propKey && props.getProperty(propKey)) || props.getProperty('LW_CHANNEL_ID_ATTENDANCE') || props.getProperty('LW_CHANNEL_ID');
}
function _attendanceLineWorksChannel_(storeId) {
  return _attendanceChannelForArea_(_areaForStore_(storeId));
}

// 休み申請の通知だけ、未打刻/GPS要確認とは別の送り先に変更できるようにする(2026-07-24)。
// スクリプトプロパティに LW_CHANNEL_ID_LEAVE_TOKAI / _KANSAI / _KANTO を設定するとそこへ、
// エリア別が未設定ならLW_CHANNEL_ID_LEAVE（休み申請共通）、それも未設定なら従来通り
// 業務開始共通(LW_CHANNEL_ID_ATTENDANCE)→発注用(LW_CHANNEL_ID)の順にフォールバックする
// （何も新しく設定しなければ今まで通りの送り先のまま変わらない）
const LEAVE_AREA_CHANNEL_PROP_ = { '東海': 'LW_CHANNEL_ID_LEAVE_TOKAI', '関西': 'LW_CHANNEL_ID_LEAVE_KANSAI', '関東': 'LW_CHANNEL_ID_LEAVE_KANTO' };
function _leaveChannelForArea_(area) {
  var props = PropertiesService.getScriptProperties();
  var propKey = area && LEAVE_AREA_CHANNEL_PROP_[area];
  return (propKey && props.getProperty(propKey)) || props.getProperty('LW_CHANNEL_ID_LEAVE') || props.getProperty('LW_CHANNEL_ID_ATTENDANCE') || props.getProperty('LW_CHANNEL_ID');
}
function _leaveLineWorksChannel_(storeId) {
  return _leaveChannelForArea_(_areaForStore_(storeId));
}

function testAttendanceLineWorksNotification() {
  sendLineWorksNotification('【テスト】業務開始通知グループの接続テストです。', _attendanceLineWorksChannel_(null));
}

function testLeaveLineWorksNotification() {
  sendLineWorksNotification('【テスト】休み申請通知グループの接続テストです。', _leaveLineWorksChannel_(null));
}

// LW_CHANNEL_ID_LEAVE_TOKAI/_KANSAI/_KANTOをエリア別に個別テストしたい時用（2026-07-24追加）。
// 用が済んだら削除してよい
function testLeaveLineWorksNotificationTokai() {
  sendLineWorksNotification('【テスト】休み申請通知(東海)の接続テストです。', _leaveChannelForArea_('東海'));
}
function testLeaveLineWorksNotificationKansai() {
  sendLineWorksNotification('【テスト】休み申請通知(関西)の接続テストです。', _leaveChannelForArea_('関西'));
}
function testLeaveLineWorksNotificationKanto() {
  sendLineWorksNotification('【テスト】休み申請通知(関東)の接続テストです。', _leaveChannelForArea_('関東'));
}

// Botの名前変更がLINE WORKS側になかなか反映されない場合の調査用。Developer Console/管理コンソール
// での画面表示に頼らず、APIが実際に返す現在の名前(botName)をここで直接確認できる。
// これでもまだ旧名称が返る＝保存自体が反映されていない、新名称が返る＝トーク画面側の表示キャッシュの
// 問題、と切り分けられる
function getLineWorksBotInfo() {
  var props = PropertiesService.getScriptProperties();
  var botId = props.getProperty('LW_BOT_ID');
  var token = getLineWorksAccessToken_();
  var url = 'https://www.worksapis.com/v1.0/bots/' + botId;
  var res = UrlFetchApp.fetch(url, { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true });
  console.log(res.getContentText());
  return JSON.parse(res.getContentText());
}

function testNotify() {
  notifyNewOrder_('shibuya');
}

function sendDailyOrderNotification() {
  purgeOldLostItems(); // 忘れ物の30日経過削除は読み取りのたびではなく、この日次バッチでのみ行う
  // 納品履歴の30日経過削除も同様、読み取りのたびではなくここでのみ行う。DELIVERY_HISTORY_SHEET_IDが
  // 未設定のうちはSpreadsheetApp.openByIdが例外を投げるため、それで発注の日次通知自体が
  // 止まってしまわないようtry/catchで囲む
  try { purgeOldDeliveryHistory(); } catch (e) { console.error('purgeOldDeliveryHistory error:', e.message); }
  try { purgeOldMachinePhotos(); } catch (e) { console.error('purgeOldMachinePhotos error:', e.message); }
  try { sendMachinePhotoReminder(); } catch (e) { console.error('sendMachinePhotoReminder error:', e.message); }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet || sheet.getLastRow() <= 1) return;
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var storeIdx = headers.indexOf('store_id');
  var isNewIdx = headers.indexOf('is_new');
  var hasTokai = false, hasKansai = false, hasKanto = false;
  for (var i = 1; i < data.length; i++) {
    var isNew = data[i][isNewIdx];
    if (isNew !== true && String(isNew) !== 'TRUE') continue;
    var storeId = String(data[i][storeIdx]);
    var area = _areaForStore_(storeId);
    if (area === '東海') hasTokai = true;
    if (area === '関西') hasKansai = true;
    if (area === '関東') hasKanto = true;
  }
  if (hasTokai) sendLineWorksNotification('東海エリアにて発注依頼があります。');
  if (hasKansai) sendLineWorksNotification('関西エリアにて発注依頼があります。');
  if (hasKanto) sendLineWorksNotification('関東エリアにて発注依頼があります。');
}

// ----------------------------------------------------------------
// 業務開始：未打刻／休み申請の日次まとめ通知（毎朝8:30、前日分をまとめてチェック）
// ----------------------------------------------------------------

// スタッフ1名分の「今月・当日8:30時点（＝前日まで）の目標打刻日数」を算出する。
// schedule: {type:'interval', intervalDays:N} または {type:'weekday', weekdays:[0-6]}（未設定時は
// intervalDays:1＝毎日出勤扱い）。leaveDatesSet: 今月分・前日以前に絞り込み済みの休み申請日('yyyy-MM-dd')Set。
// 2026-07-23確定の計算式（[[feature_attendance_checkin]]参照、请求書機能とは独立・floor丸め採用）:
//   interval: 基準業務日数=ceil(当月日数/N) → r=基準業務日数/当月日数 → 有効経過日数=経過日数-休み申請日数 → floor(r×有効経過日数)
//   weekday: 前日までの指定曜日の日数（休み申請日を除く）をそのままカウント
// 2026-08-03: interval型はrが非整数のため日次では「休み申請1日が必ず目標を1減らす」とは
// ならず分かりにくいと判断、日次チェック(sendDailyAttendanceCheck)ではinterval型を対象外にし
// 月末一括チェック(sendMonthlyAttendanceCheck→computeAttendanceMonthEndTarget_)に統一した。
// この関数自体はweekday型の日次チェック用としてそのまま残っている（interval分岐も関数としては
// 温存、他から呼ばれる可能性を考慮し削除はしない）。
function computeAttendanceTargetDays_(schedule, now, leaveDatesSet) {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // 通知は当日8:30に「前日分まで」を評価するため、経過日数は前日の日付を使う（月初1日は前日が前月に
  // なるため経過日数0＝まだ何も評価しない）
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const elapsedDays = (yesterday.getMonth() === now.getMonth()) ? yesterday.getDate() : 0;
  if (elapsedDays <= 0) return 0;

  if (schedule && schedule.type === 'weekday' && Array.isArray(schedule.weekdays) && schedule.weekdays.length) {
    let count = 0;
    for (let d = 1; d <= elapsedDays; d++) {
      const dt = new Date(now.getFullYear(), now.getMonth(), d);
      const dateStr = Utilities.formatDate(dt, _sheetTz(), 'yyyy-MM-dd');
      if (schedule.weekdays.indexOf(dt.getDay()) >= 0 && !leaveDatesSet.has(dateStr)) count++;
    }
    return count;
  }

  const intervalDays = (schedule && Number(schedule.intervalDays)) || 1;
  const baseDays = Math.ceil(daysInMonth / intervalDays);
  const r = baseDays / daysInMonth;
  const effectiveElapsed = Math.max(0, elapsedDays - leaveDatesSet.size);
  return Math.floor(r * effectiveElapsed);
}

function sendDailyAttendanceCheck() {
  const settings = getSettings();
  const settingVal = key => { const s = settings.find(x => x.key === key); return s ? s.value : null; };
  const enabledStores = JSON.parse(settingVal('attendance_enabled_stores') || '[]');
  if (!enabledStores.length) return;
  const staffMap    = JSON.parse(settingVal('attendance_staff_list') || '{}');
  const scheduleMap = JSON.parse(settingVal('attendance_staff_schedule') || '{}');
  const storeDefaultScheduleMap = JSON.parse(settingVal('attendance_store_default_schedule') || '{}');

  const now = new Date();
  const monthLabel = Utilities.formatDate(now, _sheetTz(), 'yyyy-MM');
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const cutoffStr = (yesterdayDate.getMonth() === now.getMonth())
    ? Utilities.formatDate(yesterdayDate, _sheetTz(), 'yyyy-MM-dd') : null;
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowStr = Utilities.formatDate(tomorrowDate, _sheetTz(), 'yyyy-MM-dd');

  purgeOldAttendance(); // 3ヶ月より古い打刻の削除は読み取りのたびではなく、この日次バッチでのみ行う
  purgeOldLeaveRequests(); // 休み申請も同様に3ヶ月より古い分をここで削除する(2026-08-01追加)
  const attendanceRows = getAttendance(); // 全店舗分をまとめて1回だけ取得
  const leaveRows = getLeaveRequests();

  // notifyNewOrder_/sendDailyOrderNotificationと同様、店舗のエリア（東海/関西/関東）ごとに
  // 行を振り分け、エリア単位で別々のLINE WORKSグループへ送る（エリア不明の店舗は別枠にまとめる）
  const linesByArea = {}; // { areaKey: { underTarget: [...], newLeave: [...], tomorrowLeave: [...] } }
  const bucketFor = storeId => {
    const area = _areaForStore_(storeId) || '(エリア未設定)';
    if (!linesByArea[area]) linesByArea[area] = { underTarget: [], newLeave: [], tomorrowLeave: [] };
    return linesByArea[area];
  };

  enabledStores.forEach(storeId => {
    const names = staffMap[storeId] || [];
    const storeScheduleMap = scheduleMap[storeId] || {};
    // スタッフが1人も登録されていない店舗は、店舗単位のデフォルトスケジュール(設定されていれば)を
    // name=''の仮想スタッフとしてチェックする(2026-08-03新設)。スタッフが1人でも登録されている
    // 店舗ではこのフォールバックは一切見ない(既存の個人別スケジュールを優先、挙動は変えない)。
    // [[feature_attendance_checkin]]参照。
    const effectiveNames = names.length ? names : (storeDefaultScheduleMap[storeId] ? [''] : []);
    effectiveNames.forEach(name => {
      const schedule = names.length
        ? (storeScheduleMap[name] || { type: 'interval', intervalDays: 1 })
        : storeDefaultScheduleMap[storeId];
      // 2026-08-03: interval型は月末一括チェック(sendMonthlyAttendanceCheck)に統一したため、
      // 日次のペース確認はweekday型のみを対象にする（interval型はここでスキップ）
      if (schedule.type !== 'weekday') return;
      const leaveDatesSet = new Set(
        cutoffStr ? leaveRows
          .filter(r => String(r.store_id) === String(storeId) && (r.name || '') === name
            && String(r.leave_date).startsWith(monthLabel) && String(r.leave_date) <= cutoffStr)
          .map(r => String(r.leave_date)) : []
      );
      const target = computeAttendanceTargetDays_(schedule, now, leaveDatesSet);
      if (target <= 0) return;
      const actualDays = new Set(
        attendanceRows
          .filter(r => String(r.store_id) === String(storeId) && (r.name || '') === name
            && r.within_range === true && String(r.clocked_at).startsWith(monthLabel))
          .map(r => String(r.clocked_at).slice(0, 10))
      ).size;
      if (actualDays < target) {
        bucketFor(storeId).underTarget.push('・店舗ID:' + _storeIdLabel_(storeId) + ' ' + (name || '(未登録名)') + '（実績' + actualDays + '/目標' + target + '日）');
      }
    });
  });

  // 前日中に新規申請された休み申請一覧（休む日自体は問わず、"申請された"タイミングが前日のもの）
  leaveRows
    .filter(r => String(r.submitted_at || '').slice(0, 10) === cutoffStr)
    .forEach(r => {
      bucketFor(r.store_id).newLeave.push('・店舗ID:' + _storeIdLabel_(r.store_id) + ' ' + (r.name || '(未登録名)') + '：' + r.leave_date + 'に休み申請');
    });

  // 休む日が明日の休み申請一覧（"申請された"タイミングは問わず、休む日自体が明日のもの）。
  // 上の「前日分の新着」とは独立した別枠のリマインド — 人間が見落とすリスクを減らすため、
  // 申請時点で既に通知済みかどうかに関わらず前日朝にもう一度必ず知らせる意図的な二重通知
  // （2026-07-29ユーザー指示）。
  leaveRows
    .filter(r => String(r.leave_date) === tomorrowStr)
    .forEach(r => {
      bucketFor(r.store_id).tomorrowLeave.push('・店舗ID:' + _storeIdLabel_(r.store_id) + ' ' + (r.name || '(未登録名)') + '：明日(' + tomorrowStr.slice(5).replace('-', '/') + ')休み');
    });

  // 未打刻確認と休み申請は送り先が別々になりうる(休み申請だけLEAVE_AREA_CHANNEL_PROP_で
  // 変更可能、2026-07-24)ため、以前は1通にまとめていたメッセージをエリアごとに分けて送る
  Object.keys(linesByArea).forEach(area => {
    const b = linesByArea[area];
    const areaKey = area === '(エリア未設定)' ? null : area;
    if (b.underTarget.length) {
      const msg = '【' + area + '】\n【未打刻確認】ペースを下回っている担当者:\n' + b.underTarget.join('\n');
      sendLineWorksNotification(msg, _attendanceChannelForArea_(areaKey));
    }
    if (b.newLeave.length) {
      const msg = '【' + area + '】\n【休み申請（前日分の新着）】\n' + b.newLeave.join('\n');
      sendLineWorksNotification(msg, _leaveChannelForArea_(areaKey));
    }
    if (b.tomorrowLeave.length) {
      const msg = '【' + area + '】\n【休み申請リマインド（明日分）】\n' + b.tomorrowLeave.join('\n');
      sendLineWorksNotification(msg, _leaveChannelForArea_(areaKey));
    }
  });
}

// interval型スタッフ1名分の「月末時点の目標打刻日数」を算出する（2026-08-03新設）。
// computeAttendanceTargetDays_のinterval分岐と同じ式だが、経過日数を「当月日数」固定で評価する
// （＝月が終わった状態を想定した1回きりの判定。日次のfloor丸めのブレが気にならない代わりに
// 月末まで結果が分からない）。leaveDatesSet: 対象月全体分の休み申請日('yyyy-MM-dd')Set。
// weekday型はそもそも端数の問題が無く従来通り日次チェック(computeAttendanceTargetDays_)の
// ままなので、この関数はinterval型専用（呼び出し側でtype==='weekday'を除外する前提）。
function computeAttendanceMonthEndTarget_(schedule, year, month, leaveDatesSet) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const intervalDays = (schedule && Number(schedule.intervalDays)) || 1;
  const baseDays = Math.ceil(daysInMonth / intervalDays);
  const r = baseDays / daysInMonth;
  const effectiveDays = Math.max(0, daysInMonth - leaveDatesSet.size);
  return Math.floor(r * effectiveDays);
}

// 毎月1日の朝、前月分のinterval型スタッフについて「基準業務日数(休み申請日を除く)」に
// 実出勤日数が届いていたかを月末時点でまとめてチェックする（2026-08-03、ユーザー指示）。
// weekday型は対象外（sendDailyAttendanceCheckの日次チェックのまま）。
function sendMonthlyAttendanceCheck() {
  const settings = getSettings();
  const settingVal = key => { const s = settings.find(x => x.key === key); return s ? s.value : null; };
  const enabledStores = JSON.parse(settingVal('attendance_enabled_stores') || '[]');
  if (!enabledStores.length) return;
  const staffMap    = JSON.parse(settingVal('attendance_staff_list') || '{}');
  const scheduleMap = JSON.parse(settingVal('attendance_staff_schedule') || '{}');
  const storeDefaultScheduleMap = JSON.parse(settingVal('attendance_store_default_schedule') || '{}');

  const now = new Date();
  // 月初1日の朝に実行される想定 → チェック対象は前月
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonthDate.getFullYear();
  const month = prevMonthDate.getMonth(); // 0-indexed
  const monthLabel = Utilities.formatDate(prevMonthDate, _sheetTz(), 'yyyy-MM');

  const attendanceRows = getAttendance();
  const leaveRows = getLeaveRequests();

  const linesByArea = {}; // { areaKey: [...] }
  const bucketFor = storeId => {
    const area = _areaForStore_(storeId) || '(エリア未設定)';
    if (!linesByArea[area]) linesByArea[area] = [];
    return linesByArea[area];
  };

  enabledStores.forEach(storeId => {
    const names = staffMap[storeId] || [];
    const storeScheduleMap = scheduleMap[storeId] || {};
    // 日次チェックと同じフォールバック(2026-08-03新設)。[[feature_attendance_checkin]]参照。
    const effectiveNames = names.length ? names : (storeDefaultScheduleMap[storeId] ? [''] : []);
    effectiveNames.forEach(name => {
      const schedule = names.length
        ? (storeScheduleMap[name] || { type: 'interval', intervalDays: 1 })
        : storeDefaultScheduleMap[storeId];
      if (schedule.type === 'weekday') return; // weekday型は日次チェックのみ対象

      const leaveDatesSet = new Set(
        leaveRows
          .filter(r => String(r.store_id) === String(storeId) && (r.name || '') === name
            && String(r.leave_date).startsWith(monthLabel))
          .map(r => String(r.leave_date))
      );
      const target = computeAttendanceMonthEndTarget_(schedule, year, month, leaveDatesSet);
      if (target <= 0) return;
      const actualDays = new Set(
        attendanceRows
          .filter(r => String(r.store_id) === String(storeId) && (r.name || '') === name
            && r.within_range === true && String(r.clocked_at).startsWith(monthLabel))
          .map(r => String(r.clocked_at).slice(0, 10))
      ).size;
      if (actualDays < target) {
        bucketFor(storeId).push('・店舗ID:' + _storeIdLabel_(storeId) + ' ' + (name || '(未登録名)') + '（' + monthLabel + '実績' + actualDays + '/目標' + target + '日）');
      }
    });
  });

  Object.keys(linesByArea).forEach(area => {
    const lines = linesByArea[area];
    if (!lines.length) return;
    const areaKey = area === '(エリア未設定)' ? null : area;
    const msg = '【' + area + '】\n【月末出勤チェック】' + monthLabel + 'の基準業務日数に届かなかった担当者:\n' + lines.join('\n');
    sendLineWorksNotification(msg, _attendanceChannelForArea_(areaKey));
  });
}

// ----------------------------------------------------------------
// 請求書PDF生成（テンプレート複製方式）
// ----------------------------------------------------------------
// セル位置は2026-07-11にINVOICE_TEMPLATE_IDのシート(gid=1628780517)を実測して確定。
// テンプレートの行・列を作り直した場合はこのマップだけ直せばよい。
// ※eraYear/eraMonth/eraDay・bankName・branchNameの3項目はテンプレートの構造上の推測を
//   含むため、実際に生成したPDFを見て位置がずれていないか一度確認すること。
// 2026-07-11: ユーザーのテンプレート編集で複数セルの結合状態が変化したため、
// 「座標マップ」を再取得して以下を実測値に合わせて更新（座標マップの取得結果を正とする）。
const INVOICE_CELL_MAP = {
  bizCode: 'P3',
  // 令和/年/月/日は独立した値セルが無く、ラベルセル自体を「N年」のように書き換える方式
  eraYear: 'Q5', eraMonth: 'S5', eraDay: 'U5',
  registrationDigits: 'M7', // 旧P7。M7:P7が結合されアンカーがM7になったため変更
  taxExemptCheck: 'P7', // 旧Q7。テンプレート編集でチェックボックスセルがP7に移動（ラベルはQ7:U7に）
  partnerName: 'L8',
  storeNameCell: 'A9', // テンプレート編集時にA9:H9で結合され、アンカーがB9からA9に変わったため修正
  address: 'L9',
  tel: 'L10',
  claimTotalIncl: 'C11', claimTotalExcl: 'B14', claimTax: 'F14',
  bankName: 'O13', // 旧M13。銀行コード欄がL13:N13に拡張され、新たにO13:P14が空欄として確保されたため変更
  bankCode: 'L14',
  branchName: 'O15', // 旧M15。支店コード欄と同様の理由でO15:P16に変更
  branchCode: 'L16',
  accountType: 'L17', accountNumber: 'M17',
  accountHolderKana: 'M18', // 旧K18。ラベルがJ18:L18に拡張され、新たにM18:P18が空欄として確保されたため変更
  payTotalIncl: 'C16', payTotalExcl: 'B18', payTax: 'F18',
  itemRowStart: 21, itemRowEnd: 40,
  itemCols: { storeCode: 'A', storeName: 'C', staff: 'H', amount: 'K', note: 'O', category: 'T' },
  grandTotal: 'K41',
};
const INVOICE_YEN_FORMAT = '¥#,##0';

function submitInvoice(p) {
  if (!p) return { error: 'payloadがありません' };
  if (!INVOICE_TEMPLATE_ID)  return { error: 'INVOICE_TEMPLATE_IDが設定されていません' };
  if (!INVOICE_PDF_FOLDER_ID) return { error: 'INVOICE_PDF_FOLDER_IDが設定されていません' };

  // 業者コードが同じ複数店舗をまとめて1枚の請求書にする場合、storeLinesに対象店舗が複数入る
  // （単独店舗の場合は1件のみ）。請求金額は端数切捨てが必須のため、クライアント値を信用せず
  // サーバー側で店舗ごとに再計算する。
  const storeLines = (p.storeLines || []).filter(sl => sl);
  if (!storeLines.length) return { error: '対象店舗がありません' };
  const storeDayRate = storeLines.map(sl => {
    const fullAmount = Number(sl.fullAmount || 0);
    const baseDays   = Number(sl.baseDays || 0);
    const actualDays = Number(sl.actualDays || 0);
    return { sl: sl, amount: baseDays > 0 ? Math.floor(fullAmount / baseDays * actualDays) : 0 };
  });
  const otherItems = (p.otherItems || []).filter(it => it && Number(it.amount) !== 0);
  const perStoreOtherTotal = {};
  otherItems.forEach(it => {
    if (!it.pid) return;
    perStoreOtherTotal[it.pid] = (perStoreOtherTotal[it.pid] || 0) + Math.floor(Number(it.amount));
  });
  const dayRateTotal = storeDayRate.reduce((s, r) => s + r.amount, 0);
  const otherTotal = otherItems.reduce((s, it) => s + Math.floor(Number(it.amount)), 0);
  const grandTotal = dayRateTotal + otherTotal;

  const isCombined = storeLines.length > 1;
  const primaryLabel = isCombined ? (p.partnerName || 'invoice') : (storeLines[0].storeName || storeLines[0].storeId || 'invoice');
  const fileBaseName = primaryLabel + '_' + (p.invoiceDate || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM'));

  const folder   = DriveApp.getFolderById(INVOICE_PDF_FOLDER_ID);
  const copyFile = DriveApp.getFileById(INVOICE_TEMPLATE_ID).makeCopy(fileBaseName + '_作業用', folder);
  const ss = SpreadsheetApp.openById(copyFile.getId());

  // セル座標確認用に残っている可能性のある「座標マップ」タブは複製から取り除く
  const leftover = ss.getSheetByName('座標マップ');
  if (leftover) ss.deleteSheet(leftover);

  const sheet = ss.getSheets().find(s => s.getSheetId() === 1628780517) || ss.getSheets()[0];
  // テンプレートの実列数がU列(21)までしか無い場合、V列(22)の幅指定/結合が「範囲外」エラーになるため事前に列を追加する
  // 追加した列はU列の書式（明細ヘッダー行の「科目」オレンジ背景など）を引き継いでしまうため、書式だけ消しておく
  if (sheet.getMaxColumns() < 22) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 22 - sheet.getMaxColumns());
    sheet.getRange(1, 22, sheet.getMaxRows(), 1).clearFormat();
  }
  const M = INVOICE_CELL_MAP;
  const set = (a1, value) => sheet.getRange(a1).setValue(value);
  // 枠からはみ出さないよう、文字数に応じてフォントサイズを自動で縮小する（narrow=幅の狭い列は早めに縮小）
  // 文字数が少ない場合は通常サイズ(10pt)のまま、長い場合だけ段階的に縮小する
  const setFit = (a1, value, narrow) => {
    const len = String(value == null ? '' : value).length;
    const t = narrow ? [22, 16, 10] : [32, 24, 16];
    const size = len > t[0] ? 7 : len > t[1] ? 8 : len > t[2] ? 9 : 10;
    sheet.getRange(a1).setValue(value).setFontSize(size);
  };

  // テンプレートに前回の値が残っていることがあるため、未設定でも空文字で必ず上書きする
  sheet.getRange(M.bizCode).setNumberFormat('@').setValue(p.bizCode || ''); // 先頭0付きコードにも対応
  // 令和/年/月/日：ラベルセルを書き換えるため、テンプレートの飾り文字フォントを引き継がず
  // 標準フォントに揃える（数字が潰れて読み違えられるのを防ぐ）。列幅拡張などで空白が
  // 目立つため左寄せにして、直前の文字（令和／年／月）との間隔を詰める
  const eraFont = a1 => sheet.getRange(a1).setFontFamily('Arial').setFontSize(11).setHorizontalAlignment('left');
  const era = p.era || {};
  set(M.eraYear,  era.year  ? era.year  + '年' : ''); eraFont(M.eraYear);
  set(M.eraMonth, era.month ? era.month + '月' : ''); eraFont(M.eraMonth);
  // 「31日」のような2桁の日は他の日付(8年/7月)と同じ11ptだとU列だけでは幅が足りず見切れる。
  // ただしU列自体を広げると「仕入/外注」枠(R:S列とT:U列で対になっている)の対称性が崩れるため、
  // U列は他と揃えたまま、日付だけ隣のV列(他の用途で使っていない列)まで結合して幅を確保する
  const eraDayRange = sheet.getRange(M.eraDay + ':' + M.eraDay.replace(/[A-Z]+/, 'V'));
  if (!eraDayRange.isPartOfMerge()) eraDayRange.merge();
  set(M.eraDay, era.day ? era.day + '日' : ''); eraFont(M.eraDay);
  // 令和/年/月/日の間（P・Q列）の余白を詰める。Q列は明細の備考欄にも使われるが、
  // 日付行を優先し、備考の長文対策はフォントサイズの自動縮小側に任せる
  sheet.setColumnWidth(16, 20); // P列（純粋な余白。他の箇所と共有していない）
  sheet.setColumnWidth(17, 35); // Q列（「8年」の表示にも使うため、余白列ほどは狭めない）
  sheet.setColumnWidth(15, 70); // O列（明細の備考欄用。他の箇所と共有していない）
  // R・S・T・U列（仕入/外注チェック枠、明細の確認印/科目列、担当者/事務欄で共有）は
  // 見た目の四角い枠を揃えるため必ず同じ幅にする
  [18, 19, 20, 21].forEach(col => sheet.setColumnWidth(col, 30)); // R・S・T・U列（均等）
  sheet.setColumnWidth(22, 14); // V列（「31日」がU列だけでは見切れる分の逃がし。他箇所と共有していない）
  // 課税事業者ではないチェックは、常に四角い枠が見える文字（☑/☐）で表現する
  // （テンプレート側のそのセルはデータ入力規則＝ネイティブチェックボックスを解除してプレーンな文字セルにしておくこと）
  // 列幅拡張(Q列)で「課税事業者ではない」の文字から離れて見えるため、右寄せにして隙間を詰める
  // .setDataValidation(null)でチェックボックス設定を強制解除してから書き込む。
  // テンプレート側でこのセルにネイティブチェックボックスが設定され直しても、常に文字表示に上書きされる
  sheet.getRange(M.taxExemptCheck).setDataValidation(null).setValue(p.isTaxExempt ? '☑' : '☐').setHorizontalAlignment('right');
  // 登録番号は「課税事業者ではない」がチェックされていない場合のみ表示する
  // （両立を防ぐ入力チェックはクライアント側（index.html）で行っている）
  if (!p.isTaxExempt && p.registrationNumber) {
    // 列幅を広げ済みなので縮小せず、固定サイズ(11pt)で見やすく表示する。先頭0落ち防止でテキスト書式にする
    sheet.getRange(M.registrationDigits).setNumberFormat('@').setValue(String(p.registrationNumber).replace(/^T/i, ''))
      .setFontSize(11).setHorizontalAlignment('left');
  }

  // 「社名（名前）」ラベル（J8）は隣のL8に値が入ると右端の「）」が見切れるため縮小
  sheet.getRange('J8').setFontSize(9);
  sheet.getRange(M.partnerName).setValue(p.partnerName || '').setFontSize(11);
  // 複数店舗まとめ請求の場合、店舗名セルは具体的な店名の代わりに「◯店」（対象店舗数）を表示する
  sheet.getRange(M.storeNameCell)
    .setValue(isCombined ? ('セルフカフェ　' + storeLines.length + '店') : ('セルフカフェ' + (storeLines[0].storeName || '') + '店'))
    .setHorizontalAlignment('center');
  // 住所は右端で見切れやすいため、折り返しを許可する（行の高さがテンプレート側で固定されている
  // 場合は折り返し後も窮屈に見えることがあるため、必要なら住所欄の行の高さもテンプレート側で広げること）
  sheet.getRange(M.address).setValue(p.address || '').setFontSize(10).setWrap(true);
  set(M.tel, p.tel || '');

  // 金額ボックスは値が右寄り/中央寄りでラベルと離れて見えるため、左寄せにして間を詰める
  sheet.getRange(M.claimTotalIncl).setValue(grandTotal).setHorizontalAlignment('left');
  sheet.getRange(M.payTotalIncl).setValue(grandTotal).setHorizontalAlignment('left');
  // 消費税10%を前提に税抜・税額へ逆算（円未満切り上げ）
  const taxExcl = Math.ceil(grandTotal / 1.1);
  const tax = grandTotal - taxExcl;
  set(M.claimTotalExcl, taxExcl);
  set(M.claimTax, tax);
  set(M.payTotalExcl, taxExcl);
  set(M.payTax, tax);

  setFit(M.bankName, p.bankName || '', true);
  // setNumberFormat('@')でプレーンテキスト扱いにしてから書き込む。そうしないと「0005」のような
  // 先頭0付きコードが数値として自動変換され、「5」のように先頭の0が消えて表示されてしまう
  sheet.getRange(M.bankCode).setNumberFormat('@').setValue(p.bankCode || '')
    .setFontSize(9).setVerticalAlignment('top').setHorizontalAlignment('left');
  setFit(M.branchName, p.branchName || '', true);
  sheet.getRange(M.branchCode).setNumberFormat('@').setValue(p.branchCode || '')
    .setFontSize(9).setVerticalAlignment('top').setHorizontalAlignment('left');
  // 前回の値が残らないよう、普通/当座どちらでも毎回明示的に上書きする
  set(M.accountType, p.accountType === '当座' ? '当' : '普');
  sheet.getRange(M.accountNumber).setNumberFormat('@').setValue(p.accountNumber || ''); // 口座番号も同様に先頭0が消えるのを防ぐ
  setFit(M.accountHolderKana, p.accountHolderKana || '', true);
  // 「口座名義（カナ）」ラベル（J18:L18）の表示を整える
  sheet.getRange('J18').setFontSize(9);

  // 明細：各店舗の日割り行を先に並べ、その後にその他項目（緊急出動・現地購入・割引等）を並べる。
  // 複数店舗まとめ請求の実際の紙運用でもこの並び順（店舗の行→その他の行）だったため踏襲している。
  // その他項目は対象店舗が選ばれていればその店舗名で、店舗指定なし（合計調整等）なら店舗名欄は空欄にする。
  const lines = storeDayRate.map(r => ({
    storeName: r.sl.storeName || '', storeCode: r.sl.storeCode || '', staff: r.sl.staffName || p.partnerName || '',
    amount: r.amount, note: p.dayRateNote || '',
  })).concat(otherItems.map(it => ({
    storeName: it.storeName || '', storeCode: it.storeCode || '', staff: it.staffName || p.partnerName || '',
    amount: Math.floor(Number(it.amount)), note: it.note || '',
  })));
  const maxRows = M.itemRowEnd - M.itemRowStart + 1;
  if (lines.length > maxRows) {
    return { error: '明細行が' + maxRows + '行を超えています（' + lines.length + '行）。その他の項目数を減らしてください。' };
  }
  lines.forEach((line, i) => {
    const row = M.itemRowStart + i;
    setFit(M.itemCols.storeName + row, line.storeName ? ('セルフカフェ' + line.storeName + '店') : '');
    sheet.getRange(M.itemCols.storeName + row).setHorizontalAlignment('center');
    sheet.getRange(M.itemCols.storeCode + row).setValue(line.storeCode).setHorizontalAlignment('center');
    // 担当者欄は幅が狭く、6文字程度でも折り返してしまうため、折り返しを禁止した上で小さめの固定サイズにする
    sheet.getRange(M.itemCols.staff + row).setValue(line.staff).setFontSize(8).setWrap(false);
    sheet.getRange(M.itemCols.amount    + row).setValue(line.amount).setNumberFormat(INVOICE_YEN_FORMAT).setHorizontalAlignment('right');
    setFit(M.itemCols.note + row, line.note, true);
    sheet.getRange(M.itemCols.category  + row).setValue('');
  });
  set(M.grandTotal, grandTotal);

  // 金額セルの表示形式をテンプレートの書式ゆれに関わらず統一する
  [M.claimTotalIncl, M.claimTotalExcl, M.claimTax, M.payTotalIncl, M.payTotalExcl, M.payTax, M.grandTotal]
    .forEach(a1 => sheet.getRange(a1).setNumberFormat(INVOICE_YEN_FORMAT));

  SpreadsheetApp.flush();

  // PDFエクスポート（対象シートのgidを指定。scale=4で縦横とも1ページに収める）
  // 印刷範囲をA1:V41に明示的に絞り、それ以降の空列が印刷範囲に含まれて右側に余白ができるのを防ぐ
  // ※scale=2（幅に合わせて拡大）にすると1ページに収まらず2ページに分かれてしまうため、
  //   1ページ厳守を優先してscale=4（縦横ともページに収める）に戻す
  const token = ScriptApp.getOAuthToken();
  const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export'
    + '?format=pdf&gid=' + sheet.getSheetId()
    + '&size=A4&portrait=true&scale=4&gridlines=false&printtitle=false&sheetnames=false'
    + '&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3'
    + '&r1=0&r2=41&c1=0&c2=22';
  const pdfResp = UrlFetchApp.fetch(exportUrl, { headers: { Authorization: 'Bearer ' + token } });
  const pdfBlob = pdfResp.getBlob().setName(fileBaseName + '.pdf');
  const pdfFile = folder.createFile(pdfBlob);

  // レイアウト調査用に一時的に残していた中間生成物のシートコピーを削除する（原因特定・解消済みのため復活）
  copyFile.setTrashed(true);

  // 「その他」項目に添付された領収書写真は、請求書PDF本体とは別ファイル（1枚1ページの領収書
  // まとめPDF）としてまとめる。Apps Scriptにはシートごとの印刷設定APIも複数PDFの結合機能も
  // 無いため、請求書本体（Sheet経由）とは別に、Google Docsを経由してPDF化する。
  const receiptPdfUrl = buildInvoiceReceiptPdf(otherItems, fileBaseName, folder);

  // 提出履歴（請求一覧の提出済み/未提出判定）は、まとめ請求でも店舗ごとに1件ずつ記録する。
  // 見た目は1枚のPDFでも、対象の全店舗がそれぞれ正しく「提出済み」と判定されるようにするため。
  const period = String(p.invoiceDate || '').slice(0, 6);
  storeDayRate.forEach(r => {
    appendInvoiceLog({
      storeId: r.sl.storeId, storeName: r.sl.storeName, partnerId: r.sl.pid || r.sl.storeId,
      period: period,
      amount: r.amount + (perStoreOtherTotal[r.sl.pid] || 0),
      pdfUrl: pdfFile.getUrl(),
      receiptPdfUrl: receiptPdfUrl,
    });
  });

  return { ok: true, pdfUrl: pdfFile.getUrl(), receiptPdfUrl: receiptPdfUrl, grandTotal: grandTotal };
}

// ページに乗せる枚数に応じて、写真ができるだけ大きく表示されるようグリッドの列・行数を決める。
// 1枚なら1マス全体、2枚は横並び（領収書は縦長になりがちなので高さを目一杯使えるように）、
// 3〜4枚は2列×2行。5枚以上は入り切らない分を次ページへ回す。
function _receiptGridDims(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  return { cols: 2, rows: 2 };
}

// その他項目に添付された領収書写真（Drive file_id）を、1ページに複数枚まとめたGoogle Docsに
// 差し込んでからPDFとしてエクスポートする。添付が無ければ何もせず空文字を返す。
function buildInvoiceReceiptPdf(otherItems, fileBaseName, folder) {
  const receiptItems = (otherItems || []).filter(it => it && it.receiptFileId);
  if (!receiptItems.length) return '';

  const doc = DocumentApp.create(fileBaseName + '_領収書_作業用');
  const body = doc.getBody();
  body.setMarginTop(20).setMarginBottom(20).setMarginLeft(20).setMarginRight(20);
  const PAGE_WIDTH_PT  = 555; // A4幅(595pt)からマージン(左右20pt×2)を引いた値
  const PAGE_HEIGHT_PT = 802; // A4高さ(842pt)からマージン(上下20pt×2)を引いた値
  const PER_PAGE = 4; // 1ページ最大4枚
  const CAPTION_H = 14; // 備考テキスト分の高さ見込み

  for (let pageStart = 0; pageStart < receiptItems.length; pageStart += PER_PAGE) {
    if (pageStart > 0) body.appendPageBreak();
    const pageItems = receiptItems.slice(pageStart, pageStart + PER_PAGE);
    const { cols, rows } = _receiptGridDims(pageItems.length);
    const cellW = Math.floor(PAGE_WIDTH_PT / cols) - 12; // セルの内側余白ぶん差し引く
    const cellH = Math.floor(PAGE_HEIGHT_PT / rows) - CAPTION_H - 16;
    const seed = [];
    for (let r = 0; r < rows; r++) seed.push(new Array(cols).fill(''));
    const table = body.appendTable(seed);
    table.setBorderWidth(0);

    pageItems.forEach((it, idx) => {
      const r = Math.floor(idx / cols), c = idx % cols;
      const cell = table.getCell(r, c);
      const captionPara = cell.getChild(0).asParagraph();
      captionPara.setText(it.note || '');
      captionPara.setFontSize(9).setBold(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      try {
        const imgBlob = DriveApp.getFileById(it.receiptFileId).getBlob();
        const img = cell.appendImage(imgBlob);
        const scale = Math.min(cellW / img.getWidth(), cellH / img.getHeight(), 1);
        img.setWidth(img.getWidth() * scale).setHeight(img.getHeight() * scale);
        const imgParent = img.getParent();
        if (imgParent && imgParent.getType() === DocumentApp.ElementType.PARAGRAPH) {
          imgParent.asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        }
      } catch (e) {
        cell.appendParagraph('(画像読込失敗)').setFontSize(8);
      }
    });
  }
  doc.saveAndClose();

  const docFile = DriveApp.getFileById(doc.getId());
  const pdfBlob = docFile.getAs('application/pdf').setName(fileBaseName + '_領収書.pdf');
  const pdfFile = folder.createFile(pdfBlob);
  docFile.setTrashed(true);
  return pdfFile.getUrl();
}

// ----------------------------------------------------------------
// 請求提出履歴（管理者の「請求一覧」画面用）
// ----------------------------------------------------------------

function appendInvoiceLog(entry) {
  const sheet = getSheet(SHEET_INVOICE_LOG);
  ensureHeaders(sheet, INVOICE_LOG_COLS);
  // receipt_pdf_url列を後から追加したため、既存シートで既にヘッダー行がある場合は
  // 末尾に列を補う（ensureHeadersはシートが空の場合しかヘッダーを書かないため）
  const lastCol = sheet.getLastColumn();
  if (lastCol > 0) {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers.indexOf('receipt_pdf_url') === -1) sheet.getRange(1, lastCol + 1).setValue('receipt_pdf_url');
  }
  // periodは'YYYYMMDD'形式のinvoiceDateから先頭6桁を受け取る想定なので、'YYYY-MM'に整形する
  const period = /^\d{6}$/.test(entry.period) ? entry.period.slice(0, 4) + '-' + entry.period.slice(4, 6) : entry.period;
  sheet.appendRow([
    Utilities.getUuid(), entry.storeId, entry.storeName, entry.partnerId,
    period, entry.amount, entry.pdfUrl, new Date().toISOString(), entry.receiptPdfUrl || '',
  ]);
}

function getInvoiceLog() {
  const sheet = getSheet(SHEET_INVOICE_LOG);
  if (sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
}

function setDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailyOrderNotification') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sendDailyOrderNotification').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone('Asia/Tokyo').create();
}

// デプロイ後、Apps Scriptエディタ（またはclasp run）で一度だけ手動実行すること
// （コードをpush/deployしただけではトリガーは登録されない。setDailyTrigger()と同じ運用）
function setDailyAttendanceTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailyAttendanceCheck') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sendDailyAttendanceCheck').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone('Asia/Tokyo').create();
}

// デプロイ後、Apps Scriptエディタ（またはclasp run）で一度だけ手動実行すること
// （setDailyAttendanceTrigger等と同じ運用）。interval型スタッフの月末出勤チェック用トリガー。
function setMonthlyAttendanceTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendMonthlyAttendanceCheck') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sendMonthlyAttendanceCheck').timeBased().onMonthDay(1).atHour(9).inTimezone('Asia/Tokyo').create();
}
