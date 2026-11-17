// 業務委託契約書の電子締結（gas_backend.gs 末尾の契約のブロック）の、シートを触らない部分の検算。
// 実物の gas_backend.gs を読み込んで関数を呼ぶ。実名は使わない（リポジトリが公開のため）。
//
// 実行方法: node scripts/test_partner_contract.js
//   Node が無い PC では Python の mini-racer でも動く:
//   py -c "import os; from py_mini_racer import MiniRacer as M; r=M(); r.eval(open('scripts/test_partner_contract.js',encoding='utf-8').read()); r.eval(open('gas_backend.gs',encoding='utf-8').read()); print(r.eval('runPartnerContractTests()'), flush=True); os._exit(0)"
function runPartnerContractTests() {
  var results = [], failed = 0;
  function check(name, actual, expected) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) results.push('OK  ' + name);
    else { failed++; results.push('NG  ' + name + '\n      期待: ' + e + '\n      実際: ' + a); }
  }
  check('氏名の照合: 全角・半角の空白を除く', contractNormName_(' 見本　太郎 '), '見本太郎');
  check('契約番号: その日の最初', contractNextId_([], '20261117'), 'C-20261117-001');
  check('契約番号: その日の連番（別の日は数えない）', contractNextId_(['C-20261117-001', 'C-20261117-002', 'C-20261116-009'], '20261117'), 'C-20261117-003');
  var fid = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  check('ファイルID: ドキュメントの URL', contractFileIdFromUrl_('https://docs.google.com/document/d/' + fid + '/edit?tab=t.0'), fid);
  check('ファイルID: Drive の URL', contractFileIdFromUrl_('https://drive.google.com/file/d/' + fid + '/view?usp=sharing'), fid);
  check('ファイルID: open?id=', contractFileIdFromUrl_('https://drive.google.com/open?id=' + fid), fid);
  check('ファイルID: ID だけ', contractFileIdFromUrl_(fid), fid);
  check('ファイルID: 関係ない文字は空', contractFileIdFromUrl_('こんにちは'), '');
  check('メールを伏せる', contractMaskEmail_('sample.taro@example.com'), 'sa***@example.com');
  check('登録: 正しい内容は誤りなし', contractValidateNew_({ title: '業務委託契約書', partnerName: '見本 太郎', email: 'a@example.com', docUrl: fid, by: '本部A' }), []);
  check('登録: 誤りを全部返す', contractValidateNew_({ title: '', partnerName: '　', email: 'a@example', docUrl: 'x', by: '' }), [
    '相手の氏名（社名）を入れてください', '相手のメールアドレスを正しく入れてください', '契約書の名前を入れてください',
    '契約書（Google ドキュメントか Word）の URL を入れてください', '作成する人を選んでください']);
  var tp = { useTemplate: true, partnerName: '見本太郎', email: 'a@example.com', storeId: 'sugamo', storeAddress: '〒000-0000 見本県見本市1-2-3', partnerAddress: '見本県見本市4-5-6',
    fee: 30000, frequency: '週7回', contractDate: '2026-11-18', by: '本部A' };
  check('登録(ひな形): 正しい内容は誤りなし（URL・契約書の名前は要らない）', contractValidateNew_(tp), []);
  check('登録(ひな形): 誤りを全部返す', contractValidateNew_({ useTemplate: true, partnerName: '見本太郎', email: 'a@example.com', fee: 0, contractDate: '11/18', by: '本部A' }), [
    '店名を選んでください', '店の住所を入れてください', '相手の住所を入れてください', '報酬（月額・税込）を円で入れてください', '業務の頻度を入れてください（例: 週7回）', '契約日を選んでください']);
  check('ひな形の差し込み: 店名は「セルフカフェ」「店」を外す・報酬は3桁区切り・契約日は和文', contractTemplateValues_(tp, 'セルフカフェ巣鴨駅南口店'),
    { '店舗名': '巣鴨駅南口', '店舗住所': '〒000-0000 見本県見本市1-2-3', '頻度': '週7回', '報酬': '30,000', '契約日': '2026年11月18日', '乙住所': '見本県見本市4-5-6', '乙氏名': '見本太郎' });
  var c = { status: 'sent', partner_name: '見本 太郎' };
  var ok = { checkRead: true, checkAgree: true, name: '見本太郎', code: '123456' };
  check('同意: 正しければ通る（氏名は空白の違いを許す）', contractValidateAgree_(c, ok, '123456'), '');
  check('同意: リンクが違う', contractValidateAgree_(null, ok, '123456'), 'リンクが正しくありません。本部に確認してください');
  check('同意: 取り消し済み', contractValidateAgree_({ status: 'canceled', partner_name: '見本 太郎' }, ok, '123456'), 'この契約書は取り消されています。本部に確認してください');
  check('同意: すでに同意済み', contractValidateAgree_({ status: 'agreed', partner_name: '見本 太郎' }, ok, '123456'), 'この契約書はすでに同意済みです');
  check('同意: チェックが足りない', contractValidateAgree_(c, { checkRead: true, checkAgree: false, name: '見本太郎', code: '123456' }, '123456'), '2つのチェックを入れてください');
  check('同意: 氏名が違う', contractValidateAgree_(c, { checkRead: true, checkAgree: true, name: '見本 次郎', code: '123456' }, '123456').slice(0, 14), '氏名が契約書の名前と違います');
  check('同意: コードの期限切れ', contractValidateAgree_(c, ok, null).slice(0, 16), '確認コードの有効時間が切れました');
  check('同意: コードが違う', contractValidateAgree_(c, { checkRead: true, checkAgree: true, name: '見本太郎', code: '000000' }, '123456'), '確認コードが違います');
  check('窓口: 相手用と本部用が重ならない', CONTRACT_PUBLIC_ACTIONS.filter(function (a) { return CONTRACT_ADMIN_ACTIONS.indexOf(a) >= 0; }), []);
  check('窓口: 契約の action はログイン確認の「だれでも可」に入っていない', CONTRACT_ADMIN_ACTIONS.filter(function (a) { return AUTH_PUBLIC_ACTIONS.indexOf(a) >= 0 || AUTH_STORE_ACTIONS.indexOf(a) >= 0 || AUTH_ANY_ACTIONS.indexOf(a) >= 0 || AUTH_ONB_ACTIONS.indexOf(a) >= 0; }), []);
  // 日時は日本時間の文字で保存する（Utilities は実行時だけ見本を置く）
  var U = typeof Utilities === 'undefined' ? (Utilities = { formatDate: function (d) { return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' '); } }) : Utilities;
  check('日時: Date は「… JST」の文字にする', contractStamp_(new Date(Date.UTC(2026, 10, 17, 14, 45, 31))), '2026-11-17 23:45:31 JST');
  check('日時: 文字・数はそのまま', [contractStamp_('見本'), contractStamp_(30000), contractStamp_('')], ['見本', 30000, '']);
  check('日時: 表示は JST を外す・空は空', [_contractTime_('2026-11-17 23:45:31 JST'), _contractTime_('')], ['2026-11-17 23:45:31', '']);
  results.push(failed ? ('失敗 ' + failed + ' 件') : 'すべて成功');
  return results.join('\n');
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var ctx = vm.createContext({ console: console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas_backend.gs'), 'utf8'), ctx, { filename: 'gas_backend.gs' });
  vm.runInContext(runPartnerContractTests.toString(), ctx);
  var out = vm.runInContext('runPartnerContractTests()', ctx);
  console.log(out);
  if (/失敗/.test(out)) process.exit(1);
}
