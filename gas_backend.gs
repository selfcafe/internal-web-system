// ============================================================
// セルフカフェ社内ポータル - Google Apps Script バックエンド
// ============================================================
// ⚠️ このファイル内の *_SHEET_ID 定数（SHEET_ID/INVENTORY_SHEET_ID/MANUAL_DELIVERY_SHEET_ID/
// DELIVERY_HISTORY_SHEET_ID）は全て空文字のまま維持すること。本リポジトリはGitHub公開リポジトリのため、
// 実IDは絶対にここへコミットしない。実IDはApps Scriptエディタ側（本番デプロイ環境）にのみ設定する。
// 【設定】デプロイ前に以下2行を入力してください
const SHEET_ID        = '';  // GoogleスプレッドシートのID
const IMAGE_FOLDER_ID = '1adg7TQIYXSkWIo19ohVo93raDY2HsTW_';  // 画像保存用DriveフォルダのID
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
const INVENTORY_COLS = ['period_label','store_id','code','product','label','open_stock','delivery','end_stock','consumption','disposed_qty','price','amount','remarks','updated_at','anomaly_note','daily_count','matched'];
// 出勤打刻ログ。1回の打刻で1行追加（append-onlyのログシート、ordersのような全件削除→再送信はしない）
const ATTENDANCE_COLS = ['id','store_id','name','clocked_at','lat','lng','within_range'];
// 基準座標からこの距離(m)以内なら出勤OKと判定する（全店舗共通の固定値、2026-07-15確定）
const ATTENDANCE_THRESHOLD_M = 300;
// 休み申請ログ。1回の申請で1行追加（append-only、承認ステップなしで即時確定）
const SHEET_ATTENDANCE_LEAVE = 'attendance_leave';
const ATTENDANCE_LEAVE_COLS = ['id','store_id','name','leave_date','submitted_at'];

// エリア別店舗ID
const AREA_STORES = {
  '東海': ['sasashima','chikusa','gokaiso','tsuruma','kamisawa','nakamura_nisseki','midori_kofubutsu','sakurayama','akatsuka','shin_moriyama','tokoname','hamamatsu','sakae','rokubanchou','nonami','seto_iwayadou','nagakute','meieki_nishi','nadia_sakae','shinmizuhashi','eisei','hotei','kamejima','nakamura_torii','taikodori','kouta','hibino','hoshigaoka','ikeshita','toyota','hara','fujigaoka','gifu_kitagata','narumi'],
  '関西': ['tenma','higashiosaka','aikawa','minami_morimachi','abeno','tanimachi9','moriguchi','taishibashi','kyobashi_kita','shinsaibashi','kishi','umeda','kami_shinjyo','osaka_hirano','hikone','aeon_higashiosaka','gamo4'],
  '関東': ['inzai','otsuka','sugamo','umejima','shibuya','shinjuku_fc','kamisato']
};

// ----------------------------------------------------------------
// エントリーポイント
// ----------------------------------------------------------------

function doGet(e) {
  try {
    const a = e.parameter.action;
    let result;
    if      (a === 'getOrders')         result = getOrders();
    else if (a === 'getSettings')       result = getSettings();
    else if (a === 'getLostItems')      result = getLostItems(e.parameter.month, e.parameter.storeId);
    else if (a === 'getChecksheetData') result = getChecksheetData(e.parameter.storeId);
    else if (a === 'getInventoryHistory') result = getInventoryHistory(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'getInventoryDeliveryAuto') result = getInventoryDeliveryAuto(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'getInventoryDeliveryManual') result = getInventoryDeliveryManual(e.parameter.storeId, e.parameter.periodLabel);
    else if (a === 'getInventoryTabData')       result = getInventoryTabData(e.parameter.storeId, e.parameter.periodLabel, e.parameter.prevPeriodLabel);
    else if (a === 'getInvoiceLog')             result = getInvoiceLog();
    else if (a === 'migrateOrderColumns')       result = migrateOrderColumns();
    else if (a === 'migrateInventoryColumns')   result = migrateInventoryColumns();
    else if (a === 'setupInventoryDisposedHighlight') result = setupInventoryDisposedHighlight();
    else if (a === 'getSettingHistory')         result = getSettingHistory(e.parameter.key, e.parameter.limit);
    else if (a === 'getAttendance')             result = getAttendance(e.parameter.storeId);
    else if (a === 'getLeaveRequests')          result = getLeaveRequests(e.parameter.storeId);
    else if (a === 'getDeliveryHistory')        result = getDeliveryHistory(e.parameter.storeId, e.parameter.month);
    else result = { error: 'Unknown action: ' + a };
    return json(result);
  } catch(err) {
    return json({ error: err.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const b = JSON.parse(e.postData.contents);
    let result;
    if      (b.action === 'saveOrders')         result = saveOrders(b.storeId, b.rows);
    else if (b.action === 'upsertOrders')       result = upsertOrderRows(b.storeId, b.rows);
    else if (b.action === 'deleteOrders')       result = deleteOrderRows(b.ids);
    else if (b.action === 'saveSetting')        result = saveSetting(b.key, b.value);
    else if (b.action === 'saveLostItem')       result = saveLostItem(b.item, b.imagesBase64, b.imageMime);
    else if (b.action === 'deleteLostItem')     result = deleteLostItem(b.id, b.imageUrl);
    else if (b.action === 'saveOrderImage')     result = saveOrderImage(b.imageBase64, b.imageMime, b.filename);
    else if (b.action === 'saveChecksheetData') result = saveChecksheetData(b.storeId, b.periodLabel, b.data);
    else if (b.action === 'saveInventorySnapshot') result = saveInventorySnapshot(b.storeId, b.periodLabel, b.rows, b.remarks);
    else if (b.action === 'recordInventoryDelivery') result = recordInventoryDelivery(b.storeId, b.periodLabel, b.product, b.qty);
    else if (b.action === 'submitInvoice')       result = submitInvoice(b.payload);
    else if (b.action === 'saveInvoiceReceiptImage') result = saveInvoiceReceiptImage(b.imageBase64, b.imageMime, b.filename);
    else if (b.action === 'saveAttendance')      result = saveAttendance(b.storeId, b.name, b.lat, b.lng);
    else if (b.action === 'saveLeaveRequest')    result = saveLeaveRequest(b.storeId, b.name, b.leaveDate);
    else if (b.action === 'saveDeliveryHistory') result = saveDeliveryHistory(b.storeId, b.row);
    else if (b.action === 'clearDeliveryHistory') result = clearDeliveryHistory(b.storeId);
    else result = { error: 'Unknown action: ' + b.action };
    return json(result);
  } catch(err) {
    return json({ error: err.message });
  } finally {
    lock.releaseLock();
  }
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

function getSettings() {
  const sheet = getSheet(SHEET_SETTINGS);
  if (sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const ki = data[0].indexOf('key'), vi = data[0].indexOf('value');
  return data.slice(1).map(r => ({ key: r[ki], value: r[vi] }));
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
      return { ok: true };
    }
  }
  _logSettingHistory(key, '');
  sheet.appendRow([key, value]);
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

function getLostItems(month, storeId) {
  purgeOldLostItems();
  let rows = sheetRows(getSheet(SHEET_LOST), LOST_COLS).map(r => ({ ...r, found_date: _dateStr(r.found_date) }));
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

function saveChecksheetData(storeId, periodLabel, data) {
  const sheet = getSheet(SHEET_CHECKSHEET);
  ensureHeaders(sheet, CHECKSHEET_COLS);
  const json = JSON.stringify(data || {});
  const now  = new Date().toISOString();
  if (sheet.getLastRow() > 1) {
    const values = sheet.getDataRange().getValues();
    const sidIdx = values[0].indexOf('store_id'), pidIdx = values[0].indexOf('period_label');
    const dataIdx = values[0].indexOf('data'), updIdx = values[0].indexOf('updated_at');
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][sidIdx]) === String(storeId) && _monthLabelStr(values[i][pidIdx]) === String(periodLabel)) {
        sheet.getRange(i + 1, dataIdx + 1).setValue(json);
        sheet.getRange(i + 1, updIdx + 1).setValue(now);
        return { ok: true };
      }
    }
  }
  // period_labelが"YYYY-MM"のまま日付型に自動変換されないよう、書き込み前にプレーンテキスト形式へ固定する
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, CHECKSHEET_COLS.indexOf('period_label') + 1).setNumberFormat('@');
  sheet.appendRow([storeId, periodLabel, json, now]);
  return { ok: true };
}

// ----------------------------------------------------------------
// attendance（出勤打刻）
// ----------------------------------------------------------------

// storeIdを渡すと自店舗分のみ、省略すると全店舗分を返す（パートナー/管理者で共通利用）
function getAttendance(storeId) {
  purgeOldAttendance();
  let rows = sheetRows(getSheet(SHEET_ATTENDANCE), ATTENDANCE_COLS);
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  return rows.map(r => Object.assign({}, r, { clocked_at: _dateTimeStr(r.clocked_at) }))
    .sort((a, b) => String(b.clocked_at).localeCompare(String(a.clocked_at)));
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
}

// 2点の緯度経度間の距離をメートルで返す（Haversine formula）
function _haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 店舗の基準座標（app_settingsの'attendance_store_coords'キー、{storeId:{lat,lng}}のJSON）と
// 打刻位置の距離を計算し、ATTENDANCE_THRESHOLD_M以内かどうかを判定してから1行追加する
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

  sheet.appendRow([Utilities.getUuid(), storeId, name, new Date(), lat, lng, withinRange]);
  if (withinRange === false) notifyAttendanceGpsIssue_(storeId, name);
  return { ok: true, withinRange };
}

// GPS要確認（基準座標から離れた場所での打刻）は翌朝のバッチを待たずその場で通知する
// ※店舗名マスタ(stores.js)はフロント専用の共有ファイルでバックエンドからは参照できないため、
//   notifyNewOrder_と同様、店舗IDをそのままメッセージに含める
function notifyAttendanceGpsIssue_(storeId, name) {
  try {
    const who = name ? name + 'さん' : '担当者';
    sendLineWorksNotification('【GPS要確認】' + who + 'の業務開始打刻が、店舗から離れた場所として記録されました。（店舗ID: ' + storeId + '）', _attendanceLineWorksChannel_(storeId));
  } catch(e) {
    console.error('LINE WORKS通知エラー:', e.message);
  }
}

// ----------------------------------------------------------------
// attendance_leave（休み申請）
// ----------------------------------------------------------------

// storeIdを渡すと自店舗分のみ、省略すると全店舗分を返す（パートナー/管理者で共通利用）
function getLeaveRequests(storeId) {
  let rows = sheetRows(getSheet(SHEET_ATTENDANCE_LEAVE), ATTENDANCE_LEAVE_COLS);
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  return rows.map(r => Object.assign({}, r, { leave_date: _dateStr(r.leave_date), submitted_at: _dateTimeStr(r.submitted_at) }))
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
}

// 承認ステップなし、申請した瞬間に即時確定（2026-07-23確定仕様）。
// 申請日が「申請時点の翌日」の場合のみ、翌朝8:30の日次通知を待たずその場でLINE WORKS通知する
// （代打調整等の対応余地を残すため）。翌々日以降の申請は日次まとめ通知(sendDailyAttendanceCheck)に含める。
function saveLeaveRequest(storeId, name, leaveDate) {
  const sheet = getSheet(SHEET_ATTENDANCE_LEAVE);
  ensureHeaders(sheet, ATTENDANCE_LEAVE_COLS);
  sheet.appendRow([Utilities.getUuid(), storeId, name, leaveDate, new Date()]);

  const tomorrow = Utilities.formatDate(new Date(Date.now() + 24*60*60*1000), _sheetTz(), 'yyyy-MM-dd');
  if (leaveDate === tomorrow) notifyLeaveRequestTomorrow_(storeId, name, leaveDate);
  return { ok: true };
}

function notifyLeaveRequestTomorrow_(storeId, name, leaveDate) {
  try {
    const who = name ? name + 'さん' : '担当者';
    const md = leaveDate.slice(5).replace('-', '/');
    sendLineWorksNotification('【休み申請】' + who + 'が明日(' + md + ')休み申請をしました。（店舗ID: ' + storeId + '）', _attendanceLineWorksChannel_(storeId));
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
}

function getDeliveryHistory(storeId, month) {
  purgeOldDeliveryHistory();
  const sheet = getDeliveryHistorySheet();
  let rows = sheetRows(sheet, DELIVERY_HISTORY_COLS).map(r => ({
    ...r,
    request_date: _delHistDateStr(r.request_date),
    order_date: _delHistDateStr(r.order_date),
    delivery_date: _delHistDateStr(r.delivery_date),
    delivered_at_str: _delHistDateTimeStr(r.delivered_at),
    delivered_at: r.delivered_at instanceof Date ? r.delivered_at.getTime() : (Number(r.delivered_at) || null),
  }));
  if (storeId) rows = rows.filter(r => String(r.store_id) === String(storeId));
  if (month) rows = rows.filter(r => String(r.delivered_at_str || '').startsWith(month));
  return rows.sort((a, b) => (b.delivered_at||0) - (a.delivered_at||0));
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

function getInventoryHistory(storeId, periodLabel) {
  const sheet = getInventorySheet();
  if (sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const hdrs = data[0].map(String);
  const rows = data.slice(1).map(row => {
    const obj = {};
    INVENTORY_COLS.forEach(c => { const i = hdrs.indexOf(c); obj[c] = i >= 0 ? row[i] : null; });
    obj.period_label = _invMonthLabelStr(obj.period_label);
    return obj;
  });
  return rows.filter(r =>
    (!storeId || String(r.store_id) === String(storeId)) &&
    (!periodLabel || r.period_label === String(periodLabel))
  );
}

// 同じ店舗×年月の既存行を全て削除してから送信内容を書き直す（当月分は何度でも上書き修正できる）
function saveInventorySnapshot(storeId, periodLabel, rows, remarks) {
  const sheet = getInventorySheet();
  ensureHeaders(sheet, INVENTORY_COLS);
  const now = new Date().toISOString();

  if (sheet.getLastRow() > 1) {
    const values = sheet.getDataRange().getValues();
    const sidIdx = values[0].indexOf('store_id'), pidIdx = values[0].indexOf('period_label');
    const toDel = [];
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][sidIdx]) === String(storeId) && _invMonthLabelStr(values[i][pidIdx]) === String(periodLabel)) {
        toDel.push(i + 1);
      }
    }
    for (let i = toDel.length - 1; i >= 0; i--) sheet.deleteRow(toDel[i]);
  }

  if (rows && rows.length) {
    const newRows = rows.map(r => INVENTORY_COLS.map(c => {
      if (c === 'period_label') return periodLabel;
      if (c === 'store_id')     return storeId;
      if (c === 'remarks')      return remarks || '';
      if (c === 'updated_at')   return now;
      const v = r[c];
      return (v === undefined || v === null) ? '' : v;
    }));
    const startRow = sheet.getLastRow() + 1;
    // period_labelが"YYYY-MM"のまま日付型に自動変換されないよう、書き込み前にプレーンテキスト形式へ固定する
    sheet.getRange(startRow, INVENTORY_COLS.indexOf('period_label') + 1, newRows.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 1, newRows.length, INVENTORY_COLS.length).setValues(newRows);
  }
  return { ok: true };
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

// INVENTORY_COLSに新規列（anomaly_note、daily_count/matchedなど）を追加した際のワンショット移行用。
// ensureHeadersは空シートにしか列を作らないため、既存の運用中「棚卸集計」シートには手動で一度叩く必要がある
// （migrateOrderColumnsと同じパターン。既存列・データには一切触れない、何度実行しても安全。
// INVENTORY_COLSとの差分を見て不足分だけ末尾に足すので、今後列を追加してもこの関数自体は変更不要）
function migrateInventoryColumns() {
  const sheet = getInventorySheet();
  if (sheet.getLastRow() === 0) { ensureHeaders(sheet, INVENTORY_COLS); return { ok: true, added: INVENTORY_COLS }; }
  const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const missing = INVENTORY_COLS.filter(c => hdrs.indexOf(c) < 0);
  if (missing.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
  }
  return { ok: true, added: missing };
}

// 処分数量(disposed_qty)が入力されている行をスプレッドシート上で目立たせる条件付き書式を設定する。
// 範囲ベースのルールとして設定するため一度実行すればよく、以降saveInventorySnapshotが行を
// 削除・追記してもルールは自動的に効き続ける（migrateInventoryColumnsと同じ「一度だけ叩く」運用）。
// ?action=setupInventoryDisposedHighlight で実行する。migrateInventoryColumnsで
// disposed_qty列を追加済みであること（列が無ければエラーを返す）。
function setupInventoryDisposedHighlight() {
  const sheet = getInventorySheet();
  const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const colIdx = hdrs.indexOf('disposed_qty');
  if (colIdx < 0) return { error: 'disposed_qty列が見つかりません。先にmigrateInventoryColumnsを実行してください' };
  const colLetter = String.fromCharCode(65 + colIdx);
  const numRows = 5000; // 想定データ行数に余裕を持たせた固定値（将来これを超える見込みなら数値を増やして再実行）
  const range = sheet.getRange(2, 1, numRows, hdrs.length);
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
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, image_url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800', file_id: file.getId() };
}

function saveImageToDrive(base64, mimeType, filename) {
  const folder = DriveApp.getFolderById(IMAGE_FOLDER_ID);
  const blob   = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, filename + '.jpg');
  const file   = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w800';
}

// ----------------------------------------------------------------
// LINE WORKS 通知
// ----------------------------------------------------------------

function notifyNewOrder_(storeId) {
  try {
    var area = '';
    for (var areaName in AREA_STORES) {
      if (AREA_STORES[areaName].indexOf(String(storeId)) >= 0) {
        area = areaName;
        break;
      }
    }
    var msg = area
      ? area + 'エリアにて発注依頼があります。'
      : '発注依頼があります。（店舗ID: ' + storeId + '）';
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

function getLineWorksAccessToken_() {
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
  return JSON.parse(res.getContentText()).access_token;
}

// channelIdOverrideを渡すとそのチャンネルへ、省略時は従来通りLW_CHANNEL_ID（発注等の既定チャンネル）へ送信する
function sendLineWorksNotification(message, channelIdOverride) {
  var props = PropertiesService.getScriptProperties();
  var botId     = props.getProperty('LW_BOT_ID');
  var channelId = channelIdOverride || props.getProperty('LW_CHANNEL_ID');
  var token = getLineWorksAccessToken_();
  var url = 'https://www.worksapis.com/v1.0/bots/' + botId + '/channels/' + channelId + '/messages';
  var body = JSON.stringify({content: {type: 'text', text: message}});
  UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    payload: body
  });
}

function testLineWorksNotification() {
  sendLineWorksNotification('【テスト】LINE WORKS通知の接続テストです。');
}

// 業務開始（未打刻/GPS要確認/休み申請）の通知は発注とは別のLINE WORKSグループへ送る。
// さらにnotifyNewOrder_/sendDailyOrderNotificationと同様、東海/関西/関東のエリアごとに
// 別グループへ振り分ける。スクリプトプロパティに各エリアのチャンネルIDを設定して使う:
//   LW_CHANNEL_ID_ATTENDANCE_TOKAI / _KANSAI / _KANTO
// エリア別が未設定の間はLW_CHANNEL_ID_ATTENDANCE（業務開始共通チャンネル）、
// それも未設定なら従来の発注用チャンネル(LW_CHANNEL_ID)にフォールバックする。
const ATTENDANCE_AREA_CHANNEL_PROP_ = { '東海': 'LW_CHANNEL_ID_ATTENDANCE_TOKAI', '関西': 'LW_CHANNEL_ID_ATTENDANCE_KANSAI', '関東': 'LW_CHANNEL_ID_ATTENDANCE_KANTO' };
function _areaForStore_(storeId) {
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

function testAttendanceLineWorksNotification() {
  sendLineWorksNotification('【テスト】業務開始通知グループの接続テストです。', _attendanceLineWorksChannel_(null));
}

function testNotify() {
  notifyNewOrder_('shibuya');
}

function sendDailyOrderNotification() {
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
    if (AREA_STORES['東海'].indexOf(storeId) >= 0) hasTokai = true;
    if (AREA_STORES['関西'].indexOf(storeId) >= 0) hasKansai = true;
    if (AREA_STORES['関東'].indexOf(storeId) >= 0) hasKanto = true;
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

  const now = new Date();
  const monthLabel = Utilities.formatDate(now, _sheetTz(), 'yyyy-MM');
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const cutoffStr = (yesterdayDate.getMonth() === now.getMonth())
    ? Utilities.formatDate(yesterdayDate, _sheetTz(), 'yyyy-MM-dd') : null;

  const attendanceRows = getAttendance(); // 全店舗分をまとめて1回だけ取得
  const leaveRows = getLeaveRequests();

  // notifyNewOrder_/sendDailyOrderNotificationと同様、店舗のエリア（東海/関西/関東）ごとに
  // 行を振り分け、エリア単位で別々のLINE WORKSグループへ送る（エリア不明の店舗は別枠にまとめる）
  const linesByArea = {}; // { areaKey: { underTarget: [...], newLeave: [...] } }
  const bucketFor = storeId => {
    const area = _areaForStore_(storeId) || '(エリア未設定)';
    if (!linesByArea[area]) linesByArea[area] = { underTarget: [], newLeave: [] };
    return linesByArea[area];
  };

  enabledStores.forEach(storeId => {
    const names = staffMap[storeId] || [];
    const storeScheduleMap = scheduleMap[storeId] || {};
    names.forEach(name => {
      const schedule = storeScheduleMap[name] || { type: 'interval', intervalDays: 1 };
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
        bucketFor(storeId).underTarget.push('・店舗ID:' + storeId + ' ' + (name || '(未登録名)') + '（実績' + actualDays + '/目標' + target + '日）');
      }
    });
  });

  // 前日中に新規申請された休み申請一覧（休む日自体は問わず、"申請された"タイミングが前日のもの）
  leaveRows
    .filter(r => String(r.submitted_at || '').slice(0, 10) === cutoffStr)
    .forEach(r => {
      bucketFor(r.store_id).newLeave.push('・店舗ID:' + r.store_id + ' ' + (r.name || '(未登録名)') + '：' + r.leave_date + 'に休み申請');
    });

  Object.keys(linesByArea).forEach(area => {
    const b = linesByArea[area];
    if (!b.underTarget.length && !b.newLeave.length) return;
    let msg = '【' + area + '】\n';
    if (b.underTarget.length) msg += '【未打刻確認】ペースを下回っている担当者:\n' + b.underTarget.join('\n');
    if (b.newLeave.length) msg += (b.underTarget.length ? '\n\n' : '') + '【休み申請（前日分の新着）】\n' + b.newLeave.join('\n');
    const channel = area === '(エリア未設定)' ? _attendanceChannelForArea_(null) : _attendanceChannelForArea_(area);
    sendLineWorksNotification(msg, channel);
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
