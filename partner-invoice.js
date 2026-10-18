// パートナー請求書の画面（2026-10-17〜）。index.html の「業務管理」タブにある「請求書」ボタンから開く。
// サーバー側は gas_backend.gs の「パートナー請求書」ブロック（action: invoiceLogin / invoiceSaveProfile /
// invoiceGetMonth / invoiceSubmit）。金額はサーバーで計算し直すので、ここでの計算は表示用。
// 住所・電話は画面に持たない（サーバーは伏せ字で返す。直すときは入れ直してもらう）。
// 口座は登録しない運用（2026-10-18）なので、入力欄を出さずサーバーにも送らない。
(function () {
  'use strict';

  var KIND_LABEL = { monthly: '月額（日割り）', per_visit: '回数×単価', oneoff: '単発の作業', expense: '経費（立替）', discount: '値引き' };
  var S = { token: null, payee: null, periods: [], period: null, draft: [], lines: [], submission: null, files: {} };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function yen(n) { return (Number(n) || 0).toLocaleString('ja-JP') + '円'; }
  function monthLabel(p) { var m = String(p).split('-'); return m[0] + '年' + Number(m[1]) + '月分'; }
  function $(id) { return document.getElementById(id); }
  var BTN = 'border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;';
  var INPUT = 'width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:9px;font-size:15px;font-family:inherit;';

  function overlay() {
    var o = $('pinv-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'pinv-overlay';
    o.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;overflow-y:auto;padding:16px;box-sizing:border-box';
    o.innerHTML = '<div style="background:#f7f7f5;max-width:640px;margin:0 auto;border-radius:12px;padding:16px;box-sizing:border-box">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
      + '<span style="font-weight:700;font-size:17px;color:#22703d">請求書</span>'
      + '<button onclick="closePartnerInvoice()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#888" aria-label="閉じる">×</button></div>'
      + '<div id="pinv-body"></div></div>';
    document.body.appendChild(o);
    return o;
  }
  function body(html) { $('pinv-body').innerHTML = html; }
  function msg(id, text, ok) { var el = $(id); if (el) { el.style.color = ok ? '#22703d' : '#dc2626'; el.innerHTML = text; } }
  function errorList(list) { return '<ul style="margin:6px 0 0;padding-left:18px">' + list.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>'; }

  async function call(action, params) {
    var res = await gasPost(action, params || {});
    if (res && res.error && /暗証番号を入れて/.test(res.error)) { S.token = null; showPin(res.error); throw new Error('relogin'); }
    return res || {};
  }

  // ---------- 1. 暗証番号 ----------
  function showPin(note) {
    body('<div style="background:white;border-radius:10px;padding:16px">'
      + '<div style="font-size:13px;color:#555;line-height:1.7;margin-bottom:10px">本部からお知らせした<b>6桁の暗証番号</b>を入れてください。<br>会社で複数の店を受け持っている場合も、暗証番号は会社で1つです。</div>'
      + '<input id="pinv-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" style="' + INPUT + 'text-align:center;letter-spacing:6px;font-size:20px">'
      + '<div id="pinv-pin-msg" style="font-size:13px;min-height:18px;margin-top:6px"></div>'
      + '<button id="pinv-pin-btn" onclick="pinvLogin()" style="' + BTN + 'width:100%;background:#22703d;color:white;padding:12px;font-size:15px;margin-top:6px">開く</button></div>');
    if (note) msg('pinv-pin-msg', esc(note));
    setTimeout(function () { var i = $('pinv-pin'); if (i) { i.focus(); i.onkeydown = function (e) { if (e.key === 'Enter') window.pinvLogin(); }; } }, 50);
  }
  window.pinvLogin = async function () {
    var pin = ($('pinv-pin').value || '').trim();
    if (!/^\d{6}$/.test(pin)) { msg('pinv-pin-msg', '6桁の数字を入れてください'); return; }
    $('pinv-pin-btn').disabled = true; msg('pinv-pin-msg', '確認しています…', true);
    try {
      var res = await gasPost('invoiceLogin', { pin: pin });
      if (!res.ok) { msg('pinv-pin-msg', esc(res.error || '開けませんでした')); $('pinv-pin-btn').disabled = false; return; }
      S.token = res.token; S.payee = res.payee; S.periods = res.periods || [];
      if (!S.payee.profile_complete) showProfile(true); else showMonth(S.periods[0]);
    } catch (e) { msg('pinv-pin-msg', '通信に失敗しました。もう一度押してください'); $('pinv-pin-btn').disabled = false; }
  };

  // ---------- 2. 請求先の情報（初回登録・修正） ----------
  function field(key, label, opts) {
    opts = opts || {};
    var v = opts.keep ? '' : (S.payee[key] || '');
    return '<label style="display:block;font-size:12px;color:#555;margin:10px 0 4px">' + label + '</label>'
      + '<input id="pinv-f-' + key + '" value="' + esc(v) + '" placeholder="' + esc(opts.ph || '') + '"' + (opts.mode ? ' inputmode="' + opts.mode + '"' : '') + ' style="' + INPUT + '">';
  }
  function showProfile(first) {
    var p = S.payee;
    var keepNote = first ? '' : '<div style="font-size:12px;color:#b45309;margin-top:4px">住所・電話は伏せて表示しています。<b>空欄のままなら変わりません。</b></div>';
    body('<div style="background:white;border-radius:10px;padding:16px">'
      + '<div style="font-weight:700;margin-bottom:4px">' + (first ? '最初に、請求書に載せる情報を登録してください' : '請求先の情報を直す') + '</div>'
      + '<div style="font-size:12px;color:#555;line-height:1.6">業者コード ' + esc(p.biz_code || '（本部で設定）') + '。ここで登録した内容は毎月の請求書に自動で入ります。本部とご本人だけが使います。</div>' + keepNote
      + field('name', '社名（お名前）フルネーム')
      + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:12px 0 4px"><input type="checkbox" id="pinv-f-tax_exempt"' + (p.tax_exempt ? ' checked' : '') + ' onchange="pinvTax()"> 課税事業者ではない（インボイスの登録番号が無い）</label>'
      + '<div id="pinv-reg-wrap">' + field('registration_no', '登録番号（T と13桁の数字）', { ph: 'T1234567890123' }) + '</div>'
      + field('address', '住所（マンション名・部屋番号まで）', { keep: !first, ph: first ? '' : p.address })
      + field('tel', '電話番号（日中つながる番号）', { keep: !first, ph: first ? '090-0000-0000' : p.tel, mode: 'tel' })
      // 口座は欄だけ設けて、実際の番号は登録しない運用（2026-10-18。ハッキング等の対策）。入力欄は出さない
      + '<label style="display:block;font-size:12px;color:#555;margin:10px 0 4px">振込先の口座</label>'
      + '<div style="font-size:12px;color:#555;background:#f3f4f6;border-radius:6px;padding:8px 10px;line-height:1.6">口座番号などはこの画面では登録しません（安全のため）。振込先は本部で管理しています。変わったときは本部に直接お知らせください。</div>'
      + '<div id="pinv-prof-msg" style="font-size:13px;min-height:18px;margin-top:10px"></div>'
      + '<button id="pinv-prof-btn" onclick="pinvSaveProfile(' + (first ? 'true' : 'false') + ')" style="' + BTN + 'width:100%;background:#22703d;color:white;padding:12px;font-size:15px;margin-top:6px">登録する</button>'
      + (first ? '' : '<button onclick="pinvBackToMonth()" style="' + BTN + 'width:100%;background:#e5e7eb;color:#333;padding:10px;font-size:14px;margin-top:8px">戻る</button>')
      + '</div>');
    window.pinvTax();
  }
  window.pinvTax = function () { var c = $('pinv-f-tax_exempt'), w = $('pinv-reg-wrap'); if (c && w) w.style.display = c.checked ? 'none' : ''; };
  window.pinvSaveProfile = async function (first) {
    var keys = ['name', 'registration_no', 'address', 'tel'];
    var prof = {};
    keys.forEach(function (k) { var el = $('pinv-f-' + k); var v = el ? el.value.trim() : ''; if (v !== '' || first) prof[k] = v; });
    prof.tax_exempt = $('pinv-f-tax_exempt').checked;
    if (prof.tax_exempt) prof.registration_no = '';
    $('pinv-prof-btn').disabled = true; msg('pinv-prof-msg', '保存しています…', true);
    try {
      var res = await call('invoiceSaveProfile', { token: S.token, profile: prof });
      if (res.errors) { msg('pinv-prof-msg', '直してください:' + errorList(res.errors)); $('pinv-prof-btn').disabled = false; return; }
      if (!res.ok) { msg('pinv-prof-msg', esc(res.error || '保存できませんでした')); $('pinv-prof-btn').disabled = false; return; }
      S.payee = res.payee;
      showMonth(S.period || S.periods[0]);
    } catch (e) { if (e.message !== 'relogin') { msg('pinv-prof-msg', '通信に失敗しました。もう一度押してください'); $('pinv-prof-btn').disabled = false; } }
  };
  window.pinvBackToMonth = function () { showMonth(S.period || S.periods[0]); };

  // ---------- 3. 月の請求書 ----------
  function monthlyAmount(full, base, days) { full = Math.floor(full) || 0; base = Math.floor(base) || 0; days = Math.max(0, Math.floor(days) || 0); return full > 0 && base > 0 ? Math.floor(full * Math.min(days, base) / base) : 0; }
  function lineAmount(l) {
    if (l.kind === 'monthly') return monthlyAmount(l.full_amount, l.base_days, l.days);
    if (l.kind === 'per_visit') return (Math.floor(l.unit_price) || 0) * (Math.max(0, Math.floor(l.count) || 0));
    var a = Math.floor(Math.abs(Number(l.amount) || 0));
    return l.kind === 'discount' ? -a : a;
  }
  function storeOptions(sel) {
    var seen = {}, opts = '<option value="">（店なし）</option>';
    S.draft.forEach(function (d) { if (!seen[d.store_id]) { seen[d.store_id] = 1; opts += '<option value="' + esc(d.store_id) + '"' + (sel === d.store_id ? ' selected' : '') + '>' + esc(d.store_name) + '</option>'; } });
    return opts;
  }

  async function showMonth(period) {
    S.period = period; S.files = {};
    var p = S.payee;
    body('<div style="background:white;border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.7">'
      + '<b>' + esc(p.name) + '</b>（業者コード ' + esc(p.biz_code) + '）'
      + ' <a href="#" onclick="pinvEditProfile();return false" style="color:#22703d;margin-left:6px">登録内容を直す</a></div>'
      + '<select id="pinv-period" onchange="pinvChangePeriod(this.value)" style="' + INPUT + 'margin-bottom:12px;font-weight:700">'
      + S.periods.map(function (x) { return '<option value="' + x + '"' + (x === period ? ' selected' : '') + '>' + monthLabel(x) + '</option>'; }).join('') + '</select>'
      + '<div id="pinv-month"><div style="color:#888;font-size:13px;padding:12px">読み込んでいます…</div></div>');
    try {
      var res = await call('invoiceGetMonth', { token: S.token, period: period });
      if (!res.ok) { $('pinv-month').innerHTML = '<div style="color:#dc2626">' + esc(res.error || '読み込めませんでした') + '</div>'; return; }
      S.draft = res.draft || []; S.submission = res.submission;
      // 出し直しのときは前回の入力（日数・回数・理由・追加した行）から始める
      var prev = S.submission && S.submission.lines ? S.submission.lines : null;
      S.lines = S.draft.map(function (d) {
        var o = Object.assign({}, d, { reason: '' });
        var pl = prev && prev.find(function (x) { return x.contract_id === d.contract_id; });
        if (pl) { if (d.kind === 'monthly') o.days = pl.days; else o.count = pl.count; o.reason = pl.reason || ''; }
        return o;
      });
      if (prev) prev.forEach(function (x) { if (!x.contract_id) S.lines.push({ kind: x.kind, store_id: x.store_id, store_name: x.store_name, note: x.note, amount: Math.abs(x.amount) }); });
      renderMonth();
    } catch (e) { if (e.message !== 'relogin') $('pinv-month').innerHTML = '<div style="color:#dc2626">通信に失敗しました。月を選び直してください</div>'; }
  }
  window.pinvChangePeriod = function (v) { showMonth(v); };
  window.pinvEditProfile = function () { showProfile(false); };

  function statusBanner() {
    var s = S.submission;
    if (!s) return '<div style="font-size:12px;color:#555;background:#fef9c3;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-bottom:10px;line-height:1.6">打刻の記録から下書きを作りました。日数・回数を確かめ、作業・経費・値引きがあれば足してから「提出する」を押してください。<b>締め切りは翌月5日</b>です。</div>';
    if (s.status === 'approved') return '<div style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:13px"><b>本部が確認しました。</b>合計 ' + yen(s.total) + '（' + esc(s.submitted_at) + ' 提出）</div>';
    if (s.status === 'returned') return '<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:13px"><b>本部から差し戻されました。</b>直して出し直してください。<br>理由: ' + esc(s.returned_reason || '（なし）') + '</div>';
    return '<div style="background:#e0f2fe;border:1px solid #7dd3fc;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:13px"><b>提出済み</b>（' + esc(s.submitted_at) + '、合計 ' + yen(s.total) + '）。直すときは出し直せます（本部が確認するまで）。経費の領収書の写真は付け直してください。</div>';
  }

  function renderMonth() {
    var locked = S.submission && S.submission.status === 'approved';
    var dis = locked ? ' disabled' : '';
    var html = statusBanner();
    if (!S.draft.length) html += '<div style="font-size:13px;color:#555;background:white;border-radius:8px;padding:10px;margin-bottom:10px">この月の契約が見つかりません。本部に連絡してください。</div>';
    S.lines.forEach(function (l, i) {
      var amt = lineAmount(l);
      html += '<div style="background:white;border-radius:10px;padding:12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><div><span style="font-size:11px;color:#22703d;font-weight:700">' + KIND_LABEL[l.kind] + '</span><br>';
      if (l.contract_id) {
        html += '<b>' + esc(l.store_name) + '</b>' + (l.staff_name ? '（' + esc(l.staff_name) + '）' : '') + '</div><div id="pinv-amt-' + i + '" style="font-weight:700;white-space:nowrap">' + yen(amt) + '</div></div>';
        var isM = l.kind === 'monthly', cur = isM ? l.days : l.count, auto = isM ? l.auto_days : l.auto_count;
        html += '<div style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:13px;flex-wrap:wrap">'
          + (isM ? '出勤 ' : '回数 ') + '<input type="number" min="0" max="' + (isM ? 31 : 100) + '" value="' + esc(cur) + '"' + dis + ' oninput="pinvSetNum(' + i + ',this.value)" style="width:70px;' + INPUT.replace('width:100%;', '') + 'padding:6px">'
          + (isM ? ' / ' + l.base_days + '日（月額 ' + yen(l.full_amount) + '）' : ' 回 × ' + yen(l.unit_price))
          + '<span style="color:#888;font-size:12px">打刻 ' + auto + (isM ? '日' : '回') + '</span></div>';
        html += '<input id="pinv-reason-' + i + '" placeholder="打刻と違う理由（例: 9/30 の打刻忘れ）" value="' + esc(l.reason) + '"' + dis + ' oninput="pinvSetText(' + i + ',\'reason\',this.value)" style="' + INPUT + 'margin-top:6px;font-size:13px;border-color:#f59e0b;display:' + (Number(cur) !== auto ? 'block' : 'none') + '">';
        if (l.out_of_range && l.out_of_range.length) html += '<div style="font-size:11px;color:#b45309;margin-top:4px">店から離れた場所での打刻: ' + esc(l.out_of_range.join(', ')) + '（本部が確認します）</div>';
        if (l.on_leave && l.on_leave.length) html += '<div style="font-size:11px;color:#b45309;margin-top:4px">休み申請の日の打刻: ' + esc(l.on_leave.join(', ')) + '（本部が確認します）</div>';
      } else {
        html += '</div><div style="display:flex;gap:6px;align-items:center"><b id="pinv-amt-' + i + '" style="white-space:nowrap">' + yen(amt) + '</b>'
          + (locked ? '' : '<button onclick="pinvRemove(' + i + ')" style="' + BTN + 'background:#fee2e2;color:#b91c1c;padding:4px 8px;font-size:12px">削除</button>') + '</div></div>'
          + '<select' + dis + ' onchange="pinvSetText(' + i + ',\'store_id\',this.value)" style="' + INPUT + 'margin-top:8px;font-size:13px">' + storeOptions(l.store_id) + '</select>'
          + '<input placeholder="内容（例: リフレッシュ清掃、ゴミ袋、ボリュームディスカウント）" value="' + esc(l.note) + '"' + dis + ' oninput="pinvSetText(' + i + ',\'note\',this.value)" style="' + INPUT + 'margin-top:6px;font-size:13px">'
          + '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px">' + (l.kind === 'discount' ? '値引き額 −' : '金額（税込）') + '<input type="number" min="0" value="' + esc(l.amount) + '"' + dis + ' oninput="pinvSetNum(' + i + ',this.value)" style="width:120px;' + INPUT.replace('width:100%;', '') + 'padding:6px">円</div>';
        if (l.kind === 'expense') html += '<div style="margin-top:6px;font-size:12px">領収書の写真（必須）: <input type="file" accept="image/*"' + dis + ' onchange="pinvSetFile(' + i + ',this.files[0])"> ' + (S.files[i] ? '<span style="color:#22703d">✓ ' + esc(S.files[i].name) + '</span>' : '') + '</div>';
      }
      html += '</div>';
    });
    if (!locked) {
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 12px">'
        + ['oneoff', 'expense', 'discount'].map(function (k) { return '<button onclick="pinvAdd(\'' + k + '\')" style="' + BTN + 'background:white;border:1px solid #22703d;color:#22703d;padding:8px 10px;font-size:13px">＋ ' + KIND_LABEL[k] + '</button>'; }).join('') + '</div>';
    }
    var total = S.lines.reduce(function (t, l) { return t + lineAmount(l); }, 0);
    html += '<div style="background:white;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;font-size:16px;font-weight:700;margin-bottom:10px"><span>合計（税込）</span><span id="pinv-total">' + yen(total) + '</span></div>'
      + '<div id="pinv-submit-msg" style="font-size:13px;min-height:18px;margin-bottom:6px"></div>'
      + (locked ? '' : '<button id="pinv-submit-btn" onclick="pinvSubmit()" style="' + BTN + 'width:100%;background:#22703d;color:white;padding:13px;font-size:16px">' + (S.submission ? '出し直す' : '提出する') + '</button>');
    $('pinv-month').innerHTML = html;
  }

  window.pinvSetNum = function (i, v) {
    var l = S.lines[i];
    if (l.kind === 'monthly') l.days = v; else if (l.kind === 'per_visit') l.count = v; else l.amount = v;
    // 打刻と違うときだけ理由の欄を出す（描き直すと入力中の欄から外れるので、表示だけ切り替える）
    var r = $('pinv-reason-' + i);
    if (r) r.style.display = Number(l.kind === 'monthly' ? l.days : l.count) !== (l.kind === 'monthly' ? l.auto_days : l.auto_count) ? 'block' : 'none';
    var a = $('pinv-amt-' + i); if (a) a.textContent = yen(lineAmount(l));
    var t = $('pinv-total'); if (t) t.textContent = yen(S.lines.reduce(function (s, x) { return s + lineAmount(x); }, 0));
  };
  window.pinvSetText = function (i, k, v) {
    S.lines[i][k] = v;
    if (k === 'store_id') { var d = S.draft.find(function (x) { return x.store_id === v; }); S.lines[i].store_name = d ? d.store_name : ''; S.lines[i].store_code = d ? d.store_code : ''; }
  };
  window.pinvAdd = function (kind) { S.lines.push({ kind: kind, store_id: '', store_name: '', note: '', amount: '' }); renderMonth(); };
  window.pinvRemove = function (i) {
    S.lines.splice(i, 1);
    var nf = {}; Object.keys(S.files).forEach(function (k) { k = Number(k); if (k < i) nf[k] = S.files[k]; else if (k > i) nf[k - 1] = S.files[k]; });
    S.files = nf; renderMonth();
  };
  window.pinvSetFile = function (i, f) { if (f) { S.files[i] = f; renderMonth(); } };

  // 領収書の写真は文字が読めるよう長辺 1600px・JPEG 0.8 に縮める
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var MAX = 1600, w = img.width, h = img.height;
          if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
          var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
        };
        img.onerror = reject; img.src = e.target.result;
      };
      rd.onerror = reject; rd.readAsDataURL(file);
    });
  }

  window.pinvSubmit = async function () {
    var total = S.lines.reduce(function (t, l) { return t + lineAmount(l); }, 0);
    if (!confirm(monthLabel(S.period) + 'の請求書を' + (S.submission ? '出し直し' : '提出し') + 'ます。合計 ' + yen(total) + '。よろしいですか？')) return;
    var btn = $('pinv-submit-btn'); btn.disabled = true;
    msg('pinv-submit-msg', '請求書を作っています（30秒ほどかかります）…', true);
    try {
      var receipts = [];
      for (var k in S.files) receipts.push({ line_index: Number(k), base64: await shrink(S.files[k]), mime: 'image/jpeg', name: S.files[k].name });
      var lines = S.lines.map(function (l) {
        if (l.contract_id) return { kind: l.kind, contract_id: l.contract_id, days: l.days, count: l.count, reason: l.reason || '' };
        return { kind: l.kind, store_id: l.store_id, store_code: l.store_code, store_name: l.store_name, note: l.note, amount: l.amount };
      });
      var res = await call('invoiceSubmit', { token: S.token, period: S.period, lines: lines, receipts: receipts });
      if (res.errors) { msg('pinv-submit-msg', '直してください:' + errorList(res.errors)); btn.disabled = false; return; }
      if (!res.ok) { msg('pinv-submit-msg', esc(res.error || '提出できませんでした')); btn.disabled = false; return; }
      body('<div style="background:white;border-radius:10px;padding:20px;text-align:center;line-height:1.8">'
        + '<div style="font-size:18px;font-weight:700;color:#22703d">' + (res.resubmitted ? '出し直しました' : '提出しました') + '</div>'
        + monthLabel(S.period) + '　合計 <b>' + yen(res.total) + '</b><br><span style="font-size:12px;color:#555">本部が確認します。差し戻しがあればこの画面に表示されます。</span>'
        + '<button onclick="closePartnerInvoice()" style="' + BTN + 'width:100%;background:#22703d;color:white;padding:12px;font-size:15px;margin-top:14px">閉じる</button></div>');
    } catch (e) { if (e.message !== 'relogin') { msg('pinv-submit-msg', '通信に失敗しました。提出できたか分からないときは、この画面を開き直して状態を確かめてください'); btn.disabled = false; } }
  };

  window.openPartnerInvoice = function () {
    overlay().style.display = 'block';
    if (S.token && S.payee) showMonth(S.period || S.periods[0]); else showPin();
  };
  window.closePartnerInvoice = function () { var o = $('pinv-overlay'); if (o) o.style.display = 'none'; };
})();
