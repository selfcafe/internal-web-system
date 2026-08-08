#!/usr/bin/env python3
"""
盗難検知機能(棚卸×ステラ突き合わせ)のデータパイプライン: stera smart oneの
「SaaSサービス > 注文 > 注文詳細CSV」を指定日(既定は前日)分だけダウンロードし、
社内ポータルのGAS backend(importSteraDailySales)へ送信する。

2026-08-03、実際にログインして画面を確認しながら実装・検証済み(旧版はログイン情報を
持たない環境で書かれたたたき台だった)。実地検証で判明した重要事項:

- **通常のPlaywright起動(chromium.launch/launch_persistent_context)はheaded/headless
  問わずログイン時にreCAPTCHA(「私はロボットではありません」)チャレンジが必ず出る。**
  一方、独立したChromeプロセスを先に起動し、--remote-debugging-portでCDP接続する方式
  (kaihipay-downloaderのe-MOSS/kaihipay自動化と同じパターン)だとCAPTCHAが出ない。
  このスクリプトは起動時に自前でこのCDP方式のChromeプロセスを立ち上げる。
- 「注文」画面はアカウント全体の「トランザクション」画面とは別物(SaaSサービス配下の
  アプリ固有画面)。URLは `apps/{app_id}/oneqr/orders` で、app_idは店舗のアプリID
  (このアカウントでは `app_18d46ad5917bff78cca6e22`——他アカウントでは異なる可能性あり、
  ハードコードせずSaaSサービスのリンクを辿って解決する)。
- CSV Exportは「注文CSV」「注文詳細CSV」のドロップダウンから選ぶ形式で、クリック後
  備考欄(任意)+「ダウンロード」ボタンの確認モーダルが挟まる。
- **エクスポートは非同期**(以前の調査記録「即ダウンロード」は誤り、または画面が変わった)。
  リクエスト後、「ダウンロード」セクション(`/business/download`)に一覧が出るので、
  対象ファイルのステータスが「ダウンロード済み」になるまでポーリングしてから、
  一覧の「操作」列の「ダウンロード」リンクをクリックして実ファイルを取得する
  (小規模な1日分データなら数秒で完了する)。
- 日付範囲はant-design系の範囲カレンダー(readonly input、直接文字入力不可)。
  開始日付inputをクリックしてカレンダーを開き、左側パネル(当月)内で対象日のセルを
  「2回クリック」して単日範囲にしてから「決定」ボタンを押す。プリセットボタン
  (過去3日/7日/30日/今週/先週/今月/先月)はあるが「前日単体」相当のものは無い。
- 「操作」列のダウンロードリンクは通常の`.click()`だとテーブルの固定列(fixed columns)
  オーバーレイに阻まれるため、`page.evaluate("(el) => el.click()", ...)`で発火させる。

使い方:
    STERA_EMAIL=xxx STERA_PASSWORD=xxx GAS_URL=https://script.google.com/macros/s/xxx/exec \
        python import_stera_daily_sales.py [--date 2026-08-02]

--date を省略すると前日(実行環境のローカル日付基準)を対象にする。
"""
import argparse
import os
import re
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

STERA_BASE_URL = "https://dashboard.sterasmartone.com"
SCRIPT_DIR = Path(__file__).parent
load_dotenv(SCRIPT_DIR.parent / ".env")  # スケジュール実行時も.envを自動で読み込む
DOWNLOAD_DIR = SCRIPT_DIR / "_downloads"
PROFILE_DIR = SCRIPT_DIR.parent / ".chrome_stera_profile"
CDP_PORT = 9444


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--date", help="対象日(YYYY-MM-DD)。省略時は前日", default=None)
    p.add_argument("--keep-open", action="store_true", help="終了後もブラウザを閉じない(デバッグ用)")
    return p.parse_args()


def resolve_target_date(date_str):
    if date_str:
        return date_str
    return (date.today() - timedelta(days=1)).isoformat()


def _find_chrome_exe():
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return "chrome.exe"  # PATHにあることを期待するフォールバック


def launch_cdp_chrome():
    """独立したChromeプロセスを起動し、CDPポートが応答するまで待つ。
    reCAPTCHA回避のため、Playwright自身のlaunch()は使わない(ファイル冒頭コメント参照)。"""
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.Popen([
        _find_chrome_exe(),
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={PROFILE_DIR}",
        "--start-minimized",
    ])
    for _ in range(30):
        try:
            requests.get(f"http://localhost:{CDP_PORT}/json/version", timeout=2)
            return
        except requests.exceptions.ConnectionError:
            time.sleep(1)
    raise RuntimeError(f"CDPポート{CDP_PORT}が起動しませんでした")


def kill_cdp_chrome():
    """CDP接続を閉じてもchrome.exe本体は終了しない(playwright.chromium.connect_over_cdpの
    既知の制約)ため、該当ポートで起動しているプロセスをOSレベルで終了させる。"""
    subprocess.run([
        "powershell", "-Command",
        f"Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | "
        f"Where-Object {{ $_.CommandLine -match 'remote-debugging-port={CDP_PORT}' -and $_.CommandLine -notmatch '--type=' }} | "
        f"ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"
    ], capture_output=True)


def login_if_needed(page, email, password):
    # トップページ(/)は未ログインでもuser/loginへリダイレクトされず表示されるため、
    # URLではなくログインフォーム(メールアドレス入力欄)の有無で判定する
    # (2026-08-08、GitHub Actionsの初回セッション=Chromeプロファイルが空の環境で
    # URL判定だと常に「既にログイン済み」と誤判定することが判明。ローカルPCでは
    # プロファイルに既存セッションが残っていたため表面化していなかった)。
    page.goto(STERA_BASE_URL + "/")
    page.wait_for_load_state("domcontentloaded")
    # SPAのため即座には描画されない。入力欄が出現するまで待ち、出現しなければ
    # (タイムアウトしたら)本当にログイン済みとみなす(2026-08-08、固定sleep(1)では
    # GitHub Actions実行環境でレンダリングに間に合わず誤判定するケースがあったため)
    email_input = page.get_by_placeholder("メールアドレス")
    try:
        email_input.wait_for(state="visible", timeout=8000)
    except PlaywrightTimeoutError:
        print("既にログイン済み:", page.url)
        return
    email_input.fill(email)
    page.get_by_placeholder("パスワード").fill(password)
    page.get_by_role("button", name="ログイン").click()
    page.wait_for_load_state("domcontentloaded")
    time.sleep(2)
    if page.get_by_placeholder("メールアドレス").count() > 0:
        raise RuntimeError(
            "ログインに失敗しました(CAPTCHA等の可能性)。--keep-openで起動し、"
            ".chrome_stera_profileのブラウザ画面を直接確認してください。"
        )
    print("ログイン完了:", page.url)


def resolve_orders_url(page):
    """SaaSサービスのapp_idはアカウント固有のためハードコードせず、
    アプリ一覧からリンクを辿って実際のURLを解決する。"""
    page.goto(STERA_BASE_URL + "/business/apps/")
    page.wait_for_load_state("domcontentloaded")
    time.sleep(1)
    page.get_by_text("SaaSサービス", exact=True).click()
    page.wait_for_url(re.compile(r"/apps/app_"), timeout=15000)
    page.wait_for_load_state("domcontentloaded")
    time.sleep(1)
    m = re.search(r"/apps/(app_[a-z0-9]+)/", page.url)
    if not m:
        raise RuntimeError(f"app_idを取得できませんでした: {page.url}")
    return f"{STERA_BASE_URL}/apps/{m.group(1)}/oneqr/orders"


def set_date_range(page, target_date):
    """開始日付inputをクリックしてカレンダーを開き、対象日のセルを2回クリックして
    単日範囲にしてから「決定」を押す(ファイル冒頭コメント参照)。"""
    target = date.fromisoformat(target_date)
    day_str = str(target.day)

    start_input = page.locator('input[placeholder="開始日付"]').first
    start_input.click()
    time.sleep(0.5)

    # 対象月がカレンダーの左パネルに表示されていることを前提とする(前日/当日ならまず成立する)。
    left_panel = page.locator(".ant-calendar-range-left")
    cells = left_panel.locator("td.ant-calendar-cell")
    target_cell = None
    for i in range(cells.count()):
        if cells.nth(i).inner_text().strip() == day_str:
            target_cell = cells.nth(i)
            break
    if target_cell is None:
        raise RuntimeError(f"カレンダーに{day_str}日のセルが見つかりません(月をまたぐ場合は要対応)")

    target_cell.click()
    time.sleep(0.3)
    target_cell.click()  # 2回目のクリックで単日range(start=end=target_date)にする
    time.sleep(0.3)

    page.get_by_role("button", name="決定").click()
    time.sleep(0.5)

    end_input = page.locator('input[placeholder="終了日付"]').first
    got_start = start_input.input_value()
    got_end = end_input.input_value()
    expected_prefix = target.strftime("%Y/%m/%d")
    if not (got_start.startswith(expected_prefix) and got_end.startswith(expected_prefix)):
        raise RuntimeError(f"日付範囲の設定に失敗しました: start={got_start!r} end={got_end!r}")
    print(f"日付範囲設定完了: {got_start} 〜 {got_end}")


def request_order_detail_csv(page, remark):
    # 「検索」ボタンはCSSの文字間隔で"検 索"のように見える(DOM上も空白が入る)ため正規表現で拾う
    page.locator("button", has_text=re.compile("検.?索")).first.click()
    page.wait_for_load_state("domcontentloaded")
    time.sleep(1)

    page.get_by_text("CSV Export", exact=True).click()
    time.sleep(0.5)
    page.get_by_text("注文詳細CSV", exact=True).click()
    time.sleep(1)

    page.get_by_placeholder("50文字以内で入力してください。").fill(remark)
    page.get_by_role("button", name="ダウンロード").click()
    time.sleep(2)

    # リクエスト受付ダイアログを閉じる(「確認」ボタン、文字間にCSSでスペースが入るため部分一致で拾う)
    confirm_btn = page.locator("button", has_text=re.compile("確")).last
    if confirm_btn.count():
        confirm_btn.click()
    time.sleep(1)


def wait_and_download(page, remark, timeout_sec=120):
    """/business/downloadで対象行(備考で特定)のステータスが準備完了系("処理完了"=未取得/
    "ダウンロード済み"=取得済みのどちらか)になるまでポーリングし、「操作」列のダウンロード
    リンクをクリックして実ファイルを取得する(2026-08-03実地検証: 新規生成直後は「処理完了」、
    一度でもダウンロードした後は「ダウンロード済み」と表示が変わることを確認済み)。"""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    page.goto(STERA_BASE_URL + "/business/download")
    page.wait_for_load_state("domcontentloaded")

    deadline = time.time() + timeout_sec
    row = None
    while time.time() < deadline:
        page.reload()
        page.wait_for_load_state("domcontentloaded")
        time.sleep(2)
        candidate = page.locator("tr", has_text=remark).filter(has_text="注文詳細一覧")
        if candidate.count():
            text = candidate.first.inner_text()
            if "処理完了" in text or "ダウンロード済み" in text:
                row = candidate.first
                break
    if row is None:
        raise RuntimeError("タイムアウト: 注文詳細CSVの生成が完了しませんでした")

    filename_cell = row.locator("td").first
    filename = filename_cell.inner_text().strip()
    dl_link = row.get_by_text("ダウンロード", exact=True).last

    with page.expect_download(timeout=15000) as dl_info:
        page.evaluate("(el) => el.click()", dl_link.element_handle())
    download = dl_info.value
    dest = DOWNLOAD_DIR / filename
    download.save_as(str(dest))
    return dest


def post_to_gas(gas_url, target_date, csv_path):
    csv_text = csv_path.read_text(encoding="utf-8-sig")  # ステラCSVはUTF-8 with BOM
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
    email = os.environ.get("STERA_EMAIL")
    password = os.environ.get("STERA_PASSWORD")
    if not email or not password:
        sys.exit("環境変数 STERA_EMAIL / STERA_PASSWORD を設定してください")

    target_date = resolve_target_date(args.date)
    print(f"対象日: {target_date}")

    launch_cdp_chrome()
    try:
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

            remark = f"自動取込み{target_date}"
            set_date_range(page, target_date)
            request_order_detail_csv(page, remark)
            csv_path = wait_and_download(page, remark)
            print(f"CSVダウンロード完了: {csv_path}")

            result = post_to_gas(gas_url, target_date, csv_path)
            print(f"GASへの取込み結果: {result}")
            if result.get("unmatchedStores"):
                print(f"⚠️ 店舗名が一致しなかった行があります(stores.jsと表記が合っていない可能性): {result['unmatchedStores']}")
            if result.get("error"):
                sys.exit(f"エラー: {result['error']}")
    finally:
        if not args.keep_open:
            kill_cdp_chrome()


if __name__ == "__main__":
    main()
