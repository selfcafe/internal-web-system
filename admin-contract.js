// 業務委託契約書の電子締結：管理者の画面（2026-11-17）。管理者ポータルの「業務管理」の「業務委託契約書」カードから開く。
// サーバー側は gas_backend.gs の「業務委託契約書の電子締結」（contractList / contractCreate / contractSendLink / contractApprove / contractCancel）。
// 管理者の通行証が要る（gasPost が付ける）。相手の画面は contract.html。
(function () {
  'use strict';
  var STATUS = {
    sent: { label: '相手の同意待ち', bg: '#fef9c3', fg: '#854d0e' },
    agreed: { label: '承認待ち（相手は同意済み）', bg: '#e0f2fe', fg: '#075985' },
    signed: { label: '締結済み', bg: '#dcfce7', fg: '#166534' },
    canceled: { label: '取り消し', bg: '#f3f4f6', fg: '#6b7280' },
    creating: { label: '作成中', bg: '#f3f4f6', fg: '#6b7280' },
  };
  var BTN = 'border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:600;';
  var INPUT = 'box-sizing:border-box;border:1px solid #ddd;border-radius:6px;padding:8px 10px;font-size:14px;font-family:inherit;width:100%;';
  var C = { list: [] };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function who() { try { return localStorage.getItem('actr_who') || ''; } catch (e) { return ''; } }
  function setWho(v) { try { localStorage.setItem('actr_who', v); } catch (e) {} }
  function storeName(id) { return (typeof STORES !== 'undefined' && STORES[id]) || id || ''; }

  function overlay() {
    var o = $('actr-overlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'actr-overlay';
    o.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;overflow-y:auto;padding:16px;box-sizing:border-box';
    o.innerHTML = '<div style="background:#f7f7f5;max-width:860px;margin:0 auto;border-radius:12px;padding:16px;box-sizing:border-box">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
      + '<span style="font-weight:700;font-size:17px;color:#22703d">業務委託契約書（電子締結）</span>'
      + '<button onclick="closeAdminContract()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#888" aria-label="閉じる">×</button></div>'
      + '<div id="actr-body"></div></div>';
    document.body.appendChild(o);
    return o;
  }
  function note(id, html, ok) { var el = $(id); if (el) { el.style.color = ok ? '#22703d' : '#dc2626'; el.innerHTML = html; } }

  async function load() {
    $('actr-body').innerHTML = '<div style="color:#888;font-size:13px;padding:12px">読み込んでいます…</div>';
    try {
      var res = await gasPost('contractList', {});
      if (!res || !res.ok) { $('actr-body').innerHTML = '<div style="color:#dc2626">' + esc((res && res.error) || '読み込めませんでした') + '</div>'; return; }
      C.list = res.contracts || []; C.ready = res.ready; C.message = res.message;
      render();
    } catch (e) { $('actr-body').innerHTML = '<div style="color:#dc2626">通信に失敗しました。<a href="#" onclick="actrReload();return false">もう一度読み込む</a></div>'; }
  }
  window.actrReload = load;

  function badge(st) { var s = STATUS[st] || STATUS.creating; return '<span style="background:' + s.bg + ';color:' + s.fg + ';border-radius:10px;padding:2px 9px;font-size:12px;font-weight:700;white-space:nowrap">' + s.label + '</span>'; }

  function render() {
    var storeOpts = '<option value="">（店を選ばない）</option>' + (typeof STORES !== 'undefined' ? Object.keys(STORES).map(function (id) { return '<option value="' + esc(id) + '">' + esc(STORES[id]) + '</option>'; }).join('') : '');
    var html = '';
    if (!C.ready) html += '<div style="background:#fee2e2;border-radius:8px;padding:10px;font-size:13px;margin-bottom:12px">保存先がまだ設定されていません（' + esc(C.message || '') + '）。</div>';
    html += '<div style="background:white;border-radius:10px;padding:14px;margin-bottom:14px">'
      + '<div style="font-weight:700;margin-bottom:4px">新しい契約書を登録する</div>'
      + '<div style="font-size:12px;color:#666;line-height:1.6;margin-bottom:8px">相手の名前・報酬などを書き込んだ契約書（Google ドキュメントか、Drive に置いた Word）の URL を入れます。登録すると、その時点の内容が写しとして固定されます（あとで元の文書を直しても変わりません）。</div>'
      + '<div style="display:grid;grid-template-columns:130px 1fr;gap:8px;align-items:center;font-size:13px">'
      + '<span>契約書の URL</span><input id="actr-doc" placeholder="https://docs.google.com/document/d/… または Drive の Word の URL" style="' + INPUT + '">'
      + '<span>契約書の名前</span><input id="actr-title" value="業務委託契約書" style="' + INPUT + '">'
      + '<span>相手の氏名（社名）</span><input id="actr-name" placeholder="契約書に書いた名前と同じに" style="' + INPUT + '">'
      + '<span>相手のメール</span><input id="actr-email" type="email" placeholder="確認コードと控えの送り先" style="' + INPUT + '">'
      + '<span>店</span><select id="actr-store" style="' + INPUT + '">' + storeOpts + '</select>'
      + '<span>メモ（社内用）</span><input id="actr-note" style="' + INPUT + '">'
      + '<span>作成する人</span><input id="actr-by" value="' + esc(who()) + '" placeholder="あなたの名前（記録に残ります）" style="' + INPUT + '">'
      + '</div><div id="actr-new-msg" style="font-size:13px;min-height:18px;margin:8px 0"></div>'
      + '<button id="actr-new-btn" onclick="actrCreate()" style="' + BTN + 'background:#22703d;color:white;padding:9px 16px;font-size:14px">登録して、相手用のリンクを作る</button></div>';
    if (!C.list.length) html += '<div style="background:white;border-radius:10px;padding:14px;font-size:13px;color:#666">契約書はまだありません。</div>';
    C.list.forEach(function (c) {
      if (c.status === 'creating') return;
      html += '<div style="background:white;border-radius:10px;padding:12px 14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);font-size:13px">'
        + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + badge(c.status)
        + '<b style="font-size:14px">' + esc(c.partner_name) + '</b><span style="color:#666">' + esc(c.title) + (c.store_id ? '・' + esc(storeName(c.store_id)) : '') + '</span>'
        + '<span style="flex:1"></span><span style="color:#888;font-size:12px">' + esc(c.id) + '</span></div>'
        + '<div style="color:#666;font-size:12px;margin-top:6px;line-height:1.7">登録 ' + esc(c.created_at) + '（' + esc(c.created_by) + '）'
        + (c.sent_at ? '　／　メール送付 ' + esc(c.sent_at) : '') + (c.opened_at ? '　／　相手が開いた ' + esc(c.opened_at) : '')
        + (c.agreed_at ? '<br>相手の同意 ' + esc(c.agreed_at) + '（入力した氏名: ' + esc(c.agreed_name) + '）' : '')
        + (c.approved_at ? '　／　承認 ' + esc(c.approved_at) + '（' + esc(c.approved_by) + '）' : '')
        + (c.note ? '<br>メモ: ' + esc(c.note) : '') + '</div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
      if (c.pdf_url) html += '<a href="' + esc(c.pdf_url) + '" target="_blank" rel="noopener" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px;text-decoration:none">送付版 PDF</a>';
      if (c.signed_pdf_url) html += '<a href="' + esc(c.signed_pdf_url) + '" target="_blank" rel="noopener" style="' + BTN + 'background:#dcfce7;color:#166534;padding:6px 10px;font-size:12px;text-decoration:none">締結済み PDF</a>';
      if (c.status === 'sent') {
        html += '<button onclick="actrCopy(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#22703d;color:white;padding:6px 10px;font-size:12px">相手用のリンクをコピー</button>'
          + '<button onclick="actrSend(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px">リンクをメールで送る</button>';
      }
      if (c.status === 'agreed') html += '<button onclick="actrApprove(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#22703d;color:white;padding:6px 12px;font-size:13px">承認して締結する</button>';
      if (c.status === 'sent' || c.status === 'agreed') html += '<button onclick="actrCancel(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#fee2e2;color:#991b1b;padding:6px 10px;font-size:12px">取り消す</button>';
      html += '</div><div id="actr-msg-' + esc(c.id) + '" style="font-size:12px;min-height:16px;margin-top:4px"></div></div>';
    });
    html += '<button onclick="actrReload()" style="' + BTN + 'background:#e5e7eb;color:#333;padding:8px 12px;font-size:13px;margin-top:6px">読み込み直す</button>';
    $('actr-body').innerHTML = html;
  }

  function find(id) { return C.list.find(function (x) { return x.id === id; }); }
  function needWho() {
    var w = who();
    if (!w) { w = (prompt('あなたの名前を入れてください（記録に残ります）') || '').trim(); if (w) setWho(w); }
    return w;
  }

  window.actrCreate = async function () {
    var by = $('actr-by').value.trim();
    if (by) setWho(by);
    var p = { docUrl: $('actr-doc').value.trim(), title: $('actr-title').value.trim(), partnerName: $('actr-name').value.trim(), email: $('actr-email').value.trim(), storeId: $('actr-store').value, note: $('actr-note').value.trim(), by: by };
    $('actr-new-btn').disabled = true; note('actr-new-msg', '登録しています（PDF を作るので20秒ほどかかります）…', true);
    try {
      var res = await gasPost('contractCreate', p);
      if (res && res.errors) { note('actr-new-msg', res.errors.map(esc).join('<br>')); $('actr-new-btn').disabled = false; return; }
      if (!res || !res.ok) { note('actr-new-msg', esc((res && res.error) || '登録できませんでした')); $('actr-new-btn').disabled = false; return; }
      await load();
      note('actr-msg-' + res.contract.id, '登録しました。「相手用のリンクをコピー」で LINE などに貼るか、「リンクをメールで送る」を押してください。', true);
    } catch (e) { note('actr-new-msg', '通信に失敗しました。「読み込み直す」で登録できたか確かめてください'); $('actr-new-btn').disabled = false; }
  };
  window.actrCopy = async function (id) {
    var c = find(id);
    try { await navigator.clipboard.writeText(c.link); note('actr-msg-' + id, 'リンクをコピーしました。相手ご本人にだけ渡してください。', true); }
    catch (e) { prompt('このリンクをコピーして、相手ご本人にだけ渡してください', c.link); }
  };
  window.actrSend = async function (id) {
    var c = find(id), by = needWho();
    if (!by || !confirm(c.partner_name + ' さん（' + c.email + '）に、契約書のリンクをメールで送ります。よろしいですか？')) return;
    note('actr-msg-' + id, '送っています…', true);
    try {
      var res = await gasPost('contractSendLink', { id: id, by: by });
      if (!res || !res.ok) { note('actr-msg-' + id, esc((res && res.error) || '送れませんでした')); return; }
      await load(); note('actr-msg-' + id, 'メールで送りました。', true);
    } catch (e) { note('actr-msg-' + id, '通信に失敗しました'); }
  };
  window.actrApprove = async function (id) {
    var c = find(id), by = needWho();
    if (!by || !confirm(c.partner_name + ' さんとの「' + c.title + '」を、' + by + ' さんの承認で締結します。締結済みの PDF を作り、相手にメールで控えを送ります。取り消せません。よろしいですか？')) return;
    note('actr-msg-' + id, '締結しています（30秒ほどかかります）…', true);
    try {
      var res = await gasPost('contractApprove', { id: id, by: by });
      if (!res || !res.ok) { note('actr-msg-' + id, esc((res && res.error) || '締結できませんでした')); return; }
      await load();
      note('actr-msg-' + id, res.mailed ? '締結しました。相手に控えをメールで送りました。' : '締結しましたが、控えのメールを送れませんでした。締結済み PDF を相手に渡してください。', res.mailed);
    } catch (e) { note('actr-msg-' + id, '通信に失敗しました。「読み込み直す」で締結できたか確かめてください'); }
  };
  window.actrCancel = async function (id) {
    var c = find(id), by = needWho();
    if (!by) return;
    var reason = prompt(c.partner_name + ' さんの契約書を取り消します（相手のリンクは使えなくなります）。理由を書いてください');
    if (reason == null) return;
    try {
      var res = await gasPost('contractCancel', { id: id, by: by, reason: reason });
      if (!res || !res.ok) { note('actr-msg-' + id, esc((res && res.error) || '取り消せませんでした')); return; }
      load();
    } catch (e) { note('actr-msg-' + id, '通信に失敗しました'); }
  };

  window.openAdminContract = function () { overlay().style.display = 'block'; load(); };
  window.closeAdminContract = function () { var o = $('actr-overlay'); if (o) o.style.display = 'none'; };
})();
