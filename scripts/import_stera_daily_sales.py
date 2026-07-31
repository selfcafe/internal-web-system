#!/usr/bin/env python3
"""
盗難検知機能(棚卸×ステラ突き合わせ)のデータパイプライン: stera smart oneの「注文一覧→注文詳細CSV」を
指定日(既定は前日)分だけダウンロードし、社内ポータルのGAS backend(importSteraDailySales)へ送信する。

stera smart oneには商品別・店舗別の売上数量を取得できる公式APIが無いため、この手動画面操作を
Playwrightで自動化している([[project_stera_theft_detection]]参照)。

⚠️ このスクリプトはstera smart oneダッシュボードへのログイン認証情報を持つ人が、実際の画面で
   セレクタ(ボタン名・メニュー名等)を一度確認・調整してから使うこと。作成時点(2026-07-31)では
   ログイン情報を持たない環境で書いているため、テキストベースのセレクタ(get_by_text/get_by_role)
   を使い、DOM構造の細部には依存しない書き方にしているが、実際のログイン画面・注文一覧画面の
   実物では文言や画面遷移が異なる可能性がある。特に以下は要確認:
     - ログインフォームの項目名(メールアドレス/ID、パスワード等)
     - 「注文」メニューの正確なラベル・階層
     - 日付範囲の指定方法(2つのdate inputか、プリセットボタンか等)
     - 「注文詳細CSV」ボタンの正確な文言(既存調査では「注文詳細CSV」という別のダウンロード種別
       として存在するとの記録があるが、実際の表記は確認が必要)

使い方:
    STERA_EMAIL=xxx STERA_PASSWORD=xxx GAS_URL=https://script.google.com/macros/s/xxx/exec \
        python import_stera_daily_sales.py [--date 2026-07-30]

--date を省略すると前日(実行環境のローカル日付基準)を対象にする。
"""
import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

STERA_LOGIN_URL = "https://dashboard.sterasmartone.com/"
DOWNLOAD_DIR = Path(__file__).parent / "_downloads"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--date", help="対象日(YYYY-MM-DD)。省略時は前日", default=None)
    p.add_argument("--headless", action="store_true", default=True)
    p.add_argument("--no-headless", dest="headless", action="store_false")
    return p.parse_args()


def resolve_target_date(date_str):
    if date_str:
        return date_str
    return (date.today() - timedelta(days=1)).isoformat()


def download_order_detail_csv(target_date, headless=True):
    """stera smart oneダッシュボードにログインし、対象日1日分の注文詳細CSVをダウンロードして
    そのファイルパスを返す。ログイン後の画面遷移・セレクタは要検証(ファイル先頭のコメント参照)。"""
    email = os.environ.get("STERA_EMAIL")
    password = os.environ.get("STERA_PASSWORD")
    if not email or not password:
        sys.exit("環境変数 STERA_EMAIL / STERA_PASSWORD を設定してください")

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(accept_downloads=True)
        page.goto(STERA_LOGIN_URL)

        # --- ログイン(要検証: 実際の入力欄のlabel/placeholderに合わせて調整すること) ---
        page.get_by_label("メールアドレス").or_(page.get_by_placeholder("メールアドレス")).fill(email)
        page.get_by_label("パスワード").or_(page.get_by_placeholder("パスワード")).fill(password)
        page.get_by_role("button", name="ログイン").click()
        page.wait_for_load_state("networkidle")

        # --- 「注文」一覧画面へ移動(要検証: 左メニューの正確な文言・階層) ---
        page.get_by_text("注文", exact=True).first.click()
        page.wait_for_load_state("networkidle")

        # --- 日付範囲を対象日1日分に絞る(要検証: date input 2つか、範囲ピッカー1つか) ---
        date_inputs = page.locator('input[type="date"]')
        if date_inputs.count() >= 2:
            date_inputs.nth(0).fill(target_date)
            date_inputs.nth(1).fill(target_date)
        else:
            # 範囲ピッカー等、date input以外の実装だった場合はここを実際の画面に合わせて書き換える
            raise RuntimeError(
                "日付範囲の指定方法が想定(input[type=date]が2つ)と異なります。"
                "実際の画面を確認してこの関数を調整してください。"
            )
        page.get_by_role("button", name="検索").click()
        page.wait_for_load_state("networkidle")

        # --- 「注文詳細CSV」をダウンロード(要検証: 正確なボタン文言) ---
        with page.expect_download() as download_info:
            page.get_by_text("注文詳細CSV").click()
        download = download_info.value
        dest = DOWNLOAD_DIR / f"order_detail_{target_date}.csv"
        download.save_as(str(dest))

        browser.close()
        return dest


def post_to_gas(gas_url, target_date, csv_path):
    csv_text = csv_path.read_text(encoding="utf-8-sig")  # ステラCSVはUTF-8 with BOMの想定
    resp = requests.post(gas_url, json={
        "action": "importSteraDailySales",
        "dateStr": target_date,
        "csvText": csv_text,
    }, timeout=120)
    resp.raise_for_status()
    return resp.json()


def main():
    args = parse_args()
    gas_url = os.environ.get("GAS_URL")
    if not gas_url:
        sys.exit("環境変数 GAS_URL を設定してください(社内ポータルGASのWebアプリURL)")

    target_date = resolve_target_date(args.date)
    print(f"対象日: {target_date}")

    csv_path = download_order_detail_csv(target_date, headless=args.headless)
    print(f"CSVダウンロード完了: {csv_path}")

    result = post_to_gas(gas_url, target_date, csv_path)
    print(f"GASへの取込み結果: {result}")
    if result.get("unmatchedStores"):
        print(f"⚠️ 店舗名が一致しなかった行があります(stores.jsと表記が合っていない可能性): {result['unmatchedStores']}")
    if result.get("error"):
        sys.exit(f"エラー: {result['error']}")


if __name__ == "__main__":
    main()
