"""ドリンクマシンの料金の写真を Claude で読み取り、結果をポータルに書く(2026-10-30〜)。

  python scripts/read_price_photo.py <写真のID>

.github/workflows/price-photo-read.yml から呼ぶ(GAS の savePricePhotos → repository_dispatch(price-photo))。
必要な環境変数: ANTHROPIC_API_KEY、PORTAL_SCRIPT_KEY。
ポータルの getPricePhotoImages で写真を受け取り、読めたら「読み取り済み」(GAS が料金台帳に書く)、
読めなければ「撮り直し」と現場向けの理由を setPricePhotoResult で書く。
リポジトリは公開で Actions のログも誰でも見られるので、読み取った中身はログに出さない。
"""
import json
import os
import sys

import anthropic

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bugreport import _get, _post  # noqa: E402  (GAS の呼び方・スクリプトの鍵の読み方を共有)

MODEL = 'claude-opus-5-5'

SCHEMA = {
    'type': 'object',
    'properties': {
        'readable': {'type': 'boolean'},
        'retake_reason': {'type': 'string'},
        'buttons': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'unit': {'type': 'string'},
                    'row': {'type': 'integer'},
                    'position': {'type': 'integer'},
                    'menu': {'type': 'string'},
                    'temp': {'type': 'string', 'enum': ['HOT', 'ICED', '']},
                    'size': {'type': 'string', 'enum': ['R', 'L', '']},
                    'price': {'anyOf': [{'type': 'integer'}, {'type': 'null'}]},
                    'confidence': {'type': 'string', 'enum': ['high', 'low']},
                },
                'required': ['unit', 'row', 'position', 'menu', 'temp', 'size', 'price', 'confidence'],
                'additionalProperties': False,
            },
        },
    },
    'required': ['readable', 'retake_reason', 'buttons'],
    'additionalProperties': False,
}

PROMPT = """セルフカフェのドリンクマシン（カップ式の自動販売機）の正面の写真です。ボタンごとの料金を読み取ってください。

- 1件 = メニュー（カップの絵1つ）× サイズ。値段が2つあるメニュー（R と L）は、サイズごとに別の件にします。
- カップの絵の下の「砂糖なし／砂糖入り」「ブラック／砂糖入り／クリーム入り」「氷なし／氷入り」「微炭酸／強炭酸」などの小さなボタンは、
  同じメニューの選び方なので別の件にしません。menu にも入れません。
- unit: 写真に機械が2台以上写っているときは「左」「右」などどの機械か。1台だけなら空文字。
- row: 上から何段目か（1から）。position: その段の左から何番目のメニュー（カップの絵）か（1から）。同じメニューの R と L は同じ position。
- menu: カップに書いてあるメニュー名（例: オリジナルブレンド 1st、カフェラテ、冷水、炭酸水 氷入り）。書いてあるとおりに。「増量」の札はメニュー名に入れません。
- temp: HOT / ICED（どちらとも書いていなければ空文字）。size: R / L（書いていなければ空文字）。
- price: 円の数字だけ（例: 440）。読めなければ null。
- confidence: 数字・メニュー名がはっきり読めれば high。推測が入ったら low。
- readable: すべてのボタンの値段が読めたら true。ドリンクマシンの写真でない・ぼやけている・反射や影で読めないボタンがある・一部が写っていないときは false。
- retake_reason: readable が false のとき、店のスタッフに撮り直しを頼む短い日本語（例: 「右下のボタンの値段が光の反射で読めません。反射が入らない角度でもう一度撮ってください。」）。true なら空文字。
"""


def read(images):
    client = anthropic.Anthropic()
    content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': im.get('mime') or 'image/jpeg', 'data': im['data']}}
               for im in images]
    content.append({'type': 'text', 'text': PROMPT})
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=['server-side-fallback-2026-07-01'],
        fallbacks='default',
        output_config={'effort': 'high', 'format': {'type': 'json_schema', 'schema': SCHEMA}},
        messages=[{'role': 'user', 'content': content}],
    )
    if response.stop_reason == 'refusal':
        raise RuntimeError('読み取りが断られました')
    if response.stop_reason == 'max_tokens':
        raise RuntimeError('出力が長すぎて途中で切れました')
    text = next(b.text for b in response.content if b.type == 'text')
    return json.loads(text)


def main():
    if len(sys.argv) < 2:
        sys.exit('写真のIDを指定してください')
    pid = sys.argv[1]
    got = _get('getPricePhotoImages', id=pid)
    if not got.get('ok') or not got.get('images'):
        sys.exit(f'写真を受け取れませんでした: {got.get("error")}')
    try:
        out = read(got['images'])
    except Exception as e:  # 読み取り自体の失敗は管理画面に「読み取り失敗」と出す(現場には撮り直しを頼まない)
        _post('setPricePhotoResult', id=pid, status='読み取り失敗', reason=str(e)[:200], result='')
        raise
    buttons = out.get('buttons') or []
    ok = bool(out.get('readable')) and buttons and all(b.get('price') is not None for b in buttons)
    if ok:
        res = _post('setPricePhotoResult', id=pid, status='読み取り済み', reason='', result=json.dumps({'buttons': buttons}, ensure_ascii=False))
    else:
        reason = out.get('retake_reason') or 'ボタンの値段が読み取れませんでした。ボタンと値段が全部はっきり写るように、もう一度撮ってください。'
        res = _post('setPricePhotoResult', id=pid, status='撮り直し', reason=reason, result=json.dumps({'buttons': buttons}, ensure_ascii=False))
    if not res.get('ok'):
        sys.exit(f'結果を書けませんでした: {res.get("error")}')
    low = sum(1 for b in buttons if b.get('confidence') == 'low')
    print(f'{"読み取り済み" if ok else "撮り直し"}: ボタン{len(buttons)}件(要確認{low}件)')


if __name__ == '__main__':
    main()
