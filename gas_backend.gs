// ============================================================
// セルフカフェ社内ポータル - Google Apps Script バックエンド
// ============================================================
// 【設定】デプロイ前に以下2行を入力してください
const SHEET_ID        = '';  // GoogleスプレッドシートのID
const IMAGE_FOLDER_ID = '1adg7TQIYXSkWIo19ohVo93raDY2HsTW_';  // 画像保存用DriveフォルダのID

const SHEET_ORDERS     = 'orders';
const SHEET_SETTINGS   = 'app_settings';
const SHEET_LOST       = 'lost_items';
const SHEET_CHECKSHEET = 'checksheet_data';

const ORDER_COLS = [
  'id','store_id','group_id','product','label','qty','unit',
  'case_unit','note','locked','is_new','request_date','order_date',
  'delivery_date','created_at','denied','image_url'
];
const LOST_COLS = ['id','store_id','found_date','note','image_url','added_at'];
// 店舗×年月で1行、その月の日別データはJSON文字列として1セルに保存する
// （日ごと・項目ごとに行を分けると増え続けて管理しづらいため、月単位でまとめる）
const CHECKSHEET_COLS = ['store_id','period_label','data','updated_at'];

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
    else if (b.action === 'saveSetting')        result = saveSetting(b.key, b.value);
    else if (b.action === 'saveLostItem')       result = saveLostItem(b.item, b.imageBase64, b.imageMime);
    else if (b.action === 'deleteLostItem')     result = deleteLostItem(b.id, b.imageUrl);
    else if (b.action === 'saveOrderImage')     result = saveOrderImage(b.imageBase64, b.imageMime, b.filename);
    else if (b.action === 'saveChecksheetData') result = saveChecksheetData(b.storeId, b.periodLabel, b.data);
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
    unit:          r.unit          || null,
    case_unit:     r.case_unit     || null,
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

function setDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailyOrderNotification') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sendDailyOrderNotification').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone('Asia/Tokyo').create();
}
