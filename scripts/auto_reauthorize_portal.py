#!/usr/bin/env python3
"""
社内ポータルのGAS Web Appが「承認が必要です」で全滅した際に、2026-08-22に人手で
実施した復旧手順(Apps Scriptエディタでgetsettingsを実行→「権限を確認」→
Google未検証アプリ警告を「詳細」から突破→スコープ「すべて選択」→「続行」)を
そのまま自動化したもの。watchdog_portal_health.pyが異常を検知した際に呼び出す。

**重要な注意点(手動検証時に判明した罠、そのまま踏襲すること):**
1. Googleの「このアプリはGoogleで確認されていません」警告には「詳細」テキストが
   2箇所ある。1つ目(get_by_text("詳細").first)はGoogleのヘルプ記事に飛ぶだけの
   罠で、2つ目(.last)が「安全ではないページに移動」を展開する本物。
2. スコープ選択画面の各権限チェックボックスは、デフォルトでは**未選択**。
   「すべて選択」を押さずに「続行」すると「アクセス権は許可されませんでした」
   になり、権限が一切付与されないまま完了してしまう。必ず「すべて選択」→
   チェックが入ったことを確認するまで待ってから「続行」を押すこと。
3. このGoogle同意画面の一連の操作はCDP接続のPlaywrightでも問題なく完走できる
   (2026-08-22実証済み、"自動化不可"という説明は誤りだった)。

このスクリプト専用の別Chromeプロファイル(.chrome_portal_admin_profile、
kaihipay-downloader/.chrome_cdp_profileの複製、selfcafe001@gmail.comログイン済み)
を使う。kaihipay-downloaderの自動化と同じプロファイルを共有すると、実行タイミングが
重なった際にプロファイルロックで両方が壊れる恐れがあるため、意図的に分離している。

戻り値: (True, None) = 再認可成功 / 元々問題なし。 (False, 理由) = 失敗。
"""
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).parent
PROFILE_DIR = SCRIPT_DIR.parent / ".chrome_portal_admin_profile"
CDP_PORT = 9444
CHROME_EXE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
EDITOR_URL = "https://script.google.com/u/1/home/projects/1J5qtNKPyXt3L7wmX6MMmAD33t1LQF5hBaDfjG2mghCinlc4h4xwagxP2/edit"


def _launch_chrome():
    subprocess.Popen(
        [CHROME_EXE, f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={PROFILE_DIR}", "--start-minimized"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def _close_chrome():
    """CDP接続を閉じるだけではchrome.exe自体は終了しないため、該当ポートを持つ
    非rendererプロセスをtasklist/wmicで探してkillする([[project_kaihipay_pipeline_architecture]]と同じやり方)。

    2026-09-04追記: import_stera_daily_sales.pyのkill_cdp_chrome()で2026-08-21に
    修正済みだった「Task Scheduler経由の無人実行で空のPowerShell/コマンドプロンプト窓が
    表示される」不具合が、このファイルには移植されていなかった。wmic/taskkillは
    どちらもコンソールアプリのため、capture_output=Trueだけでは窓の生成自体は防げず、
    CREATE_NO_WINDOWの明示指定が必要。"""
    no_window = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    try:
        result = subprocess.run(
            ["wmic", "process", "where", f"CommandLine like '%remote-debugging-port={CDP_PORT}%' and not CommandLine like '%--type=%'",
             "get", "ProcessId"],
            capture_output=True, text=True, timeout=15, creationflags=no_window,
        )
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.isdigit():
                subprocess.run(["taskkill", "/F", "/PID", line], capture_output=True, timeout=10, creationflags=no_window)
    except Exception:
        pass


def _select_getsettings_and_run(page):
    ok_btn = page.get_by_role("button", name="OK")
    if ok_btn.count() > 0:
        ok_btn.first.click()
        page.wait_for_timeout(500)

    page.get_by_text("gas_backend.gs", exact=True).click()
    page.wait_for_timeout(1500)

    func_dropdown = page.get_by_text("関数なし")
    if func_dropdown.count() == 0:
        func_dropdown = page.locator("[aria-label*='関数を選択'], select")
    func_dropdown.first.click()
    page.wait_for_timeout(1000)

    options = page.locator("li, [role='option']")
    target = None
    for i in range(options.count()):
        try:
            t = options.nth(i).inner_text().strip()
        except Exception:
            continue
        if t == "getSettings":
            target = options.nth(i)
            break
    if target is None:
        raise RuntimeError("関数一覧にgetSettingsが見つかりません(エディタのUIが変わった可能性)")
    target.scroll_into_view_if_needed()
    target.click()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="実行").first.click()
    page.wait_for_timeout(4000)


def _complete_google_consent(context, page):
    """「権限を確認」ボタンが出ていれば、Google同意画面まで自動で突破して許可する。
    ダイアログが出なければ(既に認可済み)Noneを返す。"""
    review_btn = page.get_by_text("権限を確認", exact=True)
    if review_btn.count() == 0:
        return None  # 既に認可済み、何もすることがない

    with context.expect_page(timeout=15000) as new_page_info:
        review_btn.first.click()
    auth_page = new_page_info.value
    auth_page.wait_for_load_state("networkidle", timeout=20000)
    auth_page.wait_for_timeout(1500)

    # 「未検証アプリ」警告 -> 「詳細」(2箇所ある、本物は.last) -> 「(安全ではないページ)に移動」
    auth_page.get_by_text("詳細", exact=True).last.click()
    auth_page.wait_for_timeout(1000)
    auth_page.get_by_text("に移動", exact=False).first.click()
    auth_page.wait_for_load_state("networkidle", timeout=20000)
    auth_page.wait_for_timeout(1500)

    # スコープ選択: 「すべて選択」を押さないとチェックが入らないまま続行されて失敗する
    select_all = auth_page.get_by_text("すべて選択", exact=True)
    if select_all.count() == 0:
        raise RuntimeError("同意画面に「すべて選択」が見つかりません(Google側のUI変更の可能性)")
    select_all.first.scroll_into_view_if_needed()
    select_all.first.click(force=True)
    auth_page.wait_for_timeout(800)

    auth_page.get_by_role("button", name="続行").click()
    auth_page.wait_for_timeout(2500)

    if not auth_page.is_closed():
        body = auth_page.inner_text("body")
        if "アクセス権は許可されませんでした" in body or "エラー" in body:
            raise RuntimeError(f"同意画面での許可に失敗しました: {body[:300]}")
    return True


def _run_once(log=print):
    _launch_chrome()
    time.sleep(2)
    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()

            page.goto(EDITOR_URL)
            try:
                page.wait_for_load_state("networkidle", timeout=20000)
            except Exception:
                pass
            page.wait_for_timeout(3000)

            _select_getsettings_and_run(page)
            granted = _complete_google_consent(context, page)

            page.wait_for_timeout(1500)
            log_text = page.inner_text("body")[-1500:]
            if "実行完了" not in log_text and granted is None:
                return False, f"getSettings実行後もログに実行完了が見えません: {log_text[-500:]}"

            log(f"再認可処理完了(granted={granted})")
            return True, None
    except Exception as e:
        return False, f"自動再認可中に例外: {e}"
    finally:
        _close_chrome()


def run(log=print, attempts=2):
    """UIの一時的な取りこぼし(要素がまだ描画されていない等)による偽の失敗を減らすため、
    Chromeを完全に再起動した上で最大attempts回試す(2026-08-23、ユーザーが手元にいない間に
    失敗して詰む事態を避けたいとの要望)。最後の試行の失敗理由を返す。"""
    last_reason = None
    for i in range(attempts):
        ok, reason = _run_once(log=log)
        if ok:
            return True, None
        last_reason = reason
        log(f"再認可の試行{i + 1}/{attempts}回目が失敗: {reason}")
        if i < attempts - 1:
            time.sleep(10)
    return False, last_reason


if __name__ == "__main__":
    ok, reason = run()
    print("OK" if ok else f"NG: {reason}")
    sys.exit(0 if ok else 1)
