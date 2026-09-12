// 棚卸集計スプレッドシート(INVENTORY_SHEET_ID)の「1年ごとに新ファイルへ切り替える」運用が
// 壊れていないかを検証するシミュレーション。gas_backend.gs本体をNodeのvmモジュールへそのまま
// ロードし(コピー・再実装ではなく実物のコードを実行する)、SpreadsheetApp/CacheService/
// Utilities/現在時刻だけを最小限モックした上で、実際の関数を直接呼び出して数値を検算する。
//
// 実行方法: node scripts/test_year_boundary_sim.js
// (追加の依存packageは不要、Node標準の vm/fs のみ使用)
//
// 🔁 いつ実行するか: gas_backend.gsに「INVENTORY_SHEET_ID配下の新しいシート/periodLabelや
// 日付範囲でデータを引く新機能」を追加・変更した後は、必ずこのテストを実行して(必要なら
// 新しいcheck()を足して)年またぎでも壊れないことを確認してから本番デプロイすること。
// 何を確認すべきかのチェックリストはgas_backend.gsのINVENTORY_SHEET_ID_ARCHIVE宣言直後の
// コメントを参照(🔁年またぎ対応チェックリスト、2026-09-12)。
//
// 検証シナリオの概要(詳しくは各checkのコメント参照):
//   ①既存店舗(shibuya)が旧年ファイルに確定データを持ち、新年ファイルにはまだ何も送信して
//     いない状態で、期首在庫・理論在庫・在庫差異検知・月次バックストップ・全店舗棚卸集計が
//     正しく旧ファイルへフォールバック/書き込みされるか
//   ②新規店舗(旧年ファイルには一切データが存在しない店舗)が、エラーにならず・無駄な
//     アーカイブ読み取りもせず安全に動作するか
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_PATH = path.join(__dirname, '..', 'gas_backend.gs');
let src = fs.readFileSync(SRC_PATH, 'utf8');

// --- 実IDプレースホルダーを検証用の疑似IDへ置換(実IDは触らない、あくまでメモリ上のコピー) ---
src = src.replace("const SHEET_ID        = '';", "const SHEET_ID        = 'FILE_MAIN';");
src = src.replace("const INVENTORY_SHEET_ID = '';", "const INVENTORY_SHEET_ID = 'FILE_2027';");
src = src.replace(
  /const INVENTORY_SHEET_ID_ARCHIVE = \{[\s\S]*?\n\};/,
  "const INVENTORY_SHEET_ID_ARCHIVE = { '2026': 'FILE_2026' };"
);

if (!src.includes("INVENTORY_SHEET_ID = 'FILE_2027'")) throw new Error('INVENTORY_SHEET_ID置換に失敗(gas_backend.gsの該当行の書式が変わった?)');
if (!src.includes("'2026': 'FILE_2026'")) throw new Error('ARCHIVE置換に失敗(INVENTORY_SHEET_ID_ARCHIVEの書式が変わった?)');

// --- モック: Sheet/Spreadsheet/SpreadsheetApp ---
class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(rowArr[this.col - 1 + c] !== undefined ? rowArr[this.col - 1 + c] : '');
      out.push(line);
    }
    return out;
  }
  setValues(vals) {
    for (let r = 0; r < vals.length; r++) {
      const rIdx = this.row - 1 + r;
      if (!this.sheet.rows[rIdx]) this.sheet.rows[rIdx] = [];
      for (let c = 0; c < vals[r].length; c++) this.sheet.rows[rIdx][this.col - 1 + c] = vals[r][c];
    }
    return this;
  }
  getValue() {
    const r = this.sheet.rows[this.row - 1] || [];
    return r[this.col - 1] !== undefined ? r[this.col - 1] : '';
  }
  setValue(v) {
    if (!this.sheet.rows[this.row - 1]) this.sheet.rows[this.row - 1] = [];
    this.sheet.rows[this.row - 1][this.col - 1] = v;
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const rIdx = this.row - 1 + r;
      if (this.sheet.rows[rIdx]) for (let c = 0; c < this.numCols; c++) this.sheet.rows[rIdx][this.col - 1 + c] = '';
    }
    return this;
  }
  // 見た目専用のno-opメソッド群(計算結果には影響しない)
  setNumberFormat() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setBackground() { return this; }
  setBackgrounds() { return this; }
  setFontWeight() { return this; }
  setFontStyle() { return this; }
  setFontColor() { return this; }
  setFormula() { return this; }
  merge() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getDataRange() { return new Range(this, 1, 1, this.rows.length, this.getLastColumn()); }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows || 1, numCols || 1); }
  appendRow(arr) { this.rows.push(arr.slice()); return this; }
  deleteRows(start, num) { this.rows.splice(start - 1, num); }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  insertRowsBefore(before, num) { const blanks = Array.from({ length: num }, () => []); this.rows.splice(before - 1, 0, ...blanks); }
  clearContents() { this.rows = []; }
  clearConditionalFormatRules() {}
  getSheetId() { return 0; }
  setTabColor() { return this; }
}
class Spreadsheet {
  constructor(id) { this.id = id; this.sheets = {}; this.tz = 'Asia/Tokyo'; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) {
    if (this.sheets[name]) throw new Error(`シート名は既に存在しています: ${name}`);
    const s = new Sheet(name);
    this.sheets[name] = s;
    return s;
  }
  getSpreadsheetTimeZone() { return this.tz; }
  getSheets() { return Object.values(this.sheets); }
}
const FILES = {};
const openByIdCounts = {}; // ファイルIDごとの実際のopenById呼び出し回数(無駄な読み取りが無いか検証用)
const SpreadsheetApp = {
  openById(id) {
    openByIdCounts[id] = (openByIdCounts[id] || 0) + 1;
    if (!FILES[id]) FILES[id] = new Spreadsheet(id);
    return FILES[id];
  },
};

class ScriptCache {
  constructor() { this.map = new Map(); }
  get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  put(k, v) { this.map.set(k, v); }
  remove(k) { this.map.delete(k); }
}
const cacheInstance = new ScriptCache();
const CacheService = { getScriptCache: () => cacheInstance };

// --- Utilities.formatDate/parseCsvの最小モック ---
// tz==='UTC'指定の呼び出し(_lastDayOfPeriod_/_steraBusinessDateFromDateTime_、Date.UTCで組み立てた
// 日時を明示的にUTCとして書式化する箇所)はUTC getterで、それ以外(_invSheetTz()='Asia/Tokyo'を渡す
// 呼び出し)はローカルgetterで計算する。実行マシンのローカルTZがAsia/Tokyoである前提
// (本番Apps Scriptの実行タイムゾーン・対象スプレッドシートのタイムゾーンと同じ)。
// もしこのマシンのTZがAsia/Tokyo以外の場合、`TZ=Asia/Tokyo node scripts/test_year_boundary_sim.js`
// のように環境変数で明示してから実行すること。
const Utilities = {
  formatDate(date, tz, fmt) {
    const useUTC = tz === 'UTC';
    const y = useUTC ? date.getUTCFullYear() : date.getFullYear();
    const mo = (useUTC ? date.getUTCMonth() : date.getMonth()) + 1;
    const d = useUTC ? date.getUTCDate() : date.getDate();
    const hh = useUTC ? date.getUTCHours() : date.getHours();
    const mm = useUTC ? date.getUTCMinutes() : date.getMinutes();
    const ss = useUTC ? date.getUTCSeconds() : date.getSeconds();
    const pad = n => String(n).padStart(2, '0');
    if (fmt === 'yyyy-MM') return `${y}-${pad(mo)}`;
    if (fmt === 'yyyy-MM-dd') return `${y}-${pad(mo)}-${pad(d)}`;
    if (fmt === "yyyy-MM-dd'T'HH:mm:ss") return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
    if (fmt === 'yyyy-MM-dd HH:mm:ss') return `${y}-${pad(mo)}-${pad(d)} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
    return date.toISOString();
  },
  parseCsv(text) { return text.split('\n').filter(l => l.length).map(l => l.split(',')); },
};

// --- "現在時刻"を固定するDateモック(instanceof Date整合性を保つため実Dateをラップして返す) ---
const RealDate = Date;
const FIXED_NOW = RealDate.UTC(2027, 0, 3, 9, 0, 0); // 2027-01-03T09:00:00Z (JSTでは同日18:00)
function MockDate(...args) {
  if (args.length === 0) return new RealDate(FIXED_NOW);
  return new RealDate(...args);
}
MockDate.now = () => FIXED_NOW;
MockDate.UTC = RealDate.UTC;
MockDate.parse = RealDate.parse;
MockDate.prototype = RealDate.prototype;

const sandbox = { console, SpreadsheetApp, CacheService, Utilities, Date: MockDate };
const context = vm.createContext(sandbox);
vm.runInContext(src, context, { filename: 'gas_backend.gs' });

// --- テストデータの投入(直接rowsへpushして「既に書き込まれている過去データ」を再現) ---
function seedSheet(fileId, sheetName, header, rows) {
  const ss = SpreadsheetApp.openById(fileId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.rows = [header, ...rows];
  return sheet;
}

// FILE_2026 (旧年ファイル): shibuyaの2026-12分棚卸確定済み(水 期末在庫70)
seedSheet('FILE_2026', 'inventory_log',
  ['period_label','store_id','code','product','open_stock','delivery','end_stock','consumption','disposed_qty','price','amount','remarks','updated_at','anomaly_note','daily_count','matched','store_type'],
  [['2026-12','shibuya','STE001','水',100,0,70,30,0,100,'','','2026-12-31T10:00:00','','','','直営']]
);
// FILE_2026: 12/28(sinceDate以前、対象外になるはず)と12/31(sinceDate当日、対象外になるはず)の売上
seedSheet('FILE_2026', 'stera_daily_sales', ['date','store_id','prd_id','qty','amount'], [
  ['2026-12-29','shibuya','prd_223df30ea1f511d1df19c6c',5,500],
  ['2026-12-31','shibuya','prd_223df30ea1f511d1df19c6c',8,800],
]);
// FILE_2026: 12/28の納品(sinceDate以前、対象外になるはず)
seedSheet('FILE_2026', 'inventory_delivery_auto', ['period_label','store_id','product','qty','recorded_at'], [
  ['2026-12','shibuya','水',99,'2026-12-28T09:00:00'],
]);
// FILE_2026: 12/31時点のチェックポイント(実売上8のうち6まではその日のうちに繰越登録済み、
// 残り2個が「打ち切られた残り」としてcarryOverで回収されるべき)
seedSheet('FILE_2026', 'stock_mismatch_checkpoint', ['store_id','prd_id','checkpoint_date','checkpoint_qty'], [
  ['shibuya','prd_223df30ea1f511d1df19c6c','2026-12-31',6],
]);

// FILE_2027 (新年ファイル、rollover後): shibuyaはまだ2027年分の棚卸を1件も送信していない
// (inventory_logタブ自体は意図的に作らない=空)。
// 1/1・1/2の売上、1/2の納品、1/3(今日)の速報値だけが存在する状態を再現
seedSheet('FILE_2027', 'stera_daily_sales', ['date','store_id','prd_id','qty','amount'], [
  ['2027-01-01','shibuya','prd_223df30ea1f511d1df19c6c',3,300],
  ['2027-01-02','shibuya','prd_223df30ea1f511d1df19c6c',4,400],
]);
seedSheet('FILE_2027', 'inventory_delivery_auto', ['period_label','store_id','product','qty','recorded_at'], [
  ['2027-01','shibuya','水',10,'2027-01-02T09:00:00'],
]);
seedSheet('FILE_2027', 'stera_realtime_today', ['date','store_id','prd_id','qty','updated_at'], [
  ['2027-01-03','shibuya','prd_223df30ea1f511d1df19c6c',2,'2027-01-03T09:00:00'],
]);
// FILE_2027: stock_mismatch_checkpointは空のまま(新ファイルには何も無い状態を再現)

// FILE_MAIN: checksheet_data (前回入力12/31・今回入力1/3)
seedSheet('FILE_MAIN', 'checksheet_data', ['store_id','period_label','data','updated_at'], [
  ['shibuya','2026-12', JSON.stringify({ '2026-12-31': { 'prod:水': 20 } }), '2026-12-31T10:00:00'],
  ['shibuya','2027-01', JSON.stringify({ '2027-01-03': { 'prod:水': 15 } }), '2027-01-03T09:00:00'],
]);
// FILE_MAIN: app_settings(all_products) — buildInventoryRollupのカテゴリ分類(_rollupCategoryForProduct_)が
// vendorを見るため、水がvendor:'sales'であることを最小限セットしておく(無いと商品が原価率集計の
// 対象外に分類され、rollupの検証にならないため)
seedSheet('FILE_MAIN', 'app_settings', ['key','value'], [
  ['all_products', JSON.stringify([{ name: '水', vendor: 'sales' }])],
]);

// ================= 実行 & 検証 =================
const results = {};
const fails = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results[name] = { actual, expected, pass };
  if (!pass) fails.push(name);
}

// (a) 前期間参照: 現在(2027-01)から見て2026-12分をgetInventoryHistoryで取れるか(旧ファイルへのフォールバック)
const hist = context.getInventoryHistory('shibuya', '2026-12');
check('getInventoryHistory(2026-12)件数', hist.length, 1);
check('getInventoryHistory(2026-12) end_stock', hist[0] && Number(hist[0].end_stock), 70);

// 対照実験: 現在ファイル(2027)側に本当にデータが無い期間を聞いても、archiveへは飛ばず空で返るはず
const histCurrentEmpty = context.getInventoryHistory('shibuya', '2027-01');
check('getInventoryHistory(2027-01、現行ファイルに未送信)件数', histCurrentEmpty.length, 0);

// (b) 発注提案の年またぎフォールバック
const latestCons = context.getLatestConsumptionByCode('shibuya');
check('getLatestConsumptionByCode(年またぎフォールバック)', latestCons, { STE001: 30 });

// (c) 理論在庫(getSteraStockEstimate) 手計算: 70(確定期末) + 10(1/2納品) - 7(1/1+1/2実売上) - 2(本日速報) = 71
const estimate = context.getSteraStockEstimate('shibuya');
check('getSteraStockEstimate 水', estimate['水'], 71);

// (d) 水の在庫差異検知(checkWaterStockMismatch)
// 手計算: inputQty=15(1/3分のみ、sinceDate=12/31より後は1/3だけ)
//        carryOver=8(12/31実売上確定値)-6(チェックポイント)=2
//        rangeQty=3(1/1)+4(1/2)=7 ※12/29,12/31はsinceDate以前/当日なので対象外
//        todayRealtimeQty=2
//        steraQty=2+7+2=11、diff=15-11=4
const waterCheck = context.checkWaterStockMismatch('shibuya', '水');
check('checkWaterStockMismatch sinceDate', waterCheck.sinceDate, '2026-12-31');
check('checkWaterStockMismatch inputQty', waterCheck.inputQty, 15);
check('checkWaterStockMismatch carryOver', waterCheck.carryOver, 2);
check('checkWaterStockMismatch steraQty', waterCheck.steraQty, 11);
check('checkWaterStockMismatch diff', waterCheck.diff, 4);

// (e) buildStockCheckMonthlyが正しく「旧ファイル(FILE_2026)」のshibuyaタブに書き込むか
const stockCheckResult = context.buildStockCheckMonthly('shibuya', '2026-12');
check('buildStockCheckMonthly ok', stockCheckResult.ok, true);
const wroteToOldFile = !!FILES['FILE_2026'].getSheetByName('shibuya');
const wroteToNewFileToo = !!FILES['FILE_2027'].getSheetByName('shibuya');
check('buildStockCheckMonthly: 旧ファイルにshibuyaタブができた', wroteToOldFile, true);
check('buildStockCheckMonthly: 新ファイルには作られていない', wroteToNewFileToo, false);

// (f) runMonthlyStockCheckBackstop: "今日"が2027-01-03なので前月=2026-12を対象に、
//     旧ファイルのshibuyaを見つけて処理できるか(periodLabel算出+書き込み先解決の両方を確認)
const backstop = context.runMonthlyStockCheckBackstop();
check('runMonthlyStockCheckBackstop period', backstop.period, '2026-12');
check('runMonthlyStockCheckBackstop stores件数', backstop.stores >= 1, true);
const backstopHitShibuya = backstop.results.some(r => r.storeId === 'shibuya' && r.ok);
check('runMonthlyStockCheckBackstop shibuyaを処理できた', backstopHitShibuya, true);

// (g) buildInventoryRollup: 2026-12分を旧ファイルに書き込めるか
const rollup = context.buildInventoryRollup('2026-12');
check('buildInventoryRollup ok', rollup.ok, true);
const rollupSheetOld = FILES['FILE_2026'].getSheetByName('全店舗棚卸集計');
const rollupSheetNew = FILES['FILE_2027'].getSheetByName('全店舗棚卸集計');
check('buildInventoryRollup: 旧ファイルに書かれた', !!rollupSheetOld && rollupSheetOld.getLastRow() > 1, true);
check('buildInventoryRollup: 新ファイルには書かれていない', !!rollupSheetNew, false);

// ============ (h) 新規店舗(2027年に初めて追加、旧ファイルには一切登場しない店舗) ============
// この店舗は旧ファイル(FILE_2026)のどのシートにも一切データが無い。棚卸未送信の間に
// getSteraStockEstimateを呼んでも安全に「null」を返し、かつ無駄にアーカイブファイルを
// 読みに行かない(パフォーマンス修正の確認)ことを検証する。
const NEW_STORE = 'newstore_2027';

// (h-1) 棚卸未送信の新規店舗: getLatestConsumptionByCodeは例外を投げず空を返す
const newStoreCons = context.getLatestConsumptionByCode(NEW_STORE);
check('新規店舗: getLatestConsumptionByCode', newStoreCons, {});

// (h-2) getSteraStockEstimateはエラーにならず、全商品nullを返す
const newStoreEstimateBefore = { ...openByIdCounts };
const newStoreEstimate = context.getSteraStockEstimate(NEW_STORE);
check('新規店舗: getSteraStockEstimate(水)がnull', newStoreEstimate['水'], null);
// 無駄な読み取りが無いことの確認: この呼び出しでFILE_2026(唯一のアーカイブ)のopenById回数が
// 増えていないこと(=latestByProductが空の時点で早期returnし、日次売上/納品を読みに行っていない)
const file2026OpensDuringCall = (openByIdCounts['FILE_2026'] || 0) - (newStoreEstimateBefore['FILE_2026'] || 0);
check('新規店舗: getSteraStockEstimateでFILE_2026への無駄な追加アクセスが無い', file2026OpensDuringCall, 0);

// (h-3) 新規店舗が2027-01分の棚卸を初めて送信 → 店舗タブが現行ファイル(FILE_2027)側に作られる
seedSheet('FILE_2027', 'inventory_log',
  ['period_label','store_id','code','product','open_stock','delivery','end_stock','consumption','disposed_qty','price','amount','remarks','updated_at','anomaly_note','daily_count','matched','store_type'],
  [['2027-01', NEW_STORE, 'STE099','麦茶','','',40,'',0,90,'','','2027-01-03T09:00:00','','','','直営']]
);
context._invalidateInventoryLogCache_ && context._invalidateInventoryLogCache_();
const newStoreBuild = context.buildStoreInventorySheet(NEW_STORE, '2027-01');
check('新規店舗: 初回棚卸で店舗タブ作成ok', newStoreBuild.ok, true);
check('新規店舗: 店舗タブは新ファイル側に作られる', !!FILES['FILE_2027'].getSheetByName(NEW_STORE), true);
check('新規店舗: 旧ファイル側には作られない', !!(FILES['FILE_2026'] && FILES['FILE_2026'].getSheetByName(NEW_STORE)), false);

// ============ (i) 前年最終期間の遅延送信(締めが翌月5日のため1/1〜1/5に起こりうる) ============
// 切り替え後(現行ファイル=FILE_2027)に、shibuyaが"2026-12"分の棚卸完了を再送信(訂正)した場合、
// saveInventorySnapshotがperiodLabelの年を見て正しく旧ファイル(FILE_2026)へ書き込むか検証する。
// 修正前は常に現行ファイルへ書いてしまい、getInventoryHistory('2026-12')(旧ファイルを見に行く)
// と食い違って迷子になるバグがあった(2026-09-12発見・修正)。
const straggler = context.saveInventorySnapshot('shibuya', '2026-12', [
  { code: 'STE001', product: '水', open_stock: 100, delivery: 0, end_stock: 65, consumption: 35, disposed_qty: 0, price: 100 },
], '1/3に遅れて訂正送信');
check('遅延送信: saveInventorySnapshot ok', straggler.ok, true);

const stragglerHist = context.getInventoryHistory('shibuya', '2026-12');
check('遅延送信: 旧ファイル側の読み取りに反映される(end_stock)', stragglerHist[0] && Number(stragglerHist[0].end_stock), 65);

// 新ファイル(FILE_2027)のinventory_logには"2026-12"のshibuya行が紛れ込んでいないこと
const newFileInvSheet = FILES['FILE_2027'].getSheetByName('inventory_log');
const leakedIntoNewFile = newFileInvSheet
  ? newFileInvSheet.rows.slice(1).some(r => String(r[0]) === '2026-12' && String(r[1]) === 'shibuya')
  : false;
check('遅延送信: 新ファイルに紛れ込んでいない', leakedIntoNewFile, false);

// 納品済みボタン(recordInventoryDelivery)も同様に旧ファイルへ書き込まれるか検証
// (FILE_2026には最初から'2026-12'期間の水99個の納品が種として入っている。今回5個を追加するので
// 合計104になるはず。旧ファイルへ正しく追記されていることの確認)
context.recordInventoryDelivery('shibuya', '2026-12', '水', 5);
const stragglerDelivery = context.getInventoryDeliveryAuto('shibuya', '2026-12');
check('遅延送信: 納品済みも旧ファイル経由で読み取れる(既存99+今回5)', stragglerDelivery['水'], 104);

// ================= 結果表示 =================
console.log('='.repeat(60));
Object.keys(results).forEach(name => {
  const r = results[name];
  console.log(`${r.pass ? '✅' : '❌'} ${name}: actual=${JSON.stringify(r.actual)} expected=${JSON.stringify(r.expected)}`);
});
console.log('='.repeat(60));
if (fails.length) {
  console.log(`FAILURES: ${fails.length}件 -> ${fails.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('ALL PASS');
}
