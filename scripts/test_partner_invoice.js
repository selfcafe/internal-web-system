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

  // ⑦ PDF づくり（シートを触らない部分）
  check('月フォルダ名: 9月分は10月支払', invoiceMonthFolderName_('2026-09'), '2026年9月利用分（10月支払）');
  check('月フォルダ名: 12月分は1月支払', invoiceMonthFolderName_('2026-12'), '2026年12月利用分（1月支払）');
  check('備考: 月額・回数・単発', [invoiceLineNote_(r.lines[2]), invoiceLineNote_(r.lines[1]), invoiceLineNote_(r.lines[4])], ['出勤30/30日', '2,750円×5回', 'リフレッシュ清掃']);
  var payee = { biz_code: '50000000', registration_no: 'T0000000000000', tax_exempt: false, name: 'テスト商事（架空）', address: 'テスト市1-2-3', tel: '000-0000-0000',
    bank_name: 'テスト銀行', bank_code: '0000', branch_name: '本店', branch_code: '000', account_type: '普', account_no: '0000000', account_kana: 'テスト' };
  var pg1 = invoicePages_(r.lines);
  check('ページ分け: 7行は1枚・店は経費や値引きを除かず店舗IDのある行で数える', [pg1.pages.length, pg1.storeNames], [1, ['御器所', '桜山', '日比野', '原', '名駅西口']]);
  var c1 = {}; invoiceSheetCells_(payee, '2026-09', pg1.pages[0], 1, 1, r.total, pg1.storeNames).forEach(function (c) { c1[c[0]] = c[1]; });
  check('セル(1枚): 作成日・合計・店舗欄・明細', [c1.O5, c1.R5, c1.T5, c1.C11, c1.B9, c1.A21, c1.C21, c1.K27, c1.Q7, c1.A41], ['令和8', 9, 30, 117480, 'セルフカフェ　5店舗', '34', 'セルフカフェ御器所店', -3300, '□', undefined]);
  var many = []; for (var k = 0; k < 23; k++) many.push({ kind: 'oneoff', store_id: 's' + k, store_name: '店' + k, note: '作業', amount: 1000 });
  var pg2 = invoicePages_(many);
  var c2 = {}; invoiceSheetCells_(payee, '2026-09', pg2.pages[1], 2, 2, 23000, pg2.storeNames).forEach(function (c) { c2[c[0]] = c[1]; });
  var c2a = {}; invoiceSheetCells_(payee, '2026-09', pg2.pages[0], 1, 2, 23000, pg2.storeNames).forEach(function (c) { c2a[c[0]] = c[1]; });
  check('セル(2枚): 20行＋3行、最後のページに合計', [pg2.pages.length, pg2.pages[1].length, c2.A41, c2.K41, c2.A24, c2.G3], [2, 3, '合計金額', 23000, '', '請　　求　　書（2/2）']);
  check('セル(2枚): 1枚目は小計', [c2a.A41, c2a.K41], ['小計（1/2）', undefined]);
  var c3 = {}; invoiceSheetCells_(Object.assign({}, payee, { tax_exempt: 'TRUE', registration_no: '' }), '2026-09', [lines2[0]], 1, 1, 14000, ['亀島']).forEach(function (c) { c3[c[0]] = c[1]; });
  check('セル: 課税事業者でない＝■、1店は店名', [c3.Q7, c3.L7, c3.B9], ['■', '', 'セルフカフェ　亀島店']);

  // ⑧ 画面の窓口（シートを触らない部分）
  check('提出できる月: 10/17 なら 9・8・7月', invoiceAllowedPeriods_(new Date(2026, 9, 17)), ['2026-09', '2026-08', '2026-07']);
  check('提出できる月: 1月なら前年12・11・10月', invoiceAllowedPeriods_(new Date(2027, 0, 5)), ['2026-12', '2026-11', '2026-10']);
  check('初回登録: 正しい内容は誤りなし', invoiceValidateProfile_(payee), []);
  check('初回登録: 免税なら登録番号は空', invoiceValidateProfile_(Object.assign({}, payee, { tax_exempt: true, registration_no: '' })), []);
  check('初回登録: 誤りを全部返す（口座は登録しない運用なので確かめない）', invoiceValidateProfile_({ name: '', address: 'x', tel: '12', registration_no: 'T123', bank_name: '', account_no: 'abc' }), [
    '社名（お名前）を入れてください', '電話番号を正しく入れてください', '登録番号は T と13桁の数字で入れてください（無い場合は「課税事業者ではない」にチェック）']);
  check('初回登録: 口座が空でも登録できる', invoiceValidateProfile_(Object.assign({}, payee, { bank_name: '', bank_code: '', branch_name: '', branch_code: '', account_type: '', account_no: '', account_kana: '' })), []);
  var cb = {}; invoiceSheetCells_(Object.assign({}, payee, { account_no: '', account_type: '' }), '2026-09', [], 1, 1, 0, []).forEach(function (c) { cb[c[0]] = c[1]; });
  check('PDF: 口座が空なら口座欄（普・番号）も空', [cb.L17, cb.M17, cb.N13], ['', '', 'テスト銀行']);
  var m = invoiceMaskPayee_(Object.assign({}, payee, { address: '名古屋市テスト区1-2-3', account_no: '1234567', tel: '090-1234-5678' }));
  check('伏せ字: 口座・電話・住所は一部だけ', [m.account_no, m.tel, m.address, m.profile_complete], ['＊＊＊＊567', '＊＊＊＊5678', '名古屋市テス…', true]);

  // ⑨ 管理者の契約の確認
  check('契約: 月額・打刻の予定は誤りなし', invoiceValidateContract_({ payee_id: 'p1', store_id: 'hara', kind: 'monthly', amount: 33000, base_days_mode: 'schedule', from_month: '2026-10', to_month: '' }), []);
  check('契約: 回数×単価は誤りなし', invoiceValidateContract_({ payee_id: 'p1', store_id: 'sakurayama', kind: 'per_visit', amount: 2750 }), []);
  check('契約: 誤りを全部返す', invoiceValidateContract_({ payee_id: 'p1', store_id: '', kind: 'monthly', amount: 0, base_days_mode: 'fixed', base_days_fixed: 40, from_month: '2026-13', to_month: '2026-01' }), [
    '店を選んでください', '月額を円で入れてください', '固定の基準日数は1〜31で入れてください', '開始月の形式が違います（例: 2026-10）']);
  check('契約: 終了月が開始月より前', invoiceValidateContract_({ payee_id: 'p1', store_id: 'x', kind: 'per_visit', amount: 100, from_month: '2026-10', to_month: '2026-09' }), ['終了月が開始月より前です']);

  // ⑩ 毎月の知らせ・催促
  var ps = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }, { id: 'p4', name: 'D' }];
  var cs = [{ payee_id: 'p1', store_id: 'hibino', from_month: '', to_month: '' }, { payee_id: 'p1', store_id: 'tenma', from_month: '', to_month: '' },
            { payee_id: 'p2', store_id: 'hara', from_month: '', to_month: '' }, { payee_id: 'p3', store_id: 'abeno', from_month: '', to_month: '2026-08' },
            { payee_id: 'p4', store_id: 'zzz', from_month: '', to_month: '' }];
  var area = function (sid) { return { hibino: '東海', hara: '東海', tenma: '関西', abeno: '関西' }[sid] || null; };
  check('知らせ: 請求先ごとのエリア（終わった契約は除く・エリア未設定）', invoicePayeeAreas_(ps, cs, '2026-09', area), { p1: ['東海', '関西'], p2: ['東海'], p4: ['(エリア未設定)'] });
  var subs = [{ payee_id: 'p1', period: '2026-09', status: 'submitted' }, { payee_id: 'p2', period: '2026-09', status: 'returned' }];
  check('催促: 未提出と差し戻しのまま（契約の無い請求先は除く）', invoiceUnsubmitted_(ps, cs, subs, '2026-09').map(function (p) { return p.id; }), ['p2', 'p4']);

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
