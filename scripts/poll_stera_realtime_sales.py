#!/usr/bin/env python3
"""
盗難検知機能(棚卸×ステラ突き合わせ)の当日リアルタイム版: import_stera_daily_sales.pyの
「注文詳細CSVを1日1回取り込む」では当日分が翌朝まで反映されず、チェックシートの
「前回入力からの実売上」が当日ずっと0のまま表示されパートナーが混乱する問題があった
(2026-08-15判明)。

ステラの公式API(guides.sterasmartone.com、elepay基盤)には商品別・店舗別の売上数量を
取れるエンドポイントが存在しないが、管理画面(dashboard.sterasmartone.com)自身が
「統計」>「商品」タブで使っている内部集計API(admin-api.elepay.io)には店舗ID
(shopIdSet)・商品ID・日付範囲でフィルタした売上数量が取れることが判明した。
このスクリプトはその内部APIを数分おきにポーリングし、GAS backend(gas_backend.js/gs)の
updateSteraRealtimeToday経由でstera_realtime_todayシートへ書き込む。

**重要**: admin-api.elepay.ioはステラの公式サポート対象外の内部実装であり、予告なく
仕様変更・停止される可能性がある(2026-08-15時点でブラウザの開発者ツール相当の方法で
発見しただけの非公開エンドポイント)。動かなくなった場合はimport_stera_daily_sales.py
(CSVエクスポート経由、公式の操作フローに基づく)側は影響を受けないため、当日速報表示
だけが元の「翌日まで0表示」に戻る形で安全側に劣化する。

認証はBearerトークン(JWT、発行から90日有効)で、Cookieではない。管理画面ログイン時に
ブラウザが自動で付与するため、ここでもimport_stera_daily_sales.pyと同じCDP接続方式で
ログイン済みブラウザから1回リクエストを発生させてヘッダーから抜き出す(トークン自体は
ディスクに保存しない——実行のたびに毎回ログイン済みプロファインから取得し直す)。

STERA_SALES_MAPPINGはgas_backend.js/gsのものと手動で同期させること(商品を追加・削除
したら両方直すこと)。

**返金検知(2026-08-16追加)**: これまで返金の発生を検知・通知する仕組みが一切無かった
(「ステラ注文詳細」タブは返金金額・返金日時をCSVから読んではいるが原価率計算に使うだけ)
ため、当日分のrefundedQuantityが1件以上ある商品をGASのcheckSteraRefundsへ送り、
LINE WORKSへ通知させる(GAS側で「前回通知済みの数量」と比較し、増分がある時だけ通知する
ので同じ返金を10分おきに連投しない)。

使い方:
    STERA_EMAIL=xxx STERA_PASSWORD=xxx GAS_URL=https://script.google.com/macros/s/xxx/exec \
        python poll_stera_realtime_sales.py
"""
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

import import_stera_daily_sales as base

SCRIPT_DIR = Path(__file__).parent
load_dotenv(SCRIPT_DIR.parent / ".env")

# gas_backend.js/gsのSTERA_SALES_MAPPINGと同じ内容(prdId→labelのみ使う。手動同期——変更したら両方直す)
STERA_SALES_MAPPING = {
    "prd_223df30ea1f511d1df19c6c": "水",
    "prd_12fd82ee35d41bcef497baa": "レディーボーデン各種",
    "prd_535430d421048c6d58de73e": "プリングルス各種",
    "prd_db5c32edaf3cba6889315ce": "プチシリーズ",
    "prd_e5beda23225e76774172fe8": "ソイジョイ",
    "prd_57998f0bdebf586bcd3e51c": "大粒ラムネ",
    "prd_7603e1635070498fefa4a85": "果汁グミ",
    "prd_ea6c0ebc5bf327d051ad172": "クランキーアーモンドチョコレート",
}
STERA_SALES_MAPPING_PRD_IDS = list(STERA_SALES_MAPPING.keys())

STORES_JS_PATH = SCRIPT_DIR.parent / "stores.js"


def parse_stores_js():
    """stores.jsの`id:'表示名'`形式をそのまま正規表現で抜き出す(単一の情報源として
    stores.jsをそのまま読む——別ファイルに店舗一覧を複製しない)。"""
    text = STORES_JS_PATH.read_text(encoding="utf-8")
    return dict(re.findall(r"(\w+)\s*:\s*'([^']*)'", text))


def normalize_store_name(name):
    """_steraStoreNameToId_と同じ正規化ルール(gas_backend.js/gs参照、変更したら両方直す)"""
    return re.sub(r"^セルフカフェ", "", name).replace("店", "").rstrip()


def build_shop_id_map(app_id, token):
    """admin-api.elepay.ioの/shopsから全店舗を取得し、stores.jsの表示名と突き合わせて
    shp_id -> 当方store_idの対応表を作る。名前が一致しない店舗(非セルフカフェ店舗・
    draft状態の未公開店舗等)は無視する(既知の仕様、feedback_stera_import_selfcafe_only参照)。"""
    resp = requests.get(
        f"https://admin-api.elepay.io/admin/oneqr/apps/{app_id}/shops",
        params={"limit": 200, "offset": 0},
        headers=_api_headers(token),
        timeout=30,
    )
    resp.raise_for_status()
    shops = resp.json()["shops"]

    our_stores = parse_stores_js()
    name_to_store_id = {}
    for store_id, display_name in our_stores.items():
        name_to_store_id[normalize_store_name(display_name)] = store_id

    shop_id_map = {}
    unmatched = []
    for shop in shops:
        if shop.get("status") != "active":
            continue
        norm = normalize_store_name(shop["name"])
        store_id = name_to_store_id.get(norm)
        if store_id:
            shop_id_map[shop["id"]] = store_id
        else:
            unmatched.append(shop["name"])
    return shop_id_map, unmatched


def _api_headers(token):
    return {
        "authorization": token,
        "livemode": "true",
        "elepay-timezoneoffset": "-540",
        "accept": "application/json",
    }


def capture_token_and_app_id():
    """既存のCDP接続方式でログイン済みブラウザを立ち上げ、統計画面を開いて
    admin-api.elepay.io宛リクエストのAuthorizationヘッダーを1回だけ捕まえる。
    トークンはこの関数の戻り値としてのみ使い、ディスクには一切保存しない。"""
    email = os.environ["STERA_EMAIL"]
    password = os.environ["STERA_PASSWORD"]

    base.launch_cdp_chrome()
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(f"http://localhost:{base.CDP_PORT}")
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()
        page.bring_to_front()

        base.login_if_needed(page, email, password)
        orders_url = base.resolve_orders_url(page)
        app_id = re.search(r"/apps/(app_[a-z0-9]+)/", orders_url).group(1)

        token_holder = {}

        def on_request(req):
            if "admin-api.elepay.io" in req.url:
                auth = req.headers.get("authorization")
                if auth:
                    token_holder["token"] = auth

        page.on("request", on_request)
        page.goto(f"{base.STERA_BASE_URL}/apps/{app_id}/oneqr/statistics")
        page.wait_for_load_state("domcontentloaded")
        deadline = time.time() + 15
        while "token" not in token_holder and time.time() < deadline:
            time.sleep(0.5)
        if "token" not in token_holder:
            raise RuntimeError("Bearerトークンを取得できませんでした(画面構成が変わった可能性)")
        return app_id, token_holder["token"]


def fetch_today_products_for_shop(app_id, token, shop_id):
    now = datetime.now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = now.replace(hour=23, minute=59, second=59, microsecond=999000)
    resp = requests.get(
        f"https://admin-api.elepay.io/admin/oneqr/apps/{app_id}/statistics/transactions-summaries/products",
        params={
            "limit": 50,
            "offset": 0,
            "dateRange": f"{int(start.timestamp() * 1000)},{int(end.timestamp() * 1000)}",
            "sort": "name",
            "order": "asc",
            "shopIdSet": shop_id,
        },
        headers=_api_headers(token),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("rows", [])


def post_to_gas(gas_url, date_str, rows):
    resp = requests.post(
        gas_url,
        json={"action": "updateSteraRealtimeToday", "dateStr": date_str, "rows": rows},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def post_refunds_to_gas(gas_url, date_str, refunds):
    resp = requests.post(
        gas_url,
        json={"action": "checkSteraRefunds", "dateStr": date_str, "refunds": refunds},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def main():
    gas_url = os.environ.get("GAS_URL")
    if not gas_url:
        sys.exit("環境変数 GAS_URL を設定してください")
    if not os.environ.get("STERA_EMAIL") or not os.environ.get("STERA_PASSWORD"):
        sys.exit("環境変数 STERA_EMAIL / STERA_PASSWORD を設定してください")

    try:
        app_id, token = capture_token_and_app_id()
        shop_id_map, unmatched = build_shop_id_map(app_id, token)
        print(f"店舗マッピング: {len(shop_id_map)}件 (未一致: {len(unmatched)}件 {unmatched})")

        date_str = datetime.now().strftime("%Y-%m-%d")
        result_rows = []
        refund_rows = []
        for shop_id, store_id in shop_id_map.items():
            products = fetch_today_products_for_shop(app_id, token, shop_id)
            for p in products:
                if p["id"] not in STERA_SALES_MAPPING_PRD_IDS:
                    continue
                refunded_qty = p.get("refundedQuantity", 0)
                net_qty = p["totalQuantity"] - refunded_qty
                if net_qty != 0:
                    result_rows.append({"storeId": store_id, "prdId": p["id"], "qty": net_qty})
                if refunded_qty > 0:
                    refund_rows.append({
                        "storeId": store_id,
                        "prdId": p["id"],
                        "label": STERA_SALES_MAPPING.get(p["id"], p["id"]),
                        "refundedQuantity": refunded_qty,
                        "refundedAmount": p.get("refundedAmount", 0),
                    })

        print(f"対象商品の売上あり行数: {len(result_rows)}")
        gas_result = post_to_gas(gas_url, date_str, result_rows)
        print(f"GASへの送信結果: {gas_result}")
        if gas_result.get("error"):
            raise RuntimeError(gas_result["error"])

        if refund_rows:
            print(f"返金あり行数: {len(refund_rows)}")
            refund_result = post_refunds_to_gas(gas_url, date_str, refund_rows)
            print(f"返金通知結果: {refund_result}")
            if refund_result.get("error"):
                raise RuntimeError(refund_result["error"])
    except Exception as e:
        base.notify_failure("poll_stera_realtime_sales.py", e)
        raise
    finally:
        base.kill_cdp_chrome()


if __name__ == "__main__":
    main()
