"""
Gmail(IMAP)からワンタイムパスワードを自動取得する。
クリップボード経由の手動コピーを不要にするための共通モジュール。
"""
import email
import imaplib
import os
import re
import time
from email.header import decode_header

from dotenv import load_dotenv

load_dotenv()

GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS", "selfcafe001@gmail.com")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")


def _decode(value):
    if not value:
        return ""
    parts = decode_header(value)
    text = ""
    for part, enc in parts:
        if isinstance(part, bytes):
            text += part.decode(enc or "utf-8", errors="ignore")
        else:
            text += part
    return text


def _get_body(msg):
    if msg.is_multipart():
        html_fallback = None
        for part in msg.walk():
            ctype = part.get_content_type()
            charset = part.get_content_charset() or "utf-8"
            if ctype == "text/plain":
                try:
                    return part.get_payload(decode=True).decode(charset, errors="ignore")
                except Exception:
                    continue
            if ctype == "text/html" and html_fallback is None:
                try:
                    html_fallback = part.get_payload(decode=True).decode(charset, errors="ignore")
                except Exception:
                    pass
        return html_fallback or ""
    charset = msg.get_content_charset() or "utf-8"
    try:
        return msg.get_payload(decode=True).decode(charset, errors="ignore")
    except Exception:
        return ""


def get_baseline_uid():
    """
    OTPメール検知の基準UIDを取得する。ログインボタンを押す直前（＝OTPメール送信の
    トリガーを引く直前）に呼び出すことで、メール到着とのレースコンディションを防ぐ。
    """
    if not GMAIL_APP_PASSWORD:
        raise RuntimeError(".envにGMAIL_APP_PASSWORDが設定されていません")
    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    imap.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
    imap.select("INBOX")
    status, data = imap.uid("search", None, "ALL")
    imap.logout()
    uids = data[0].split() if status == "OK" and data[0] else []
    return max((int(u) for u in uids), default=0)


def get_otp_from_gmail(timeout=120, poll_interval=3, log=print, baseline_uid=None):
    """
    Gmail受信トレイを監視し、ワンタイムパスワードのメールが届き次第
    本文から数字コードを抽出して返す。baseline_uidより大きいUIDのメールのみが対象。
    baseline_uidを省略した場合は呼び出し時点のUIDを基準にする（後方互換。
    メール到着が呼び出しより先行する場合は検出漏れの原因になるため、
    可能な限りログイン送信直前に get_baseline_uid() で取得した値を渡すこと）。
    """
    if not GMAIL_APP_PASSWORD:
        raise RuntimeError(".envにGMAIL_APP_PASSWORDが設定されていません")

    log("Gmailからワンタイムパスワードを自動取得します...")

    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    imap.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
    imap.select("INBOX")

    if baseline_uid is None:
        status, data = imap.uid("search", None, "ALL")
        baseline_uid = max((int(u) for u in data[0].split()), default=0) if status == "OK" and data[0] else 0

    deadline = time.time() + timeout
    try:
        while time.time() < deadline:
            imap.select("INBOX")  # 再SELECTしないと同一セッションでは新着が反映されないことがある
            status, data = imap.uid("search", None, "ALL")
            if status == "OK" and data[0]:
                uids = data[0].split()
                new_uids = [u for u in uids if int(u) > baseline_uid]
                for uid in sorted(new_uids, key=lambda u: int(u), reverse=True):
                    status, msg_data = imap.uid("fetch", uid, "(RFC822)")
                    if status != "OK" or not msg_data or msg_data[0] is None:
                        continue
                    msg = email.message_from_bytes(msg_data[0][1])
                    subject = _decode(msg.get("Subject"))
                    body = _get_body(msg)
                    combined = f"{subject}\n{body}"
                    if "ワンタイムパスワード" in combined or "OTP" in combined.upper() or "認証コード" in combined:
                        match = re.search(r"(?<!\d)\d{6}(?!\d)", body) or re.search(r"(?<!\d)\d{4,8}(?!\d)", body)
                        if match:
                            otp = match.group()
                            log(f"OTP検出: {otp}")
                            return otp
            time.sleep(poll_interval)
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    raise RuntimeError(f"{timeout}秒以内にOTPメールを検出できませんでした")


if __name__ == "__main__":
    print(get_otp_from_gmail())
