"""バグ報告の自動調査(.github/workflows/bug-report-triage.yml)で、Claude が本番のデータを「読むだけ」で使う窓口。

書き込み系の action は一切呼べない(下の READ_ACTIONS にあるものだけ)。リポジトリは公開で、Actions のログも
誰でも見られるため、パスワード類・口座情報・担当者のパスワードは出力から必ず消す。標準ライブラリのみ。

  python3 scripts/portal_read.py report 8                 # バグ報告No.8の内容・スレッド・画像の保存先
  python3 scripts/portal_read.py get getStoreSettings storeId=chikusa
  python3 scripts/portal_read.py get getSettingHistory key=store_product_cfg limit=30
  python3 scripts/portal_read.py get getChecksheetData storeId=chikusa
  python3 scripts/portal_read.py actions                  # 呼べる action の一覧

出力は JSON。大きい応答は --max 文字(既定 60000)で切る。
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

GAS_URL = 'https://script.google.com/macros/s/AKfycbzoqu607sj-rpYulIiDwnuyGSCTzoblzSqaq37cb5k5KiGsK7sisZew9sSRSBoYBSwo_A/exec'

# 読むだけの GET action。足すときは「書き込みをしない」ことを gas_backend.gs の doGet で確かめてから
READ_ACTIONS = {
    'getBugReports': '全店のバグ報告一覧',
    'getBugReportThread': 'issueId=... のスレッド',
    'getSettings': '全設定(パスワード類は消す)',
    'getStoreSettings': 'storeId=... の設定(パスワード類は消す)',
    'getSettingHistory': 'key=... limit=... 設定の変更履歴(old_valueは上書き前の値)',
    'getChecksheetData': 'storeId=... チェックシート(日別の入力。_enteredAtは入力時刻UTC)',
    'getOrders': '発注データ(store_idで絞って見る)',
    'getAttendance': 'storeId=... 業務開始(打刻)の履歴',
    'getLeaveRequests': 'storeId=... 休み申請',
    'getInventoryHistory': 'storeId=... periodLabel=YYYY-MM 棚卸',
    'getAnnouncements': '業務連絡',
    'getMachinePhotoHistory': 'storeId=... 機械内写真の提出履歴',
    'getAuthLog': 'limit=... 通行証の違反記録',
}
SECRET_KEYS = {'store_passwords', 'admin_pin', 'onboarding_password', 'invoice_partners'}


def _script_key():
    if os.environ.get('PORTAL_SCRIPT_KEY'):
        return os.environ['PORTAL_SCRIPT_KEY']
    f = Path(os.environ.get('USERPROFILE', str(Path.home()))) / '.config' / 'selfcafe' / 'portal_script_key.txt'
    return f.read_text(encoding='utf-8').strip() if f.exists() else ''


def _get(action, params):
    if action not in READ_ACTIONS:
        sys.exit(f'{action} は読み取り用の一覧にありません(書き込み系は呼べません)')
    q = {'action': action, **params}
    if _script_key():
        q['scriptKey'] = _script_key()
    with urllib.request.urlopen(GAS_URL + '?' + urllib.parse.urlencode(q), timeout=90) as r:
        return json.loads(r.read().decode('utf-8'))


def _scrub(action, data, params):
    """パスワード類を消す。設定の一覧・変更履歴・担当者一覧が対象"""
    if action in ('getSettings', 'getStoreSettings') and isinstance(data, list):
        out = []
        for r in data:
            if r.get('key') in SECRET_KEYS:
                continue
            if r.get('key') == 'multi_store_managers':
                try:
                    lst = json.loads(r.get('value') or '[]')
                    r = {'key': r['key'], 'value': json.dumps([{k: v for k, v in x.items() if k != 'password'} for x in lst], ensure_ascii=False)}
                except Exception:
                    continue
            if r.get('key') == 'all_products':
                try:
                    lst = json.loads(r.get('value') or '[]')
                    r = {'key': r['key'], 'value': json.dumps([{k: v for k, v in x.items() if k != 'price'} for x in lst], ensure_ascii=False)}
                except Exception:
                    pass
            out.append(r)
        return out
    if action == 'getSettingHistory':
        if params.get('key') in SECRET_KEYS or params.get('key') == 'multi_store_managers':
            sys.exit('パスワード類の変更履歴は読めません')
    return data


def _report(no):
    rows = _get('getBugReports', {})
    r = next((x for x in rows if str(x.get('no')) == str(no)), None)
    if not r:
        sys.exit(f'No.{no} が見つかりません')
    r = {k: v for k, v in r.items() if k != 'lineworks_user_id'}
    r['thread'] = [{k: v for k, v in c.items() if k in ('created_at', 'poster_type', 'poster_name', 'text')}
                   for c in _get('getBugReportThread', {'issueId': r['id']})]
    # 画像は Read で見られるようにファイルへ保存する(Drive のサムネイルURLは公開で読める)
    saved = []
    for i, url in enumerate([u for u in str(r.get('image_urls') or '').split(',') if u]):
        p = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / f'bug-{no}-{i}.jpg'
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                p.write_bytes(resp.read())
            saved.append(str(p))
        except Exception as e:
            saved.append(f'(取得失敗 {url}: {e})')
    r['image_files'] = saved
    return r


def main():
    args = sys.argv[1:]
    mx = 60000
    if '--max' in args:
        i = args.index('--max')
        mx = int(args[i + 1])
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    if args[0] == 'actions':
        for k, v in READ_ACTIONS.items():
            print(f'{k}: {v}')
        return
    if args[0] == 'report' and len(args) == 2:
        out = _report(args[1])
    elif args[0] == 'get' and len(args) >= 2:
        params = dict(a.split('=', 1) for a in args[2:])
        out = _scrub(args[1], _get(args[1], params), params)
    else:
        sys.exit(__doc__)
    text = json.dumps(out, ensure_ascii=False)
    print(text if len(text) <= mx else text[:mx] + f'\n...(全{len(text)}文字のうち{mx}文字で切りました。--max で増やせます)')


if __name__ == '__main__':
    main()
