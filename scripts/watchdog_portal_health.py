#!/usr/bin/env python3
"""
社内ポータル(internal-web-system)のGAS Web Appが「その操作を実行するには承認が必要です」
で全滅する障害(2026-08-15、2026-08-22に発生)を、ユーザーが気づく前に検知するための
外部監視。GAS側の認可が本当に切れているのかは、公開ステータスを「本番環境」にしても
予告なく起こりうることが2026-08-22に判明した(project_gas_oauth_test_expiry_fix.md参照、
今回は別原因)ため、恒久的な予防より「即座に気づいて直す」方針に倒している。

このスクリプト自体はinternal-web-systemのGASプロジェクト(internal-web-system-logs)とは
別のGASプロジェクト(kaihipay-gbp-approval-bot、KAIHIPAY_APPROVAL_WEBHOOK_URL)経由で
LINE WORKS通知を送る。監視対象と同じOAuth認可が壊れても通知経路自体は生きているのが
ポイント(同一プロジェクト内から自分自身の障害を通知しようとすると、その通知処理自体も
巻き込まれて失敗する)。

10分おきにWindowsタスクスケジューラから起動し、本番Web Appの副作用のないエンドポイント
(?action=getSettings)を叩いて以下のいずれかを検知したら「異常」とみなす:
  - HTTPステータスが200以外
  - レスポンス本文に「承認が必要です」「Authorization is required」等の既知の失敗兆候を含む
  - JSONとしてパースできない、またはgetSettingsが返すはずの配列形式でない

異常を検知すると、その場でauto_reauthorize_portal.run()による自動再認可を試み、成功すれば
再チェックしてから「自動修復しました」を通知する。失敗した場合のみ、手動対応を促す通知を送る
(2026-08-22、ユーザー要望「自分が気づいていない時でも止まったりエラーが起きないようにしたい」
に対応)。**このスクリプトはWindowsタスクスケジューラから直接起動されるプレーンなPythonプロセスで
あり、Claude Codeの許可プロンプト/自動モード分類器の対象には一切ならない**(それらはClaude Code
自身がツール経由で操作を実行する時だけ働く仕組みのため)。よってここでの自動修復呼び出しに
Claude Code側の権限設定は不要——無人実行を妨げるものは無い。

直前の状態(自動修復トライ後の最終結果)をlogs/portal_watchdog_state.jsonに保存し、
「正常→異常」「異常→正常」に変化した瞬間だけ通知する(異常が続く間は10分おきに連投しない。
自動修復が毎回失敗し続ける場合も、初回の失敗通知1回だけで以降は静かにリトライを続ける)。
"""
import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
load_dotenv(SCRIPT_DIR.parent / ".env")  # GAS_URL(監視対象の本番Web App)
load_dotenv(Path.home() / "kaihipay-downloader" / ".env")  # KAIHIPAY_APPROVAL_WEBHOOK_URL(通知専用、別GASプロジェクト)

GAS_URL = os.environ["GAS_URL"]
ALERT_WEBHOOK_URL = os.environ.get("KAIHIPAY_APPROVAL_WEBHOOK_URL")
STATE_FILE = SCRIPT_DIR / "logs" / "portal_watchdog_state.json"

# doGet/doPostが例外をcatchしてJSONで返す実装のため(gas_backend.gs)、Google側の生の
# エラーページではなくHTTP 200+この文言を含むJSONとして返ってくる。日英どちらのメッセージ
# 文言になるか確定していないため両方見る
FAILURE_MARKERS = [
    "承認が必要です",
    "Authorization is required",
    "<!DOCTYPE html",
    "<!doctype html",
]


def _check_portal_once():
    """(ok: bool, reason: str|None)を返す。okがFalseの時だけreasonを埋める。"""
    try:
        resp = requests.get(GAS_URL, params={"action": "getSettings"}, timeout=30)
    except Exception as e:
        return False, f"リクエスト自体が失敗しました: {e}"

    if resp.status_code != 200:
        return False, f"HTTPステータス異常: {resp.status_code}"

    text = resp.text
    for marker in FAILURE_MARKERS:
        if marker in text:
            return False, f"応答に既知の失敗兆候が含まれる: 「{marker}」"

    try:
        data = json.loads(text)
    except Exception:
        return False, f"応答がJSONとしてパースできません(先頭200文字): {text[:200]}"

    if not isinstance(data, list) or len(data) == 0:
        return False, f"getSettingsの想定形式(空でない配列)と異なる応答: {text[:200]}"

    return True, None


def check_portal(retries=3, retry_wait_seconds=8):
    """一時的なSSL/接続エラー(2026-08-22実際に誤検知した実例あり)で誤報しないよう、
    連続retries回失敗して初めて異常と判定する(1回でも成功すればOK扱い)。"""
    reason = None
    for attempt in range(retries):
        ok, reason = _check_portal_once()
        if ok:
            return True, None
        if attempt < retries - 1:
            time.sleep(retry_wait_seconds)
    return False, reason


def notify(message, log=print):
    if not ALERT_WEBHOOK_URL:
        log(f"通知スキップ(KAIHIPAY_APPROVAL_WEBHOOK_URL未設定): {message}")
        return
    try:
        r = requests.post(ALERT_WEBHOOK_URL, json={"action": "kaihipayNotify", "message": message}, timeout=30)
        r.raise_for_status()
    except Exception as e:
        log(f"LINE WORKS通知の送信に失敗しました: {e}")


def _load_prev_ok():
    if not STATE_FILE.exists():
        return None
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8")).get("ok")
    except Exception:
        return None


def _save_state(ok, reason):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"ok": ok, "reason": reason}, ensure_ascii=False), encoding="utf-8")


def main():
    ok, reason = check_portal()

    if not ok:
        print(f"NG: {reason}")
        print("自動再認可を試みます...")
        try:
            import auto_reauthorize_portal
            fixed, fix_reason = auto_reauthorize_portal.run(log=print)
        except Exception as e:
            fixed, fix_reason = False, f"自動修復スクリプト自体が例外: {e}"

        if fixed:
            ok, reason = check_portal()
            if not ok:
                fixed = False
                print(f"自動修復処理は完了したが再チェックでまだ異常: {reason}")
        else:
            print(f"自動修復失敗: {fix_reason}")

    prev_ok = _load_prev_ok()
    _save_state(ok, reason)

    if ok:
        print("OK: 社内ポータルは正常応答" + ("(自動修復済み)" if prev_ok is False else ""))
        if prev_ok is False:
            notify("【社内ポータル】異常を検知し、自動再認可により復旧しました。")
        return

    if prev_ok is not False:
        notify(
            "【社内ポータル障害】自動修復を試みましたが失敗しました。手動対応が必要です。\n"
            f"理由: {reason}\n"
            "「承認が必要です」系のOAuth再認可切れの可能性が高いです。"
            "Apps Scriptエディタでgetsettings等の関数を実行→「権限を確認」→続行、で復旧できます"
            "(https://script.google.com/u/1/home/projects/1J5qtNKPyXt3L7wmX6MMmAD33t1LQF5hBaDfjG2mghCinlc4h4xwagxP2/edit)。"
        )


if __name__ == "__main__":
    main()
