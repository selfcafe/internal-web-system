"""バグ報告・修正依頼をClaude Codeセッション(またはターミナル)から操作する。

管理者ポータル・LINE WORKSと同じGASのアクション(addBugReportComment / updateBugReportStatus)を
呼ぶだけなので、履歴(bug_report_comments)・報告者への通知も同じように残る。標準ライブラリのみで
動くので、どのPCでもリポジトリさえあれば使える。

  python scripts/bugreport.py list            # 未対応・対応中の一覧(--all で完了も含む)
  python scripts/bugreport.py show 4          # No.4の内容とスレッド
  python scripts/bugreport.py reply 4 "本文"  # 管理者として返信
  python scripts/bugreport.py status 4 完了   # ステータス変更(未対応/対応中/完了)
"""
import json
import sys
import urllib.parse
import urllib.request

# index.htmlのGAS_URLと同じ本番Web App(公開リポジトリに既に載っている値)
GAS_URL = 'https://script.google.com/macros/s/AKfycbzoqu607sj-rpYulIiDwnuyGSCTzoblzSqaq37cb5k5KiGsK7sisZew9sSRSBoYBSwo_A/exec'
STATUSES = ['未対応', '対応中', '完了']


def _get(action, **params):
    q = urllib.parse.urlencode({'action': action, **params})
    with urllib.request.urlopen(GAS_URL + '?' + q, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def _post(action, **body):
    data = json.dumps({'action': action, **body}).encode('utf-8')
    req = urllib.request.Request(GAS_URL, data=data, headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def _find(no):
    for r in _get('getBugReports'):
        if str(r.get('no')) == str(no):
            return r
    sys.exit(f'No.{no} が見つかりません')


def _label(r):
    store = r.get('store_name') or '全店舗共通/社内'
    kind = '修正依頼' if r.get('kind') == 'request' else 'バグ報告'
    return f"No.{r.get('no')} [{r.get('status')}] {kind}【{store}】{r.get('created_at')}"


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'list':
        rows = _get('getBugReports')
        if '--all' not in args:
            rows = [r for r in rows if r.get('status') != '完了']
        for r in rows:
            print(_label(r))
            print('   ' + str(r.get('content', '')).replace('\n', ' ')[:100])
    elif cmd == 'show' and len(args) == 1:
        r = _find(args[0])
        print(_label(r))
        print(r.get('content', ''))
        if r.get('image_urls'):
            print('画像: ' + r['image_urls'])
        for c in _get('getBugReportThread', issueId=r['id']):
            print(f"  - {c.get('created_at')} {c.get('poster_name') or c.get('poster_type')}: {c.get('text')}")
    elif cmd == 'reply' and len(args) == 2:
        r = _find(args[0])
        print(_post('addBugReportComment', issueId=r['id'], posterType='admin', posterName='管理者', storeId='', text=args[1]))
    elif cmd == 'status' and len(args) == 2:
        if args[1] not in STATUSES:
            sys.exit('ステータスは ' + ' / '.join(STATUSES) + ' のいずれか')
        r = _find(args[0])
        print(_post('updateBugReportStatus', issueId=r['id'], newStatus=args[1], adminName='管理者'))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()
