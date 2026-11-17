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
  var C = { list: [], filter: 'all', q: '', showNew: false };

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
      C.stores = res.stores || {}; C.staff = res.staff || []; C.hasTemplate = !!res.hasTemplate;
      render();
    } catch (e) { $('actr-body').innerHTML = '<div style="color:#dc2626">通信に失敗しました。<a href="#" onclick="actrReload();return false">もう一度読み込む</a></div>'; }
  }
  window.actrReload = load;

  function badge(st) { var s = STATUS[st] || STATUS.creating; return '<span style="background:' + s.bg + ';color:' + s.fg + ';border-radius:10px;padding:2px 9px;font-size:12px;font-weight:700;white-space:nowrap">' + s.label + '</span>'; }

  function render() {
    var storeOpts = '<option value="">店名を選ぶ</option>' + (typeof STORES !== 'undefined' ? Object.keys(STORES).map(function (id) { return '<option value="' + esc(id) + '">' + esc(STORES[id]) + '</option>'; }).join('') : '');
    var html = '';
    if (!C.ready) html += '<div style="background:#fee2e2;border-radius:8px;padding:10px;font-size:13px;margin-bottom:12px">保存先がまだ設定されていません（' + esc(C.message || '') + '）。</div>';
    // 上の帯：状態ごとの件数で絞り込み・名前で検索・新しく登録
    var counts = { all: 0 };
    C.list.forEach(function (c) { if (c.status !== 'creating') { counts.all++; counts[c.status] = (counts[c.status] || 0) + 1; } });
    var tabs = [['all', 'すべて'], ['sent', '相手の同意待ち'], ['agreed', '承認待ち'], ['signed', '締結済み'], ['canceled', '取り消し']];
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">'
      + tabs.map(function (t) { var on = C.filter === t[0]; return '<button onclick="actrFilter(\'' + t[0] + '\')" style="' + BTN + 'padding:6px 10px;font-size:12px;background:' + (on ? '#22703d' : 'white') + ';color:' + (on ? 'white' : '#333') + ';border:1px solid ' + (on ? '#22703d' : '#ddd') + '">' + t[1] + ' ' + (counts[t[0]] || 0) + '</button>'; }).join('')
      + '<input value="' + esc(C.q) + '" oninput="actrSearch(this.value)" placeholder="名前・店・契約番号で探す" style="' + INPUT + 'width:200px;padding:6px 10px;font-size:13px">'
      + '<span style="flex:1"></span>'
      + '<span style="font-size:12px;color:#666">操作する人</span><select id="actr-who" onchange="actrSetWho(this.value)" style="' + INPUT + 'width:140px;padding:6px 8px;font-size:13px">' + staffOpts() + '</select>'
      + (C.showNew ? '' : '<button onclick="actrToggleNew()" style="' + BTN + 'background:#22703d;color:white;padding:8px 12px;font-size:13px">＋ 新しい契約書を登録</button>') + '</div>';
    // 登録の欄。ふつうは「ひな形から作る」（店を選ぶと店名・住所が契約書に入る）。.actr-tpl はひな形のときだけ、.actr-url は文書の URL で登録するときだけ出す
    var today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    var hint = function (t) { return '<div style="font-size:11px;color:#888;margin-top:2px">' + t + '</div>'; };
    if (C.showNew) html += '<div style="background:white;border:2px solid #22703d;border-radius:10px;padding:14px;margin-bottom:14px">'
      + '<div style="font-weight:700;margin-bottom:4px">新しい契約書を登録する</div>'
      + '<div class="actr-tpl" style="font-size:12px;color:#666;line-height:1.6;margin-bottom:8px">店と相手を入れると、ひな形（業務委託契約書）から契約書を自動で作ります。登録した時点の内容で固定されます。</div>'
      + '<div class="actr-url" style="font-size:12px;color:#666;line-height:1.6;margin-bottom:8px">相手の名前・報酬などを書き込んだ契約書（Google ドキュメントか、Drive に置いた Word）の URL で登録します。</div>'
      + '<div style="display:grid;grid-template-columns:150px 1fr;gap:8px 10px;align-items:start;font-size:13px">'
      + '<span style="padding-top:8px">店名を選ぶ</span><div><select id="actr-store" onchange="actrStoreChange()" style="' + INPUT + '">' + storeOpts + '</select></div>'
      + '<span class="actr-tpl" style="padding-top:8px">店の住所</span><div class="actr-tpl"><input id="actr-store-addr" placeholder="〒000-0000 …（店を選ぶと自動で入ります）" style="' + INPUT + '">' + hint('契約書の「業務場所」に入ります。違っていたら直してください。') + '</div>'
      + '<span style="padding-top:8px">相手の氏名（姓名）</span><div><input id="actr-name" placeholder="例：山田太郎" style="' + INPUT + '">' + hint('姓と名の間にスペースを空けずに入れてください。会社の場合は社名。') + '</div>'
      + '<span class="actr-tpl" style="padding-top:8px">相手の住所</span><div class="actr-tpl"><input id="actr-addr" placeholder="都道府県から。マンション名・部屋番号まで" style="' + INPUT + '"></div>'
      + '<span style="padding-top:8px">相手のメールアドレス</span><div><input id="actr-email" type="email" placeholder="例：yamada@example.com" style="' + INPUT + '">' + hint('確認コードと、締結済みの契約書（控え）の送り先です。') + '</div>'
      + '<span class="actr-tpl" style="padding-top:8px">報酬（月額・税込）</span><div class="actr-tpl" style="display:flex;align-items:center;gap:6px"><input id="actr-fee" type="number" min="1" step="1000" placeholder="30000" style="' + INPUT + 'width:160px">円</div>'
      + '<span class="actr-tpl" style="padding-top:8px">業務の頻度</span><div class="actr-tpl"><input id="actr-freq" list="actr-freq-list" value="週7回" style="' + INPUT + 'width:160px"><datalist id="actr-freq-list">'
      + ['週7回', '週6回', '週5回', '週4回', '週3回', '2日に1回'].map(function (f) { return '<option value="' + f + '">'; }).join('') + '</datalist></div>'
      + '<span class="actr-tpl" style="padding-top:8px">契約日</span><div class="actr-tpl"><input id="actr-date" type="date" value="' + today + '" style="' + INPUT + 'width:180px">' + hint('契約書の日付に入ります。') + '</div>'
      + '<span class="actr-url" style="padding-top:8px">契約書の URL</span><div class="actr-url"><input id="actr-doc" placeholder="https://docs.google.com/document/d/… または Drive の Word の URL" style="' + INPUT + '"></div>'
      + '<span class="actr-url" style="padding-top:8px">契約書の名前</span><div class="actr-url"><input id="actr-title" value="業務委託契約書" style="' + INPUT + '"></div>'
      + '<span style="padding-top:8px">メモ（社内用）</span><div><input id="actr-note" style="' + INPUT + '"></div>'
      + '<span style="padding-top:8px">作成する人</span><div style="display:flex;gap:6px;align-items:center"><select id="actr-by" onchange="actrSetWho(this.value)" style="' + INPUT + 'width:200px">' + staffOpts() + '</select>'
      + '<button onclick="actrAddStaff()" style="' + BTN + 'background:#f3f4f6;color:#111;padding:7px 10px;font-size:12px">＋ 社員を追加</button></div>'
      + '</div>'
      + '<div style="font-size:12px;margin-top:10px"><a href="#" onclick="actrMode();return false" id="actr-mode-link" style="color:#22703d"></a></div>'
      + '<div id="actr-new-msg" style="font-size:13px;min-height:18px;margin:8px 0"></div>'
      + '<button id="actr-new-btn" onclick="actrCreate()" style="' + BTN + 'background:#22703d;color:white;padding:9px 16px;font-size:14px">登録して、相手用のリンクを作る</button> '
      + '<button onclick="actrToggleNew()" style="' + BTN + 'background:#e5e7eb;color:#333;padding:9px 16px;font-size:14px">やめる</button></div>';
    html += '<div id="actr-list">' + listHtml() + '</div>'
      + '<button onclick="actrReload()" style="' + BTN + 'background:#e5e7eb;color:#333;padding:8px 12px;font-size:13px;margin-top:6px">読み込み直す</button>';
    $('actr-body').innerHTML = html;
    if (C.showNew) applyMode();
  }

  function staffOpts() {
    var w = who(), list = (C.staff || []).slice();
    if (w && list.indexOf(w) < 0) list.push(w);
    return '<option value="">選んでください</option>' + list.map(function (n) { return '<option value="' + esc(n) + '"' + (n === w ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
  }
  // ひな形から作る／文書の URL で登録する の切り替え（入力した内容は残す）
  function applyMode() {
    var tpl = C.hasTemplate && !C.urlMode;
    document.querySelectorAll('#actr-body .actr-tpl').forEach(function (el) { el.style.display = tpl ? '' : 'none'; });
    document.querySelectorAll('#actr-body .actr-url').forEach(function (el) { el.style.display = tpl ? 'none' : ''; });
    var link = $('actr-mode-link');
    if (link) link.textContent = !C.hasTemplate ? '' : tpl ? 'ひな形を使わず、自分で作った文書の URL で登録する' : 'ひな形から作る（店を選ぶだけ）に戻す';
  }
  window.actrMode = function () { C.urlMode = !C.urlMode; applyMode(); };
  window.actrStoreChange = function () { var s = (C.stores || {})[$('actr-store').value]; $('actr-store-addr').value = s ? s.address : ''; };
  window.actrSetWho = function (v) { if (v) setWho(v); };
  window.actrAddStaff = async function () {
    var name = (prompt('足す社員の名前（姓名）') || '').trim();
    if (!name) return;
    try {
      var res = await gasPost('contractAddStaff', { name: name });
      if (!res || !res.ok) { alert((res && res.error) || '足せませんでした'); return; }
      C.staff = res.staff; setWho(name);
      document.querySelectorAll('#actr-by, #actr-who').forEach(function (el) { el.innerHTML = staffOpts(); });
    } catch (e) { alert('通信に失敗しました'); }
  };

  // 一覧（絞り込み・検索を反映）。締結済みの契約書は、ここからいつでも開ける
  function listHtml() {
    var html = '', q = C.q.replace(/\s/g, '');
    var rows = C.list.filter(function (c) {
      if (c.status === 'creating') return false;
      if (C.filter !== 'all' && c.status !== C.filter) return false;
      return !q || (c.partner_name + storeName(c.store_id) + c.id + c.title).replace(/\s/g, '').indexOf(q) >= 0;
    });
    if (!rows.length) return '<div style="background:white;border-radius:10px;padding:14px;font-size:13px;color:#666">' + (C.list.length ? '当てはまる契約書はありません。' : '契約書はまだありません。「＋ 新しい契約書を登録」から始めてください。') + '</div>';
    rows.forEach(function (c) {
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
      if (c.signed_pdf_url) html += '<a href="' + esc(c.signed_pdf_url) + '" target="_blank" rel="noopener" style="' + BTN + 'background:#22703d;color:white;padding:6px 12px;font-size:13px;text-decoration:none">締結済みの契約書を開く</a>';
      if (c.status === 'sent') {
        html += '<button onclick="actrCopy(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#22703d;color:white;padding:6px 10px;font-size:12px">相手用のリンクをコピー</button>'
          + '<button onclick="actrSend(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px">リンクをメールで送る</button>';
      }
      if (c.status === 'agreed') html += '<button onclick="actrApprove(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#22703d;color:white;padding:6px 12px;font-size:13px">承認して締結する</button>';
      if (c.status === 'sent' || c.status === 'agreed') html += '<button onclick="actrCancel(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#fee2e2;color:#991b1b;padding:6px 10px;font-size:12px">取り消す</button>';
      html += '<button onclick="actrEvents(\'' + esc(c.id) + '\')" style="' + BTN + 'background:#f3f4f6;color:#111;padding:6px 10px;font-size:12px">記録を見る</button>';
      html += '</div><div id="actr-msg-' + esc(c.id) + '" style="font-size:12px;min-height:16px;margin-top:4px"></div><div id="actr-ev-' + esc(c.id) + '"></div></div>';
    });
    return html;
  }

  window.actrFilter = function (f) { C.filter = f; render(); };
  window.actrSearch = function (v) { C.q = v; var l = $('actr-list'); if (l) l.innerHTML = listHtml(); };
  window.actrToggleNew = function () { C.showNew = !C.showNew; render(); };
  // 記録（いつ・だれが・何をしたか）を開く・閉じる
  window.actrEvents = async function (id) {
    var box = $('actr-ev-' + id);
    if (box.innerHTML) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="font-size:12px;color:#888;margin-top:6px">読み込んでいます…</div>';
    try {
      var res = await gasPost('contractEvents', { id: id }), c = find(id);
      if (!res || !res.ok) { box.innerHTML = '<div style="font-size:12px;color:#dc2626">' + esc((res && res.error) || '読み込めませんでした') + '</div>'; return; }
      box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><tr style="background:#f3f4f6"><th style="text-align:left;padding:4px">日時</th><th style="text-align:left;padding:4px">できごと</th><th style="text-align:left;padding:4px">した人</th><th style="text-align:left;padding:4px">内容</th></tr>'
        + res.events.map(function (e) { return '<tr style="border-top:1px solid #eee"><td style="padding:4px;white-space:nowrap">' + esc(e.at) + '</td><td style="padding:4px">' + esc(e.event) + '</td><td style="padding:4px">' + esc(e.actor) + '</td><td style="padding:4px;word-break:break-all;color:#666">' + esc(e.detail) + '</td></tr>'; }).join('') + '</table>'
        + (c && c.signed_sha256 ? '<div style="font-size:11px;color:#666;margin-top:6px;word-break:break-all">締結済み PDF の指紋（SHA-256）: ' + esc(c.signed_sha256) + '</div>' : '');
    } catch (e) { box.innerHTML = '<div style="font-size:12px;color:#dc2626">通信に失敗しました</div>'; }
  };

  function find(id) { return C.list.find(function (x) { return x.id === id; }); }
  function needWho() {
    // 承認・送付・取り消しをする人。上の「操作する人」で選ぶ（記録に残る）
    var w = ($('actr-who') && $('actr-who').value) || '';
    if (!w) alert('上の「操作する人」を選んでください（記録に残ります）');
    return w;
  }

  window.actrCreate = async function () {
    var by = $('actr-by').value.trim();
    if (by) setWho(by);
    var v = function (id) { return $(id).value.trim(); };
    var tpl = C.hasTemplate && !C.urlMode;
    var p = { partnerName: v('actr-name'), email: v('actr-email'), storeId: $('actr-store').value, note: v('actr-note'), by: by };
    if (tpl) Object.assign(p, { useTemplate: true, storeAddress: v('actr-store-addr'), partnerAddress: v('actr-addr'), fee: Number(v('actr-fee')), frequency: v('actr-freq'), contractDate: v('actr-date') });
    else Object.assign(p, { docUrl: v('actr-doc'), title: v('actr-title') });
    $('actr-new-btn').disabled = true; note('actr-new-msg', '登録しています（PDF を作るので20秒ほどかかります）…', true);
    try {
      var res = await gasPost('contractCreate', p);
      if (res && res.errors) { note('actr-new-msg', res.errors.map(esc).join('<br>')); $('actr-new-btn').disabled = false; return; }
      if (!res || !res.ok) { note('actr-new-msg', esc((res && res.error) || '登録できませんでした')); $('actr-new-btn').disabled = false; return; }
      C.showNew = false; C.filter = 'all'; C.q = '';
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
