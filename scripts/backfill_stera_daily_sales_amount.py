#!/usr/bin/env python3
"""
stera_daily_salesのamount(商品合計金額)列バックフィル用(2026-09-07追加)。

経緯: STERA_DAILY_COLSにamount列を追加した(棚卸表の「原価率(ステラ実売上ベース)」計算用)後、
実際にデプロイされるまでの間に取り込まれていた日次データ(7月分は日次取込みパイプライン開始
[2026-08-03]より前で1行も無し、8月〜9月頭分はamount列追加前のコードで取り込み済み)は
amountが常に0のままだった。import_stera_daily_sales.py(通常の日次取込み、1日分ずつ)を
7月〜9月頭の全日数ぶん個別に実行するのは非効率なため、この専用スクリプトは1回の注文詳細CSV
エクスポートで対象期間(同一月内)をまるごと取得し、GAS側の新エンドポイント
importSteraDailySalesBulk(CSVの各行の「作成日時」から日付を読み取って日付ごとに振り分ける)
へまとめて送信する。

制約: stera側の日付範囲ピッカー(ant-design)の都合で、開始日・終了日は同じ月内でなければ
ならない(import_stera_daily_sales.set_date_rangeの制約をそのまま引き継ぐ)。月をまたぐ
バックフィルが必要な場合は、月ごとに複数回実行すること(例: 7月分と8月分は別々に実行)。

使い方:
    STERA_EMAIL=xxx STERA_PASSWORD=xxx GAS_URL=https://script.google.com/macros/s/xxx/exec \
        python backfill_stera_daily_sales_amount.py --start 2026-07-01 --end 2026-07-31
"""
import argparse
import sys
import time
from datetime import date

from playwright.sync_api import sync_playwright

from import_stera_daily_sales import (
    CDP_PORT,
    kill_cdp_chrome,
    launch_cdp_chrome,
    login_if_needed,
    post_bulk_to_gas,
    request_order_detail_csv,
    resolve_orders_url,
    run_with_retry,
    set_date_range,
    wait_and_download,
)


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--start", required=True, help="対象期間の開始日(YYYY-MM-DD)")
    p.add_argument("--end", required=True, help="対象期間の終了日(YYYY-MM-DD、開始日と同じ月内)")
    p.add_argument("--keep-open", action="store_true", help="終了後もブラウザを閉じない(デバッグ用)")
    return p.parse_args()


def main():
    args = parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    if start.year != end.year or start.month != end.month:
        sys.exit(f"--start/--endは同じ月内である必要があります(stera側の日付ピッカーの制約): {args.start}〜{args.end}")
    if start > end:
        sys.exit(f"--startが--endより後になっています: {args.start}〜{args.end}")

    import os
    gas_url = os.environ.get("GAS_URL")
    if not gas_url:
        sys.exit("環境変数 GAS_URL を設定してください(社内ポータルGASのWebアプリURL)")
    email = os.environ.get("STERA_EMAIL")
    password = os.environ.get("STERA_PASSWORD")
    if not email or not password:
        sys.exit("環境変数 STERA_EMAIL / STERA_PASSWORD を設定してください")

    print(f"対象期間: {args.start} 〜 {args.end}")

    def _attempt():
        launch_cdp_chrome()
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            page.bring_to_front()

            login_if_needed(page, email, password)
            orders_url = resolve_orders_url(page)
            page.goto(orders_url)
            page.wait_for_load_state("domcontentloaded")
            time.sleep(1)

            remark = f"バックフィル{args.start}_{args.end}"
            set_date_range(page, args.start, args.end)
            request_order_detail_csv(page, remark)
            csv_path = wait_and_download(page, remark, timeout_sec=180)  # 複数日分は生成に時間がかかりうるため長めに
            print(f"CSVダウンロード完了: {csv_path}")

            result = post_bulk_to_gas(gas_url, csv_path)
            print(f"GASへの取込み結果: {result}")
            if result.get("unmatchedStores"):
                print(f"[警告] 店舗名が一致しなかった行があります(stores.jsと表記が合っていない可能性): {result['unmatchedStores']}")
            if result.get("unparsedDateRows"):
                print(f"[警告] 日付を読み取れなかった行が{result['unparsedDateRows']}件ありました")
            if result.get("error"):
                raise RuntimeError(result["error"])

    try:
        run_with_retry(_attempt, "backfill_stera_daily_sales_amount.py")
    finally:
        if not args.keep_open:
            kill_cdp_chrome()


if __name__ == "__main__":
    main()
