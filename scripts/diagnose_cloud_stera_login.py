#!/usr/bin/env python3
"""
クラウド(GitHub Actions ubuntu-latest、データセンターIP)からステラダッシュボードへの
ログインを試す、読み取り専用の診断スクリプト。ログイン以外は一切操作しない。

2026-08-08の実地検証で「reCAPTCHAがデータセンターIPをブロックする」と結論づけていたが、
このテストは素のPlaywright起動(chromium.launch(), 既定のバンドル版Chromium)を使っていた
可能性が高い。一方でimport_stera_daily_sales.pyには「独立したChromeプロセスにCDP接続する
方式(kaihipay-downloaderのe-MOSS/kaihipay自動化と同じパターン)だとCAPTCHAが出ない」と
明記されており、kaihipay側でも「データセンターIPが原因」という長期間の思い込みが実際には
navigator.webdriver検知だったと判明した前例がある(project_kaihipay_pipeline_architecture
参照)。

この診断では、kaihipayのe-MOSS対応(pipeline/browser.pyのlaunch_emoss_browser)と同じ手法
(実Chromeチャンネル+--disable-blink-features=AutomationControlled+navigator.webdriver隠蔽)
でログインだけを試し、reCAPTCHAが依然として出るかどうかをスクリーンショットで確認する。
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
from gmail_otp import get_baseline_uid, get_otp_from_gmail  # noqa: E402

load_dotenv(SCRIPT_DIR.parent / ".env")

STERA_BASE_URL = "https://dashboard.sterasmartone.com"
SCREENSHOT_PATH = SCRIPT_DIR / "_downloads" / "diagnose_cloud_stera_login.png"

DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def main():
    email = os.environ.get("STERA_EMAIL")
    password = os.environ.get("STERA_PASSWORD")
    if not email or not password:
        sys.exit("環境変数 STERA_EMAIL / STERA_PASSWORD を設定してください")

    SCREENSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(user_agent=DESKTOP_USER_AGENT)
        context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
        page = context.new_page()

        console_messages = []
        page.on("console", lambda msg: console_messages.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda exc: console_messages.append(f"[pageerror] {exc}"))

        page.goto(STERA_BASE_URL + "/")
        page.wait_for_load_state("domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            print("networkidleがタイムアウトしました(無視して続行)")

        # 2026-09-13追記: 初回試行でスプラッシュ画面(ブランドロゴのみ)から先に進まなかった。
        # e-MOSSの「タイミングレース」前例と同様、単に読み込みが遅いだけの可能性があるため、
        # 8秒では足りないかもしれないと考え、最大60秒(3秒間隔)まで粘り強くポーリングする。
        email_input = page.get_by_placeholder("メールアドレス")
        found = False
        for _ in range(20):
            if email_input.count() > 0 and email_input.is_visible():
                found = True
                break
            page.wait_for_timeout(3000)
        if not found:
            print("結果: 60秒待ってもログインフォームが出現しませんでした(予期しない状態)")
            page.screenshot(path=str(SCREENSHOT_PATH))
            (SCREENSHOT_PATH.parent / "diagnose_cloud_stera_login.html").write_text(page.content(), encoding="utf-8")
            print("--- console/pageerror ---")
            for m in console_messages:
                print(m)
            browser.close()
            return

        email_input.fill(email)
        page.get_by_placeholder("パスワード").fill(password)
        page.get_by_role("button", name="ログイン").click()

        try:
            page.get_by_placeholder("メールアドレス").wait_for(state="detached", timeout=15000)
            print("結果: ID/PWログイン成功(reCAPTCHAは出ませんでした)")
            print(f"到達URL: {page.url}")
        except Exception:
            body_text = page.inner_text("body")
            has_captcha_text = "ロボットではありません" in body_text or "recaptcha" in body_text.lower()
            print(f"結果: ログインフォームが消えず失敗しました(reCAPTCHA文言の検出: {has_captcha_text})")
            print(f"URL: {page.url}")
            page.screenshot(path=str(SCREENSHOT_PATH))
            browser.close()
            return

        # 2026-09-13追加: ID/PWログイン後に出る二要素認証(メール認証コード)を、
        # kaihipay-downloaderと同じGmail IMAP監視方式で突破する。
        send_code_btn = page.get_by_role("button", name="メール認証コードを送信")
        try:
            send_code_btn.wait_for(state="visible", timeout=10000)
        except Exception:
            print("結果: 「メール認証コードを送信」ボタンが見つかりません(2FA画面の構造が想定と違う可能性)")
            page.screenshot(path=str(SCREENSHOT_PATH))
            (SCREENSHOT_PATH.parent / "diagnose_cloud_stera_login.html").write_text(page.content(), encoding="utf-8")
            browser.close()
            return

        baseline_uid = get_baseline_uid()
        send_code_btn.click()
        print("メール認証コードの送信をクリックしました。Gmailを監視します…")

        try:
            otp = get_otp_from_gmail(timeout=120, log=print, baseline_uid=baseline_uid)
        except Exception as e:
            print(f"結果: Gmailからの認証コード取得に失敗しました: {e}")
            page.screenshot(path=str(SCREENSHOT_PATH))
            (SCREENSHOT_PATH.parent / "diagnose_cloud_stera_login.html").write_text(page.content(), encoding="utf-8")
            browser.close()
            return
        print(f"認証コード取得: {otp}")

        # コード入力欄のplaceholder/構造が未確認のため、まずスクリーンショット/HTMLを保存してから
        # 汎用的に「表示されているテキスト入力欄」を探して埋める(placeholder名に依存しない)。
        page.screenshot(path=str(SCREENSHOT_PATH.with_name("diagnose_cloud_stera_2fa_form.png")))
        (SCREENSHOT_PATH.parent / "diagnose_cloud_stera_2fa_form.html").write_text(page.content(), encoding="utf-8")

        code_input = None
        for loc in [
            page.get_by_placeholder("認証コード"),
            page.get_by_placeholder("コード"),
            page.locator('input[type="text"]:visible'),
            page.locator('input[type="tel"]:visible'),
            page.locator('input[type="number"]:visible'),
        ]:
            try:
                if loc.count() > 0 and loc.first.is_visible():
                    code_input = loc.first
                    break
            except Exception:
                continue

        if code_input is None:
            print("結果: 認証コード入力欄が見つかりませんでした(2fa_form.png/htmlで構造確認が必要)")
            browser.close()
            return

        code_input.fill(otp)
        submit_btn = None
        for name in ["認証", "確認", "送信", "ログイン"]:
            candidate = page.get_by_role("button", name=name)
            if candidate.count() > 0:
                submit_btn = candidate.first
                break
        if submit_btn is not None:
            submit_btn.click()
        else:
            print("結果: 認証コード送信後の確定ボタンが見つからず、Enterキーで代替します")
            code_input.press("Enter")

        page.wait_for_timeout(5000)
        print(f"最終到達URL: {page.url}")
        page.screenshot(path=str(SCREENSHOT_PATH.with_name("diagnose_cloud_stera_final.png")))
        browser.close()


if __name__ == "__main__":
    main()
