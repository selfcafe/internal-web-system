// ============================================================
// セルフカフェ社内ポータル - Google Apps Script バックエンド
// ============================================================
// 【設定】デプロイ前に以下2行を入力してください
const SHEET_ID        = '';  // GoogleスプレッドシートのID
const IMAGE_FOLDER_ID = '1adg7TQIYXSkWIo19ohVo93raDY2HsTW_';  // 画像保存用DriveフォルダのID
// 棚卸完了の送信先（別Driveの「棚卸集計」スプレッドシート、この実行アカウントに編集権限で共有しておくこと）
const INVENTORY_SHEET_ID = '';  // 棚卸集計スプレッドシートのID
// 月初納品分など、アプリを通さず本部が直接手配・受領した納品を本部が手入力するスプレッドシート
// （棚卸集計とは別。この実行アカウントに編集権限で共有しておくこと。列は「期間ラベル/店舗ID/商品コード/数量」）
const MANUAL_DELIVERY_SHEET_ID = '';  // 手動納品入力スプレッドシートのID
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
const INVOICE_LOG_COLS = ['id', 'store_id', 'store_name', 'partner_id', 'period', 'amount', 'pdf_url', 'submitted_at'];

const ORDER_COLS = [
  'id','store_id','group_id','product','label','qty','actual_qty','unit',
  'case_unit','unit_mode','note','locked','is_new','request_date','order_date',
  'delivery_date','created_at','denied','image_url'
];
const LOST_COLS = ['id','store_id','found_date','note','image_url','added_at'];
// 店舗×年月で1行、その月の日別データはJSON文字列として1セルに保存する
// （日ごと・項目ごとに行を分けると増え続けて管理しづらいため、月単位でまとめる）
const CHECKSHEET_COLS = ['store_id','period_label','data','updated_at'];
// 店舗×年月×商品で1行。同じ店舗×年月で再送信した場合はその行を上書きする
const INVENTORY_COLS = ['period_label','store_id','code','product','label','open_stock','delivery','end_stock','consumption','disposed_qty','price','amount','remarks','updated_at'];

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
    else if (a === 'getInvoiceLog')             result = getInvoiceLog();
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
    else if (b.action === 'saveLostItem')       result = saveLostItem(b.item, b.imageBase64, b.imageMime);
    else if (b.action === 'deleteLostItem')     result = deleteLostItem(b.id, b.imageUrl);
    else if (b.action === 'saveOrderImage')     result = saveOrderImage(b.imageBase64, b.imageMime, b.filename);
    else if (b.action === 'saveChecksheetData') result = saveChecksheetData(b.storeId, b.periodLabel, b.data);
    else if (b.action === 'saveInventorySnapshot') result = saveInventorySnapshot(b.storeId, b.periodLabel, b.rows, b.remarks);
    else if (b.action === 'recordInventoryDelivery') result = recordInventoryDelivery(b.storeId, b.periodLabel, b.product, b.qty);
    else if (b.action === 'submitInvoice')       result = submitInvoice(b.payload);
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
      sheet.getRange(i + 1, vi + 1).setValue(value);
      return { ok: true };
    }
  }
  sheet.appendRow([key, value]);
  return { ok: true };
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
    if (imgUrl && String(imgUrl).includes('drive.google.com')) {
      try {
        const m = String(imgUrl).match(/[?&]id=([^&]+)/);
        if (m) DriveApp.getFileById(m[1]).setTrashed(true);
      } catch(e) {}
    }
    sheet.deleteRow(i + 1);
  }
}

function saveLostItem(item, imageBase64, imageMime) {
  const sheet = getSheet(SHEET_LOST);
  ensureHeaders(sheet, LOST_COLS);
  let imageUrl = item.image_url || null;
  if (imageBase64 && IMAGE_FOLDER_ID) {
    imageUrl = saveImageToDrive(imageBase64, imageMime || 'image/jpeg', item.id);
  }
  sheet.appendRow(LOST_COLS.map(c =>
    c === 'image_url' ? (imageUrl || '') : (item[c] === undefined || item[c] === null ? '' : item[c])
  ));
  return { ok: true, image_url: imageUrl };
}

function deleteLostItem(id, imageUrl) {
  const sheet = getSheet(SHEET_LOST);
  if (sheet.getLastRow() <= 1) return { ok: true };
  const data  = sheet.getDataRange().getValues();
  const idIdx = data[0].indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) { sheet.deleteRow(i + 1); break; }
  }
  if (imageUrl && imageUrl.includes('drive.google.com')) {
    try {
      const m = imageUrl.match(/[?&]id=([^&]+)/);
      if (m) DriveApp.getFileById(m[1]).setTrashed(true);
    } catch(e) {}
  }
  return { ok: true };
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

function sendLineWorksNotification(message) {
  var props = PropertiesService.getScriptProperties();
  var botId     = props.getProperty('LW_BOT_ID');
  var channelId = props.getProperty('LW_CHANNEL_ID');
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

  // 請求金額は端数切捨てが必須のため、クライアント値を信用せずサーバー側で再計算する
  const fullAmount = Number(p.fullAmount || 0);
  const baseDays   = Number(p.baseDays || 0);
  const actualDays = Number(p.actualDays || 0);
  const dayRateAmount = baseDays > 0 ? Math.floor(fullAmount / baseDays * actualDays) : 0;
  const otherItems = (p.otherItems || []).filter(it => it && Number(it.amount) > 0);
  const otherTotal = otherItems.reduce((s, it) => s + Math.floor(Number(it.amount)), 0);
  const grandTotal = dayRateAmount + otherTotal;

  const fileBaseName = (p.storeName || p.storeId || 'invoice') + '_' + (p.invoiceDate || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM'));

  const folder   = DriveApp.getFolderById(INVOICE_PDF_FOLDER_ID);
  const copyFile = DriveApp.getFileById(INVOICE_TEMPLATE_ID).makeCopy(fileBaseName + '_作業用', folder);
  const ss = SpreadsheetApp.openById(copyFile.getId());

  // セル座標確認用に残っている可能性のある「座標マップ」タブは複製から取り除く
  const leftover = ss.getSheetByName('座標マップ');
  if (leftover) ss.deleteSheet(leftover);

  const sheet = ss.getSheets().find(s => s.getSheetId() === 1628780517) || ss.getSheets()[0];
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
  set(M.eraDay,   era.day   ? era.day   + '日' : ''); eraFont(M.eraDay);
  // 令和/年/月/日の間（P・Q・R・T列）の余白を詰める。Q列は明細の備考欄にも使われるが、
  // 日付行を優先し、備考の長文対策はフォントサイズの自動縮小側に任せる
  // R列・T列は「仕入/外注」の枠や明細の「確認印」「科目」列とも共有されているため、
  // 日付の余白調整のために狭めるのはやめる（他の箇所が狭まってしまうため）
  sheet.setColumnWidth(16, 20); // P列（純粋な余白。他の箇所と共有していない）
  sheet.setColumnWidth(17, 35); // Q列（「8年」の表示にも使うため、余白列ほどは狭めない）
  sheet.setColumnWidth(15, 70); // O列（明細の備考欄用。他の箇所と共有していない）
  // R・S・T・U列（仕入/外注チェック枠、明細の確認印/科目列、担当者/事務欄で共有）を揃える。
  // 「31日」が見切れないための拡幅もこの中で吸収する
  [18, 19, 20].forEach(col => sheet.setColumnWidth(col, 26)); // R・S・T列
  sheet.setColumnWidth(21, 40); // U列だけ「31日」が見切れないよう少し広め（対称性より正確な表示を優先）
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
  sheet.getRange(M.storeNameCell).setValue('セルフカフェ' + (p.storeName || '') + '店').setHorizontalAlignment('center');
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

  // 明細：1行目=日割り計算分、2行目以降=その他（緊急出動・現地購入等、複数行）
  const lines = [{ amount: dayRateAmount, note: p.dayRateNote || '' }].concat(
    otherItems.map(it => ({ amount: Math.floor(Number(it.amount)), note: it.note || '' }))
  );
  const maxRows = M.itemRowEnd - M.itemRowStart + 1;
  if (lines.length > maxRows) {
    return { error: '明細行が' + maxRows + '行を超えています（' + lines.length + '行）。その他の項目数を減らしてください。' };
  }
  lines.forEach((line, i) => {
    const row = M.itemRowStart + i;
    setFit(M.itemCols.storeName + row, 'セルフカフェ' + (p.storeName || '') + '店');
    sheet.getRange(M.itemCols.storeName + row).setHorizontalAlignment('center');
    sheet.getRange(M.itemCols.storeCode + row).setValue(p.storeCode || p.storeId || '').setHorizontalAlignment('center');
    // 担当者欄は幅が狭く、6文字程度でも折り返してしまうため、折り返しを禁止した上で小さめの固定サイズにする
    sheet.getRange(M.itemCols.staff + row).setValue(p.partnerName || '').setFontSize(8).setWrap(false);
    sheet.getRange(M.itemCols.amount    + row).setValue(line.amount).setNumberFormat(INVOICE_YEN_FORMAT).setHorizontalAlignment('center');
    setFit(M.itemCols.note + row, line.note, true);
    sheet.getRange(M.itemCols.category  + row).setValue('');
  });
  set(M.grandTotal, grandTotal);

  // 金額セルの表示形式をテンプレートの書式ゆれに関わらず統一する
  [M.claimTotalIncl, M.claimTotalExcl, M.claimTax, M.payTotalIncl, M.payTotalExcl, M.payTax, M.grandTotal]
    .forEach(a1 => sheet.getRange(a1).setNumberFormat(INVOICE_YEN_FORMAT));

  SpreadsheetApp.flush();

  // PDFエクスポート（対象シートのgidを指定。scale=4で縦横とも1ページに収める）
  // 印刷範囲をA1:U41に明示的に絞り、V列以降の空列が印刷範囲に含まれて右側に余白ができるのを防ぐ
  const token = ScriptApp.getOAuthToken();
  const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export'
    + '?format=pdf&gid=' + sheet.getSheetId()
    + '&size=A4&portrait=true&scale=4&gridlines=false&printtitle=false&sheetnames=false'
    + '&top_margin=0.3&bottom_margin=0.3&left_margin=0.3&right_margin=0.3'
    + '&r1=0&r2=41&c1=0&c2=21';
  const pdfResp = UrlFetchApp.fetch(exportUrl, { headers: { Authorization: 'Bearer ' + token } });
  const pdfBlob = pdfResp.getBlob().setName(fileBaseName + '.pdf');
  const pdfFile = folder.createFile(pdfBlob);

  // 【デバッグのため一時的に無効化】PDF表示崩れの原因をセル自体で確認するため、
  // 中間生成物のシートコピーを当面は削除せず残す。原因特定後にtrashedへ戻すこと。
  // copyFile.setTrashed(true);

  appendInvoiceLog({
    storeId: p.storeId, storeName: p.storeName, partnerId: p.partnerId || p.storeId,
    period: String(p.invoiceDate || '').slice(0, 6),
    amount: grandTotal, pdfUrl: pdfFile.getUrl(),
  });

  return { ok: true, pdfUrl: pdfFile.getUrl(), grandTotal: grandTotal };
}

// ----------------------------------------------------------------
// 請求提出履歴（管理者の「請求一覧」画面用）
// ----------------------------------------------------------------

function appendInvoiceLog(entry) {
  const sheet = getSheet(SHEET_INVOICE_LOG);
  ensureHeaders(sheet, INVOICE_LOG_COLS);
  // periodは'YYYYMMDD'形式のinvoiceDateから先頭6桁を受け取る想定なので、'YYYY-MM'に整形する
  const period = /^\d{6}$/.test(entry.period) ? entry.period.slice(0, 4) + '-' + entry.period.slice(4, 6) : entry.period;
  sheet.appendRow([
    Utilities.getUuid(), entry.storeId, entry.storeName, entry.partnerId,
    period, entry.amount, entry.pdfUrl, new Date().toISOString(),
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
