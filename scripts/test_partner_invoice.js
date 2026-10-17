// パートナー請求書の「下書きの計算」（gas_backend.gs 末尾のパートナー請求書ブロック）の検算。
// gas_backend.gs 本体をそのまま読み込み（コピー・再実装ではなく実物のコードを実行する）、
// 計算で使う Utilities.formatDate と SpreadsheetApp のタイムゾーンだけを最小限モックする。
//
// 実行方法: node scripts/test_partner_invoice.js
//   Node が無い PC では Python の mini-racer（pip install mini-racer）でも動く:
//   py -c "import os; from py_mini_racer import MiniRacer as M; r=M(); r.eval(open('scripts/test_partner_invoice.js',encoding='utf-8').read()); r.eval(open('gas_backend.gs',encoding='utf-8').read()); print(r.eval('runPartnerInvoiceTests()'), flush=True); os._exit(0)"
//   （このファイルを先に読み込んでモックを置き、次に gas_backend.gs、最後に runPartnerInvoiceTests() を呼ぶ。
//    Windows では終了時に mini-racer が止まることがあるので os._exit で抜ける。出力が cp932 で化けるときは PYTHONIOENCODING=utf-8）

// --- モック（gas_backend.gs を読み込む前に置く） ---
var Utilities = {
  formatDate: function (d, tz, fmt) {
    // テストは UTC だけで使う（_steraBusinessDateFromDateTime_ は 'UTC' 固定、_sheetTz はモックで 'UTC'）
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var s = fmt.replace('yyyy', d.getUTCFullYear()).replace('MM', p(d.getUTCMonth() + 1)).replace('dd', p(d.getUTCDate()))
      .replace('HH', p(d.getUTCHours())).replace('mm', p(d.getUTCMinutes())).replace('ss', p(d.getUTCSeconds()));
    return s;
  },
  getUuid: function () { return 'uuid'; },
};
var SpreadsheetApp = { openById: function () { return { getSpreadsheetTimeZone: function () { return 'UTC'; } }; } };
var CacheService = { getScriptCache: function () { return { get: function () { return null; }, put: function () {}, remove: function () {} }; } };

function runPartnerInvoiceTests() {
  var results = [], failed = 0;
  function check(name, actual, expected) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) results.push('OK  ' + name);
    else { failed++; results.push('NG  ' + name + '\n      期待: ' + e + '\n      実際: ' + a); }
  }

  // ① 基準日数
  check('基準日数: 予定なし＝月の日数（2026-09は30日）', invoiceBaseDays_(null, '2026-09'), 30);
  check('基準日数: 2日に1回＝31日の月は16日', invoiceBaseDays_({ type: 'interval', intervalDays: 2 }, '2026-10'), 16);
  check('基準日数: 曜日（月・木）2026-10 は 月4回＋木5回＝9日', invoiceBaseDays_({ type: 'weekday', weekdays: [1, 4] }, '2026-10'), 9);
  check('基準日数: 2月（2027-02 は28日）', invoiceBaseDays_(null, '2027-02'), 28);

  // ② 予定の引き方（sendMonthlyAttendanceCheck と同じ）
  var staffMap = { kouta: ['スタッフA', 'スタッフB'], sugamo: [] };
  var scheduleMap = { kouta: { 'スタッフB': { type: 'interval', intervalDays: 2 } } };
  var defMap = { sugamo: { type: 'interval', intervalDays: 2 } };
  check('予定: 名前の登録あり・予定あり', invoiceScheduleFor_('kouta', 'スタッフB', staffMap, scheduleMap, defMap), { type: 'interval', intervalDays: 2 });
  check('予定: 名前の登録あり・予定なし＝毎日', invoiceScheduleFor_('kouta', 'スタッフA', staffMap, scheduleMap, defMap), { type: 'interval', intervalDays: 1 });
  check('予定: 名前の登録なし＝店の既定', invoiceScheduleFor_('sugamo', '', staffMap, scheduleMap, defMap), { type: 'interval', intervalDays: 2 });
  check('予定: どちらも無い＝null', invoiceScheduleFor_('abeno', '', staffMap, scheduleMap, defMap), null);

  // ③ 出勤日（営業日 AM4:30 締め、同じ日は1日、範囲外・休み申請の印）
  var att = [
    { store_id: 'kouta', name: 'スタッフA', clocked_at: '2026-09-01 09:00:00', within_range: true },
    { store_id: 'kouta', name: 'スタッフA', clocked_at: '2026-09-01 15:00:00', within_range: false }, // 同じ日に2回 → 1日・範囲内
    { store_id: 'kouta', name: 'スタッフA', clocked_at: '2026-09-03 10:00:00', within_range: false }, // 範囲外だけの日
    { store_id: 'kouta', name: 'スタッフA', clocked_at: '2026-09-05 10:00:00', within_range: '' },    // 判定できない日は印なし
    { store_id: 'kouta', name: 'スタッフA', clocked_at: '2026-10-01 03:00:00', within_range: true },  // 10/1 3時＝9/30 の営業
    { store_id: 'kouta', name: 'スタッフA', clocked_at: '2026-09-01 02:00:00', within_range: true },  // 9/1 2時＝8/31 の営業（数えない）
    { store_id: 'kouta', name: 'スタッフB', clocked_at: '2026-09-02 10:00:00', within_range: true },  // 別の人
    { store_id: 'hara', name: 'スタッフA', clocked_at: '2026-09-02 10:00:00', within_range: true },   // 別の店
  ];
  var leaves = [{ store_id: 'kouta', name: 'スタッフA', leave_date: '2026-09-05' }];
  check('出勤日: 営業日で数え、同じ日は1日', invoiceAttendanceDays_(att, leaves, 'kouta', 'スタッフA', '2026-09'),
    { days: ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-30'], outOfRange: ['2026-09-03'], onLeave: ['2026-09-05'] });

  // ④ 日割り（切り捨て・上限は月額）
  check('日割り: 25,000円 31日中30日＝24,193円（切り捨て）', invoiceMonthlyAmount_(25000, 31, 30), 24193);
  check('日割り: 15,000円 30日中28日＝14,000円', invoiceMonthlyAmount_(15000, 30, 28), 14000);
  check('日割り: 基準日数を超えても月額まで', invoiceMonthlyAmount_(20000, 16, 20), 20000);
  check('日割り: 0日＝0円', invoiceMonthlyAmount_(30000, 30, 0), 0);

  // ⑤ 下書き（会社：複数店・複数担当者・回数×単価／個人：1店）
  var contracts = [
    { id: 'c1', payee_id: 'kurashi', store_id: 'hibino', staff_name: '', kind: 'monthly', amount: 33000, base_days_mode: 'schedule', from_month: '2026-04', to_month: '' },
    { id: 'c2', payee_id: 'kurashi', store_id: 'sakurayama', staff_name: '', kind: 'per_visit', amount: 2750, base_days_mode: '', from_month: '', to_month: '' },
    { id: 'c3', payee_id: 'kurashi', store_id: 'hara', staff_name: 'スタッフC', kind: 'monthly', amount: 33000, base_days_mode: 'calendar', from_month: '', to_month: '' },
    { id: 'c4', payee_id: 'kurashi', store_id: 'chikusa', staff_name: '', kind: 'monthly', amount: 33000, base_days_mode: '', from_month: '', to_month: '2026-08' }, // 8月で終了
    { id: 'c5', payee_id: 'kurashi', store_id: 'gokiso', staff_name: '', kind: 'monthly', amount: 33000, base_days_mode: 'fixed', base_days_fixed: 15, from_month: '', to_month: '' },
    { id: 'c9', payee_id: 'sato', store_id: 'kamejima', staff_name: '', kind: 'monthly', amount: 15000, base_days_mode: '', from_month: '', to_month: '' },
  ];
  var att2 = [];
  for (var d = 1; d <= 30; d++) att2.push({ store_id: 'hibino', name: '', clocked_at: '2026-09-' + (d < 10 ? '0' : '') + d + ' 09:00:00', within_range: true });
  ['03', '10', '17', '24', '30'].forEach(function (dd) { att2.push({ store_id: 'sakurayama', name: '', clocked_at: '2026-09-' + dd + ' 09:00:00', within_range: true }); });
  for (var d2 = 1; d2 <= 29; d2++) att2.push({ store_id: 'hara', name: 'スタッフC', clocked_at: '2026-09-' + (d2 < 10 ? '0' : '') + d2 + ' 09:00:00', within_range: true });
  for (var d3 = 1; d3 <= 15; d3++) att2.push({ store_id: 'gokiso', name: '', clocked_at: '2026-09-' + (d3 * 2 < 10 ? '0' : '') + (d3 * 2) + ' 09:00:00', within_range: true });
  for (var d4 = 1; d4 <= 28; d4++) att2.push({ store_id: 'kamejima', name: '', clocked_at: '2026-09-' + (d4 < 10 ? '0' : '') + d4 + ' 09:00:00', within_range: true });
  var data = {
    contracts: contracts, attendance: att2, leaves: [],
    staffMap: { hara: ['スタッフC'] }, scheduleMap: {}, storeDefaultScheduleMap: {},
    storeNames: { hibino: '日比野', sakurayama: '桜山', hara: '原', chikusa: '千種', gokiso: '御器所', kamejima: '亀島' },
    storeCodes: { hibino: 73, sakurayama: 38, hara: 89, chikusa: 33, gokiso: 34, kamejima: 64 },
  };
  var lines = buildInvoiceDraftLines_('kurashi', '2026-09', data);
  check('下書き(会社): 有効な契約だけ・店舗番号順', lines.map(function (l) { return l.store_code + ':' + l.store_name; }), ['34:御器所', '38:桜山', '73:日比野', '89:原']);
  check('下書き(会社): 金額', lines.map(function (l) { return l.amount; }), [33000, 13750, 33000, 31900]);
  check('下書き(会社): 桜山は回数×単価（2,750円×5回）', [lines[1].kind, lines[1].unit_price, lines[1].count], ['per_visit', 2750, 5]);
  check('下書き(会社): 原（スタッフC）は月の日数30日中29日', [lines[3].staff_name, lines[3].base_days, lines[3].days], ['スタッフC', 30, 29]);
  check('下書き(会社): 御器所は固定15日', [lines[0].base_days, lines[0].days], [15, 15]);
  var lines2 = buildInvoiceDraftLines_('sato', '2026-09', data);
  check('下書き(個人): 亀島 15,000円 30日中28日＝14,000円', lines2.map(function (l) { return l.amount; }), [14000]);

  // ⑥ 提出の計算し直し
  var sub = [
    { kind: 'monthly', contract_id: 'c5', days: 15 },
    { kind: 'per_visit', contract_id: 'c2', count: 5 },
    { kind: 'monthly', contract_id: 'c1', days: 30, amount: 999999 }, // 画面の金額は使わない
    { kind: 'monthly', contract_id: 'c3', days: 30, reason: '9/30 の打刻忘れ' },
    { kind: 'oneoff', store_id: 'meieki_nishi', store_name: '名駅西口', note: 'リフレッシュ清掃', amount: 7700 },
    { kind: 'expense', store_id: 'hara', store_name: '原', note: 'ペーパー置き', amount: 330, receipt: true },
    { kind: 'discount', note: 'ボリュームディスカウント', amount: 3300 },
  ];
  var r = recomputeInvoiceLines_(sub, lines);
  check('提出: エラーなし', r.errors, []);
  check('提出: 金額はサーバーで計算（原は30日に直して33,000円、値引きはマイナス）', r.lines.map(function (l) { return l.amount; }), [33000, 13750, 33000, 33000, 7700, 330, -3300]);
  check('提出: 合計', r.total, 117480);
  check('提出: 日数を直した行は要確認', r.flags, ['原（スタッフC） 日数を 29→30 に修正（理由: 9/30 の打刻忘れ）']);
  var bad = recomputeInvoiceLines_([
    { kind: 'monthly', contract_id: 'c5', days: 14 },          // 理由なしで日数を変更
    { kind: 'expense', note: 'ゴミ袋', amount: 2392 },          // 領収書なし
    { kind: 'oneoff', note: '', amount: 7700 },                 // 内容なし
    { kind: 'monthly', contract_id: 'zzz', days: 1 },           // 知らない契約
  ], lines);
  // 1行目（御器所）は理由なしのエラーを出したので「行がありません」は重ねない
  check('提出: 誤りを全部返す（抜けた契約の行も）', bad.errors, [
    '1行目: 打刻の日数（15日）と違うので理由を書いてください',
    '2行目: 経費は領収書の写真が必要です',
    '3行目: 内容を書いてください',
    '4行目: 契約が見つかりません',
    '桜山 の行がありません（請求しない月は日数・回数を0にしてください）',
    '日比野 の行がありません（請求しない月は日数・回数を0にしてください）',
    '原（スタッフC） の行がありません（請求しない月は日数・回数を0にしてください）',
  ]);

  results.push(failed ? ('失敗 ' + failed + ' 件') : 'すべて成功');
  return results.join('\n');
}

// Node で直接実行したとき
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var ctx = vm.createContext({ Utilities: Utilities, SpreadsheetApp: SpreadsheetApp, CacheService: CacheService, console: console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas_backend.gs'), 'utf8'), ctx, { filename: 'gas_backend.gs' });
  vm.runInContext(runPartnerInvoiceTests.toString(), ctx);
  var out = vm.runInContext('runPartnerInvoiceTests()', ctx);
  console.log(out);
  if (/失敗/.test(out)) process.exit(1);
}
