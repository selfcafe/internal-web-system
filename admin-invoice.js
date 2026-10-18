// パートナー請求書の管理画面（2026-10-17〜）。管理者ポータルの「業務管理」にある「パートナー請求書」カードから開く。
// サーバー側は gas_backend.gs の「パートナー請求書: 管理者の窓口」（action: invoiceAdmin*）。
// 管理者ポータルのログインとは別に、請求書管理のパスワード（サーバーで照合）が要る。
// 住所・電話は画面に出さない（見るときは請求書のスプレッドシートを直接開く）。口座は登録しない運用（2026-10-18）。
(function () {
  'use strict';

  var STATUS = {
    none: { label: '未提出', bg: '#f3f4f6', fg: '#374151' },
    submitted: { label: '提出済み', bg: '#e0f2fe', fg: '#075985' },
    returned: { label: '差し戻し', bg: '#fee2e2', fg: '#991b1b' },
    approved: { label: '確認済み', bg: '#dcfce7', fg: '#166534' },
  };
  var KIND = { monthly: '月額（日割り）', per_visit: '回数×単価', oneoff: '単発の作業', expense: '経費', discount: '値引き' };
  var BASE = { schedule: '打刻の予定から', calendar: '月の日数', fixed: '固定' };
  var A = { token: null, periods: [], period: null, data: null, open: {} };
  var BTN = 'border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:600;';
  var INPUT = 'box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:7px 9px;font-size:14px;font-family:inherit;';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function yen(n) { return (Number(n) || 0).toLocaleString('ja-JP') + '円'; }
  function monthLabel(p) { var m = String(p).split('-'); return m[0] + '年' + Number(m[1]) + '月分'; }
  function $(id) { return document.getElementById(id); }
  function reviewer() { try { return localStorage.getItem('ainv_reviewer') || ''; } catch (e) { return ''; } }
  function storeName(id) { return (A.data && A.data.storeNames[id]) || id; }

  function overlay() {
    var o = $('ainv-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'ainv-overlay';
    o.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;overflow-y:auto;padding:16px;box-sizing:border-box';
    o.innerHTML = '<div style="background:#f7f7f5;max-width:960px;margin:0 auto;border-radius:12px;padding:16px;box-sizing:border-box">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
      + '<span style="font-weight:700;font-size:17px;color:#22703d">パートナー請求書の管理</span>'
      + '<button onclick="closeAdminInvoice()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#888" aria-label="閉じる">×</button></div>'
      + '<div id="ainv-body"></div></div>';
    document.body.appendChild(o);
    return o;
  }
  function body(html) { $('ainv-body').innerHTML = html; }
  function note(id, text, ok) { var el = $(id); if (el) { el.style.color = ok ? '#22703d' : '#dc2626'; el.innerHTML = text; } }

  async function call(action, params) {
    var res = await gasPost(action, Object.assign({ token: A.token }, params || {}));
    if (res && res.error && /パスワードを入れて/.test(res.error)) { A.token = null; showLogin(res.error); throw new Error('relogin'); }
    return res || {};
  }

  // ---------- ログイン ----------
  function showLogin(msg) {
    body('<div style="background:white;border-radius:10px;padding:16px;max-width:420px">'
      + '<div style="font-size:13px;color:#555;line-height:1.7;margin-bottom:8px">請求書管理のパスワードを入れてください（管理者ポータルのパスワードとは別です）。</div>'
      + '<input id="ainv-pw" type="password" autocomplete="off" style="' + INPUT + 'width:100%">'
      + '<div style="font-size:12px;color:#555;margin:10px 0 4px">確認する人の名前（確認済み・差し戻しの記録に残ります）</div>'
      + '<input id="ainv-who" value="' + esc(reviewer()) + '" style="' + INPUT + 'width:100%">'
      + '<div id="ainv-login-msg" style="font-size:13px;min-height:18px;margin-top:6px"></div>'
      + '<button id="ainv-login-btn" onclick="ainvLogin()" style="' + BTN + 'width:100%;background:#22703d;color:white;padding:11px;font-size:15px;margin-top:6px">開く</button></div>');
    if (msg) note('ainv-login-msg', esc(msg));
  }
  window.ainvLogin = async function () {
    var pw = $('ainv-pw').value, who = $('ainv-who').value.trim();
    if (!who) { note('ainv-login-msg', '確認する人の名前を入れてください'); return; }
    try { localStorage.setItem('ainv_reviewer', who); } catch (e) {}
    $('ainv-login-btn').disabled = true; note('ainv-login-msg', '確認しています…', true);
    try {
      var res = await gasPost('invoiceAdminLogin', { password: pw });
      if (!res.ok) { note('ainv-login-msg', esc(res.error || '開けませんでした')); $('ainv-login-btn').disabled = false; return; }
      A.token = res.token; A.periods = res.periods || [];
      loadList(A.period || A.periods[0]);
    } catch (e) { note('ainv-login-msg', '通信に失敗しました。もう一度押してください'); $('ainv-login-btn').disabled = false; }
  };

  // ---------- 月の一覧 ----------
  async function loadList(period) {
    A.period = period;
    body('<div style="color:#888;font-size:13px;padding:12px">読み込んでいます…</div>');
    try {
      var res = await call('invoiceAdminList', { period: period });
      if (!res.ok) { body('<div style="color:#dc2626">' + esc(res.error || '読み込めませんでした') + '</div>'); return; }
      A.data = res;
      renderList();
    } catch (e) { if (e.message !== 'relogin') body('<div style="color:#dc2626">通信に失敗しました。<a href="#" onclick="ainvReload();return false">もう一度読み込む</a></div>'); }
  }
  window.ainvReload = function () { loadList(A.period); };
  window.ainvChangePeriod = function (v) { loadList(v); };

  function badge(st) { var s = STATUS[st] || STATUS.none; return '<span style="background:' + s.bg + ';color:' + s.fg + ';border-radius:10px;padding:2px 9px;font-size:12px;font-weight:700;white-space:nowrap">' + s.label + '</span>'; }

  function renderList() {
    var d = A.data, counts = { none: 0, submitted: 0, returned: 0, approved: 0 };
    d.payees.forEach(function (p) { counts[p.submission ? p.submission.status : 'none']++; });
    var html = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">'
      + '<select onchange="ainvChangePeriod(this.value)" style="' + INPUT + 'font-weight:700">'
      + A.periods.map(function (x) { return '<option value="' + x + '"' + (x === A.period ? ' selected' : '') + '>' + monthLabel(x) + '</option>'; }).join('') + '</select>'
      + Object.keys(counts).map(function (k) { return badge(k) + ' <b>' + counts[k] + '</b>'; }).join('　')
      + '<span style="flex:1"></span>'
      + '<button onclick="ainvEditPayee()" style="' + BTN + 'background:#22703d;color:white;padding:8px 12px;font-size:13px">＋ 請求先を追加</button>'
      + '<button onclick="ainvReload()" style="' + BTN + 'background:#e5e7eb;color:#333;padding:8px 12px;font-size:13px">読み込み直す</button></div>'
      + '<div id="ainv-form"></div>';
    if (!d.payees.length) html += '<div style="background:white;border-radius:10px;padding:14px;font-size:13px">請求先がまだありません。「＋ 請求先を追加」から登録してください。</div>';
    d.payees.forEach(function (p) {
      var s = p.submission, flags = s ? s.flags : p.draft_flags;
      html += '<div style="background:white;border-radius:10px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)">'
        + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
        + badge(s ? s.status : 'none')
        + '<b>' + esc(p.name) + '</b><span style="font-size:12px;color:#666">' + (p.type === 'company' ? '会社' : '個人') + '・業者コード ' + esc(p.biz_code) + '</span>'
        + (!p.has_pin ? '<span style="font-size:11px;color:#b45309">暗証番号未発行</span>' : '')
        + (p.has_pin && !p.profile_complete ? '<span style="font-size:11px;color:#b45309">本人の登録待ち</span>' : '')
        + '<span style="flex:1"></span>'
        + '<b style="font-size:15px">' + (s ? yen(s.total) : (p.draft_total != null ? '<span style="color:#888;font-weight:400;font-size:12px">下書き</span> ' + yen(p.draft_total) : '')) + '</b></div>';
      if (flags && flags.length) html += '<div style="font-size:12px;color:#b45309;background:#fffbeb;border-radius:6px;padding:6px 8px;margin-top:8px">要確認:<br>・' + flags.map(esc).join('<br>・') + '</div>';
      if (s && s.status === 'returned') html += '<div style="font-size:12px;color:#991b1b;margin-top:6px">差し戻し理由: ' + esc(s.returned_reason) + '（' + esc(s.reviewed_by) + '）</div>';
      if (s && s.status === 'approved') html += '<div style="font-size:12px;color:#166534;margin-top:6px">確認: ' + esc(s.reviewed_by) + '（' + esc(s.reviewed_at) + '）</div>';
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
      if (s) {
        html += (s.pdf_url ? '<a href="' + esc(s.pdf_url) + '" target="_blank" rel="noopener" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px;text-decoration:none">請求書PDF</a>' : '')
          + (s.receipt_pdf_url ? '<a href="' + esc(s.receipt_pdf_url) + '" target="_blank" rel="noopener" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px;text-decoration:none">領収書PDF</a>' : '')
          + '<button onclick="ainvToggle(\'' + esc(p.id) + '\',\'lines\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px">明細</button>';
        if (s.status === 'submitted') html += '<button onclick="ainvReview(\'' + esc(p.id) + '\',\'approved\')" style="' + BTN + 'background:#22703d;color:white;padding:6px 10px;font-size:12px">確認済みにする</button>'
          + '<button onclick="ainvReview(\'' + esc(p.id) + '\',\'returned\')" style="' + BTN + 'background:#fee2e2;color:#991b1b;padding:6px 10px;font-size:12px">差し戻す</button>';
        if (s.status === 'approved') html += '<button onclick="ainvReview(\'' + esc(p.id) + '\',\'returned\')" style="' + BTN + 'background:#fee2e2;color:#991b1b;padding:6px 10px;font-size:12px">差し戻す（確認を取り消す）</button>';
      }
      html += '<button onclick="ainvToggle(\'' + esc(p.id) + '\',\'contracts\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px">契約（' + p.contracts.length + '）</button>'
        + '<button onclick="ainvEditPayee(\'' + esc(p.id) + '\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px">請求先を直す</button>'
        + '<button onclick="ainvIssuePin(\'' + esc(p.id) + '\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px">' + (p.has_pin ? '暗証番号を発行し直す' : '暗証番号を発行') + '</button></div>';
      if (s && A.open[p.id + ':lines']) html += linesTable(s.lines);
      if (A.open[p.id + ':contracts']) html += contractsBox(p);
      html += '</div>';
    });
    body(html);
  }

  function linesTable(lines) {
    return '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><tr style="background:#f3f4f6"><th style="text-align:left;padding:4px">店・担当</th><th style="text-align:left;padding:4px">種類</th><th style="text-align:left;padding:4px">内容</th><th style="text-align:right;padding:4px">金額</th></tr>'
      + lines.map(function (l) {
        var detail = l.kind === 'monthly' ? '出勤 ' + l.days + '/' + l.base_days + '日（月額 ' + yen(l.full_amount) + '）' : l.kind === 'per_visit' ? l.count + '回 × ' + yen(l.unit_price) : esc(l.note);
        if (l.reason) detail += '<br><span style="color:#b45309">理由: ' + esc(l.reason) + '</span>';
        return '<tr style="border-top:1px solid #eee"><td style="padding:4px">' + esc(l.store_name || '（店なし）') + (l.staff_name ? '（' + esc(l.staff_name) + '）' : '') + '</td><td style="padding:4px">' + KIND[l.kind] + '</td><td style="padding:4px">' + detail + '</td><td style="padding:4px;text-align:right;white-space:nowrap">' + yen(l.amount) + '</td></tr>';
      }).join('') + '</table>';
  }

  function contractsBox(p) {
    var html = '<div style="margin-top:8px;border-top:1px dashed #ddd;padding-top:8px">';
    if (!p.contracts.length) html += '<div style="font-size:12px;color:#666">契約がありません。</div>';
    p.contracts.forEach(function (c) {
      var base = c.kind === 'monthly' ? '基準日数: ' + (c.base_days_mode === 'fixed' ? c.base_days_fixed + '日（固定）' : BASE[c.base_days_mode || 'schedule']) : '';
      html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;padding:4px 0">'
        + '<b>' + esc(storeName(c.store_id)) + '</b>' + (c.staff_name ? '（' + esc(c.staff_name) + '）' : '')
        + '<span>' + KIND[c.kind] + ' ' + yen(c.amount) + (c.kind === 'per_visit' ? '／回' : '／月') + '</span>'
        + '<span style="color:#666">' + base + '</span>'
        + '<span style="color:#666">' + (c.from_month || '') + '〜' + (c.to_month || '') + '</span>'
        + (c.note ? '<span style="color:#666">' + esc(c.note) + '</span>' : '')
        + '<button onclick="ainvEditContract(\'' + esc(p.id) + '\',\'' + esc(c.id) + '\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:3px 8px;font-size:11px">直す</button>'
        + '<button onclick="ainvDeleteContract(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#fee2e2;color:#991b1b;padding:3px 8px;font-size:11px">削除</button></div>';
    });
    html += '<button onclick="ainvEditContract(\'' + esc(p.id) + '\')" style="' + BTN + 'background:white;border:1px solid #22703d;color:#22703d;padding:5px 10px;font-size:12px;margin-top:4px">＋ 契約を追加</button></div>';
    return html;
  }
  window.ainvToggle = function (id, what) { A.open[id + ':' + what] = !A.open[id + ':' + what]; renderList(); };

  // ---------- 確認・差し戻し ----------
  window.ainvReview = async function (payeeId, status) {
    var p = A.data.payees.find(function (x) { return x.id === payeeId; });
    var reason = '';
    if (status === 'returned') {
      reason = prompt(p.name + ' の' + monthLabel(A.period) + 'を差し戻します。理由を書いてください（本人の画面に出ます）');
      if (reason == null) return;
      if (!reason.trim()) { alert('理由を書いてください'); return; }
    } else if (!confirm(p.name + ' の' + monthLabel(A.period) + '（' + yen(p.submission.total) + '）を確認済みにします。よろしいですか？')) return;
    try {
      var res = await call('invoiceAdminReview', { payeeId: payeeId, period: A.period, status: status, reason: reason, by: reviewer() });
      if (!res.ok) { alert(res.error || 'できませんでした'); return; }
      loadList(A.period);
    } catch (e) { if (e.message !== 'relogin') alert('通信に失敗しました'); }
  };

  // ---------- 請求先 ----------
  window.ainvEditPayee = function (id) {
    var p = id ? A.data.payees.find(function (x) { return x.id === id; }) : { type: 'individual', biz_code: '', name: '' };
    $('ainv-form').innerHTML = '<div style="background:white;border:2px solid #22703d;border-radius:10px;padding:12px;margin-bottom:12px">'
      + '<b>' + (id ? '請求先を直す' : '請求先を追加') + '</b>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">'
      + '<select id="ainv-p-type" style="' + INPUT + '"><option value="individual"' + (p.type !== 'company' ? ' selected' : '') + '>個人</option><option value="company"' + (p.type === 'company' ? ' selected' : '') + '>会社</option></select>'
      + '<input id="ainv-p-name" placeholder="名前（社名）" value="' + esc(p.name) + '" style="' + INPUT + 'flex:1;min-width:180px">'
      + '<input id="ainv-p-biz" placeholder="業者コード（8桁）" inputmode="numeric" value="' + esc(p.biz_code) + '" style="' + INPUT + 'width:160px"></div>'
      + '<div style="font-size:11px;color:#666;margin-top:6px">住所・電話・登録番号は本人が最初に開いたときに登録します（口座は登録しない運用です）。</div>'
      + '<div id="ainv-p-msg" style="font-size:13px;min-height:18px;margin-top:6px"></div>'
      + '<button onclick="ainvSavePayee(\'' + esc(id || '') + '\')" style="' + BTN + 'background:#22703d;color:white;padding:7px 14px;font-size:13px">保存</button> '
      + '<button onclick="ainvCloseForm()" style="' + BTN + 'background:#e5e7eb;color:#333;padding:7px 14px;font-size:13px">やめる</button></div>';
    window.scrollTo(0, 0); $('ainv-overlay').scrollTop = 0;
  };
  window.ainvCloseForm = function () { $('ainv-form').innerHTML = ''; };
  window.ainvSavePayee = async function (id) {
    var payee = { id: id || '', type: $('ainv-p-type').value, name: $('ainv-p-name').value.trim(), biz_code: $('ainv-p-biz').value.trim() };
    note('ainv-p-msg', '保存しています…', true);
    try {
      var res = await call('invoiceAdminSavePayee', { payee: payee });
      if (!res.ok) { note('ainv-p-msg', esc(res.error || '保存できませんでした')); return; }
      loadList(A.period);
    } catch (e) { if (e.message !== 'relogin') note('ainv-p-msg', '通信に失敗しました'); }
  };
  window.ainvIssuePin = async function (id) {
    var p = A.data.payees.find(function (x) { return x.id === id; });
    if (!confirm(p.name + ' の暗証番号を' + (p.has_pin ? '発行し直します。前の番号は使えなくなります。' : '発行します。') + 'よろしいですか？')) return;
    try {
      var res = await call('invoiceAdminIssuePin', { payeeId: id });
      if (!res.ok) { alert(res.error || 'できませんでした'); return; }
      alert(p.name + ' の暗証番号: ' + res.pin + '\n\nこの番号はここでしか表示されません。本人に直接伝えてください（グループトークには書かないでください）。\n本人は「業務管理」→「請求書を開く」でこの番号を入れます。');
      loadList(A.period);
    } catch (e) { if (e.message !== 'relogin') alert('通信に失敗しました'); }
  };

  // ---------- 契約 ----------
  window.ainvEditContract = function (payeeId, contractId) {
    var p = A.data.payees.find(function (x) { return x.id === payeeId; });
    var c = contractId ? p.contracts.find(function (x) { return x.id === contractId; }) : { kind: 'monthly', base_days_mode: 'schedule', store_id: '', staff_name: '', amount: '', from_month: A.period, to_month: '', note: '' };
    var ids = Object.keys(A.data.storeNames).sort(function (a, b) { return (Number(A.data.storeCodes[a]) || 9999) - (Number(A.data.storeCodes[b]) || 9999); });
    $('ainv-form').innerHTML = '<div style="background:white;border:2px solid #22703d;border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px">'
      + '<b>' + esc(p.name) + ' の契約を' + (contractId ? '直す' : '追加') + '</b>'
      + '<div style="display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center;margin-top:8px">'
      + '<span>店</span><select id="ainv-c-store" onchange="ainvStaffOptions()" style="' + INPUT + '"><option value="">選んでください</option>'
      + ids.map(function (i) { return '<option value="' + esc(i) + '"' + (i === c.store_id ? ' selected' : '') + '>' + (A.data.storeCodes[i] ? A.data.storeCodes[i] + ' ' : '') + esc(A.data.storeNames[i]) + '</option>'; }).join('') + '</select>'
      + '<span>担当（打刻の名前）</span><select id="ainv-c-staff" style="' + INPUT + '"></select>'
      + '<span>種類</span><select id="ainv-c-kind" onchange="ainvKindChange()" style="' + INPUT + '"><option value="monthly"' + (c.kind !== 'per_visit' ? ' selected' : '') + '>月額（日割り）</option><option value="per_visit"' + (c.kind === 'per_visit' ? ' selected' : '') + '>回数×単価</option></select>'
      + '<span id="ainv-c-amount-label">' + (c.kind === 'per_visit' ? '単価（税込）' : '月額（税込）') + '</span><input id="ainv-c-amount" type="number" min="1" value="' + esc(c.amount) + '" style="' + INPUT + 'width:160px">'
      + '<span class="ainv-monthly">基準日数</span><div class="ainv-monthly" style="display:flex;gap:6px;align-items:center"><select id="ainv-c-base" onchange="ainvKindChange()" style="' + INPUT + '">'
      + Object.keys(BASE).map(function (k) { return '<option value="' + k + '"' + ((c.base_days_mode || 'schedule') === k ? ' selected' : '') + '>' + BASE[k] + '</option>'; }).join('')
      + '</select><input id="ainv-c-fixed" type="number" min="1" max="31" value="' + esc(c.base_days_fixed) + '" placeholder="日数" style="' + INPUT + 'width:80px"></div>'
      + '<span>期間</span><div style="display:flex;gap:6px;align-items:center"><input id="ainv-c-from" type="month" value="' + esc(c.from_month) + '" style="' + INPUT + '">〜<input id="ainv-c-to" type="month" value="' + esc(c.to_month) + '" style="' + INPUT + '"></div>'
      + '<span>メモ</span><input id="ainv-c-note" value="' + esc(c.note) + '" style="' + INPUT + '">'
      + '</div><div style="font-size:11px;color:#666;margin-top:6px">やめた契約は削除せず、終了月を入れてください（削除すると過去の月の下書きにも出なくなります）。「打刻の予定から」は業務管理のスタッフごとの予定（N日に1回・曜日）で基準日数を決めます。</div>'
      + '<div id="ainv-c-msg" style="font-size:13px;min-height:18px;margin-top:6px"></div>'
      + '<button onclick="ainvSaveContract(\'' + esc(payeeId) + '\',\'' + esc(contractId || '') + '\')" style="' + BTN + 'background:#22703d;color:white;padding:7px 14px;font-size:13px">保存</button> '
      + '<button onclick="ainvCloseForm()" style="' + BTN + 'background:#e5e7eb;color:#333;padding:7px 14px;font-size:13px">やめる</button></div>';
    window.ainvStaffOptions(c.staff_name);
    window.ainvKindChange();
    $('ainv-overlay').scrollTop = 0;
  };
  window.ainvStaffOptions = function (sel) {
    var store = $('ainv-c-store').value, names = (A.data.staffMap || {})[store] || [];
    if (sel == null) sel = $('ainv-c-staff').value;
    $('ainv-c-staff').innerHTML = '<option value="">（名前なし：店で1人・名前を登録していない）</option>'
      + names.map(function (n) { return '<option value="' + esc(n) + '"' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('')
      + (sel && names.indexOf(sel) < 0 ? '<option value="' + esc(sel) + '" selected>' + esc(sel) + '（業務管理に無い名前）</option>' : '');
  };
  window.ainvKindChange = function () {
    var monthly = $('ainv-c-kind').value === 'monthly';
    document.querySelectorAll('.ainv-monthly').forEach(function (el) { el.style.display = monthly ? '' : 'none'; });
    $('ainv-c-amount-label').textContent = monthly ? '月額（税込）' : '単価（税込）';
    $('ainv-c-fixed').style.display = $('ainv-c-base').value === 'fixed' ? '' : 'none';
  };
  window.ainvSaveContract = async function (payeeId, contractId) {
    var c = {
      id: contractId || '', payee_id: payeeId, store_id: $('ainv-c-store').value, staff_name: $('ainv-c-staff').value,
      kind: $('ainv-c-kind').value, amount: Number($('ainv-c-amount').value), base_days_mode: $('ainv-c-base').value,
      base_days_fixed: $('ainv-c-fixed').value, from_month: $('ainv-c-from').value, to_month: $('ainv-c-to').value, note: $('ainv-c-note').value,
    };
    note('ainv-c-msg', '保存しています…', true);
    try {
      var res = await call('invoiceAdminSaveContract', { contract: c });
      if (res.errors) { note('ainv-c-msg', res.errors.map(esc).join('<br>')); return; }
      if (!res.ok) { note('ainv-c-msg', esc(res.error || '保存できませんでした')); return; }
      A.open[payeeId + ':contracts'] = true;
      loadList(A.period);
    } catch (e) { if (e.message !== 'relogin') note('ainv-c-msg', '通信に失敗しました'); }
  };
  window.ainvDeleteContract = async function (id) {
    if (!confirm('この契約を削除します。過去の月の下書きにも出なくなります。やめた契約なら「直す」で終了月を入れるほうが安全です。削除しますか？')) return;
    try {
      var res = await call('invoiceAdminDeleteContract', { id: id });
      if (!res.ok) { alert(res.error || '削除できませんでした'); return; }
      loadList(A.period);
    } catch (e) { if (e.message !== 'relogin') alert('通信に失敗しました'); }
  };

  window.openAdminInvoice = function () {
    overlay().style.display = 'block';
    if (A.token) loadList(A.period || A.periods[0]); else showLogin();
  };
  window.closeAdminInvoice = function () { var o = $('ainv-overlay'); if (o) o.style.display = 'none'; };
})();
