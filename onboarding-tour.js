/* 初めての人向けガイダンス(2026-10-16)
 *  - 通常モード: 練習用パスワードの判定と、名前・配属店を選ぶ開始画面だけ(onbIsTrainingPassword / onbShowStartScreen)
 *  - 練習モード(window.__ONB、onboarding-sandbox.js 参照): 目次・章・「ここを押して」の案内を動かす
 * 案内は「押す場所だけ明るく＋吹き出し」。明るい所以外は押せない(迷子にしない)。各手順は本人が実際に
 * 操作したら次へ進む(説明だけの手順は「次へ」)。うまくいかない時のために「この手順を飛ばす」を小さく置く。
 */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 章の一覧(管理者画面「受講状況」の列にも使う。練習モードのCHAPTERSとキー・順番をそろえる)
  window.ONB_CHAPTER_LIST = [
    { key: 'basics', title: '画面の見方' },
    { key: 'attendance', title: '業務開始・休み申請' },
    { key: 'order', title: '発注依頼' },
    { key: 'checksheet', title: 'チェックシート' },
    { key: 'machinephoto', title: 'マシン撮影' },
    { key: 'lost', title: '忘れ物' },
    { key: 'inventory', title: '棚卸' },
    { key: 'bugreport', title: 'バグ報告' },
    { key: 'finish', title: '仕上げ' },
  ];

  // ================= 通常モード: ログイン画面から練習を始める =================
  // 練習用パスワードは管理画面「設定 › ガイダンス」で決める(settings: onboarding_password、全店共通で1つ)
  window.onbIsTrainingPassword = function (val) {
    try {
      let pw = localStorage.getItem('onboarding_password') || '';
      try { pw = JSON.parse(pw); } catch (_) {}
      pw = String(pw || '').trim();
      return !!pw && String(val || '').trim() === pw;
    } catch (_) { return false; }
  };

  window.onbShowStartScreen = function () {
    const box = document.querySelector('#site-lock .site-lock-box');
    if (!box) return;
    if (!box.dataset.onbOrig) box.dataset.onbOrig = box.innerHTML;
    const groups = Object.values(REGIONS).map(r => `<optgroup label="${esc(r.label)}">${
      r.stores.filter(sid => STORES[sid]).map(sid => `<option value="${esc(sid)}">${esc(STORES[sid])}</option>`).join('')}</optgroup>`).join('');
    let lastName = '';
    try { lastName = localStorage.getItem('onb_last_name') || ''; } catch (_) {}
    box.innerHTML = `
      <img src="logo-round.png" class="site-lock-logo" alt="セルフカフェ">
      <h2>はじめてのガイダンス</h2>
      <div class="site-lock-rule"></div>
      <p style="line-height:1.7;text-align:left;font-size:13.5px">ポータルの使い方を、実際の画面で順番に練習します。<br>
        <b>練習で操作した内容は本番には送られません。</b>安心して押してみてください。</p>
      <label class="site-lock-field-label" for="onb-name">お名前</label>
      <input class="pin-input" id="onb-name" type="text" placeholder="例：山田 花子" value="${esc(lastName)}" autocomplete="off">
      <label class="site-lock-field-label" for="onb-store" style="margin-top:10px">配属される店舗</label>
      <select class="pin-input" id="onb-store" style="text-align:left"><option value="">選んでください</option>${groups}</select>
      <div class="pin-error" id="onb-start-error"></div>
      <button type="button" class="btn-pin-submit" onclick="onbStart()">ガイダンスをはじめる</button>
      <button type="button" onclick="onbBackToLogin()" style="margin-top:10px;background:none;border:none;color:#6b7280;font-size:13px;cursor:pointer;font-family:inherit">ログイン画面に戻る</button>`;
  };
  window.onbBackToLogin = function () {
    const box = document.querySelector('#site-lock .site-lock-box');
    if (box && box.dataset.onbOrig) { box.innerHTML = box.dataset.onbOrig; delete box.dataset.onbOrig; }
    const inp = document.getElementById('site-pw-input'); if (inp) inp.value = '';
  };
  window.onbStart = function () {
    const name = (document.getElementById('onb-name')?.value || '').trim();
    const sid = document.getElementById('onb-store')?.value || '';
    const err = document.getElementById('onb-start-error');
    if (!name || !sid) { if (err) err.textContent = !name ? 'お名前を入れてください' : '配属される店舗を選んでください'; return; }
    try { localStorage.setItem('onb_last_name', name); } catch (_) {}
    sessionStorage.setItem('onboarding', '1');
    sessionStorage.setItem('onb_name', name);
    sessionStorage.setItem('site_authed', '1');
    sessionStorage.setItem('site_authed_store', sid);
    sessionStorage.setItem('last_active', String(Date.now()));
    // 練習モードはページの読み込み最初から(onboarding-sandbox.js)差し替える必要があるので開き直す
    location.reload();
  };
  // 練習を終える(ログアウト)。練習モードを外して開き直すと、いつものログイン画面に戻る
  window.onbExit = function () {
    ['onboarding', 'onb_name', 'site_authed', 'site_authed_store', 'last_active'].forEach(k => sessionStorage.removeItem(k));
    location.reload();
  };

  if (!window.__ONB) return;

  // ================= 練習モード =================
  const NAME = sessionStorage.getItem('onb_name') || '練習';
  const STORE = sessionStorage.getItem('site_authed_store') || '';
  const PROGRESS_KEY = 'onb_progress_v1';
  let deviceId = '';
  try { deviceId = localStorage.getItem('onb_device_id') || ''; if (!deviceId) { deviceId = 'd' + Date.now().toString(36); localStorage.setItem('onb_device_id', deviceId); } } catch (_) {}

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch (_) { return {}; }
  }
  function myProgress() {
    const all = loadProgress();
    return (all[NAME] = all[NAME] || { done: {} });
  }
  function saveDone(key) {
    const all = loadProgress();
    const me = all[NAME] = all[NAME] || { done: {} };
    if (!me.done[key]) me.done[key] = new Date().toISOString();
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (_) {}
  }
  // 別の端末で終えた章も引き継ぐ(修了記録は本番に残している)
  async function mergeServerProgress() {
    try {
      const rows = await gasGet('getOnboardingProgress', { name: NAME });
      if (!Array.isArray(rows)) return;
      const all = loadProgress();
      const me = all[NAME] = all[NAME] || { done: {} };
      rows.forEach(r => { if (r.chapter && !me.done[r.chapter]) me.done[r.chapter] = r.completed_at || true; });
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  // ---------- 小さな道具 ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isVisible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const all = sel => [...document.querySelectorAll(sel)].filter(isVisible);
  const one = sel => all(sel)[0] || null;
  async function waitUntil(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (fn()) return true; } catch (_) {} await sleep(150); }
    try { return !!fn(); } catch (_) { return false; }
  }
  const isMobile = () => window.innerWidth < 640;

  // ---------- 画面部品 ----------
  const css = document.createElement('style');
  css.textContent = `
    .onb-ribbon{position:fixed;top:0;left:0;right:0;z-index:99994;background:#b45309;color:#fff;font-size:12px;font-weight:700;
      display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 10px;box-shadow:0 1px 4px rgba(0,0,0,.2)}
    .onb-ribbon button{background:#fff;color:#b45309;border:none;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
    body.onb-on{padding-top:30px}
    .onb-block{position:fixed;z-index:99991;background:rgba(15,23,42,.55)}
    .onb-ring{position:fixed;z-index:99992;pointer-events:none;border-radius:10px;box-shadow:0 0 0 3px #fbbf24,0 0 18px 4px rgba(251,191,36,.9);transition:all .15s}
    .onb-bubble{position:fixed;z-index:99993;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:14px 16px 12px;
      font-size:15px;line-height:1.65;color:#1f2937;box-sizing:border-box}
    .onb-bubble .onb-ch{font-size:11.5px;color:#b45309;font-weight:700;margin-bottom:4px}
    .onb-bubble .onb-text b{color:#b45309}
    .onb-bubble .onb-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
    .onb-bubble .onb-links{display:flex;gap:12px;font-size:12px}
    .onb-bubble .onb-links a{color:#6b7280;text-decoration:underline;cursor:pointer}
    .onb-bubble .onb-count{font-size:12px;color:#9ca3af}
    .onb-btn{background:#22703d;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
    .onb-btn.sub{background:#f3f4f6;color:#374151}
    .onb-modal-bg{position:fixed;inset:0;z-index:99995;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;padding:16px}
    .onb-modal{background:#fff;border-radius:16px;max-width:480px;width:100%;max-height:90vh;overflow:auto;padding:18px 18px 14px;box-sizing:border-box}
    .onb-modal h3{margin:0 0 4px;font-size:18px;color:#22703d}
    .onb-chap{display:flex;align-items:center;gap:10px;padding:11px 4px;border-bottom:1px solid #f1f1f1}
    .onb-chap .t{flex:1;font-size:14.5px;font-weight:700;color:#1f2937}
    .onb-chap .s{font-size:11.5px;color:#6b7280;font-weight:400;margin-top:2px}
    .onb-chap .ok{color:#16a34a;font-weight:700;font-size:13px;white-space:nowrap}
    .onb-chap .na{color:#9ca3af;font-size:12px;white-space:nowrap}
  `;
  document.head.appendChild(css);

  const blocks = [0, 1, 2, 3].map(() => {
    const d = document.createElement('div');
    d.className = 'onb-block';
    // 暗い部分を押しても下の画面は反応させない(メニューが閉じる等の副作用も起こさない)。スクロールはできる
    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach(t =>
      d.addEventListener(t, e => { e.stopPropagation(); if (t === 'click' || t === 'mouseup' || t === 'touchend') e.preventDefault(); }, { passive: false }));
    d.style.display = 'none';
    return d;
  });
  const ring = document.createElement('div'); ring.className = 'onb-ring'; ring.style.display = 'none';
  const bubble = document.createElement('div'); bubble.className = 'onb-bubble'; bubble.style.display = 'none';
  bubble.addEventListener('click', e => e.stopPropagation());
  bubble.addEventListener('touchstart', e => e.stopPropagation());

  function mountOnce() {
    if (document.querySelector('.onb-ribbon')) return;
    const rb = document.createElement('div');
    rb.className = 'onb-ribbon';
    rb.innerHTML = `<span>練習中（本番には送られません）</span><button type="button">ガイダンスの目次</button>`;
    rb.querySelector('button').onclick = () => { abortCurrent(); openMenu(); };
    document.body.appendChild(rb);
    document.body.classList.add('onb-on');
    blocks.forEach(b => document.body.appendChild(b));
    document.body.appendChild(ring);
    document.body.appendChild(bubble);
  }

  // ---------- 案内(1手順)の表示 ----------
  let cur = null; // {step, idx, total, chapter, finish}
  function resolveTarget(t) {
    if (!t) return [];
    let r = typeof t === 'function' ? t() : one(t);
    if (!r) return [];
    if (!Array.isArray(r)) r = [r];
    return r.filter(isVisible);
  }
  function unionRect(els) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    els.forEach(el => { const x = el.getBoundingClientRect(); l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom); });
    const P = 6;
    return { left: l - P, top: t - P, right: r + P, bottom: b + P };
  }
  function layout() {
    if (!cur) return;
    const W = window.innerWidth, H = window.innerHeight;
    const els = resolveTarget(cur.step.target);
    let rect = null;
    if (els.length) {
      rect = unionRect(els);
      const L = Math.max(0, rect.left), T = Math.max(0, rect.top), R = Math.min(W, rect.right), B = Math.min(H, rect.bottom);
      const set = (d, x, y, w, h) => Object.assign(d.style, { display: 'block', left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
      set(blocks[0], 0, 0, W, T);
      set(blocks[1], 0, B, W, H - B);
      set(blocks[2], 0, T, L, B - T);
      set(blocks[3], R, T, W - R, B - T);
      Object.assign(ring.style, { display: 'block', left: L + 'px', top: T + 'px', width: (R - L) + 'px', height: (B - T) + 'px' });
    } else {
      Object.assign(blocks[0].style, { display: 'block', left: 0, top: 0, width: W + 'px', height: H + 'px' });
      blocks.slice(1).forEach(b => { b.style.display = 'none'; });
      ring.style.display = 'none';
    }
    // 吹き出しは明るい所に重ならない側へ。どちらにも入らなければ画面の下に固定
    const bw = isMobile() ? W - 24 : Math.min(380, W - 24);
    bubble.style.width = bw + 'px';
    const bh = bubble.offsetHeight;
    let top, left;
    if (!rect) { top = (H - bh) / 2; left = (W - bw) / 2; }
    else {
      if (H - rect.bottom >= bh + 14) top = rect.bottom + 10;
      else if (rect.top >= bh + 44) top = rect.top - bh - 10;
      else top = H - bh - 12;
      left = isMobile() ? 12 : Math.min(Math.max(12, (rect.left + rect.right) / 2 - bw / 2), W - bw - 12);
    }
    bubble.style.top = Math.max(36, top) + 'px';
    bubble.style.left = left + 'px';
  }
  function loop() { if (!cur) return; layout(); requestAnimationFrame(loop); }
  function hideUI() {
    blocks.forEach(b => { b.style.display = 'none'; });
    ring.style.display = 'none';
    bubble.style.display = 'none';
  }
  function abortCurrent() { if (cur && cur.finish) cur.finish('abort'); }

  async function runStep(chapter, step, idx, total) {
    if (step.setup) { try { await step.setup(); } catch (e) { console.error('onb setup', e); } }
    if (step.when && !step.when()) return 'skipped';
    if (step.target) {
      const found = await waitUntil(() => resolveTarget(step.target).length > 0, step.optional ? 1200 : 6000);
      if (!found && step.optional) return 'skipped';
      const el = resolveTarget(step.target)[0];
      if (el && step.scroll !== false) {
        const r = el.getBoundingClientRect();
        if (r.top < 40 || r.bottom > window.innerHeight - 160) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
    return new Promise(resolve => {
      let poll = null, onClick = null, ended = false;
      const finish = res => {
        if (ended) return; ended = true;
        if (poll) clearInterval(poll);
        if (onClick) document.removeEventListener('click', onClick, true);
        cur = null; hideUI();
        resolve(res);
      };
      cur = { step, idx, total, chapter, finish };
      const isNext = !step.wait || step.wait === 'next';
      bubble.innerHTML = `
        <div class="onb-ch">${esc(chapter.title)}</div>
        <div class="onb-text">${step.text}</div>
        <div class="onb-foot">
          <div class="onb-links">
            ${isNext ? '' : '<a data-act="skip">この手順を飛ばす</a>'}
            <a data-act="menu">目次へ</a>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="onb-count">${idx + 1} / ${total}</span>
            ${isNext ? `<button class="onb-btn" data-act="next">${esc(step.nextLabel || '次へ')}</button>` : ''}
          </div>
        </div>`;
      bubble.querySelectorAll('[data-act]').forEach(a => a.addEventListener('click', e => {
        e.preventDefault();
        const act = a.dataset.act;
        if (act === 'next') finish('done');
        if (act === 'skip') finish('skipped');
        if (act === 'menu') { finish('abort'); }
      }));
      bubble.style.display = 'block';
      requestAnimationFrame(loop);
      if (step.wait === 'click') {
        onClick = e => {
          if (resolveTarget(step.target).some(el => el.contains(e.target))) setTimeout(() => finish('done'), step.delay ?? 450);
        };
        document.addEventListener('click', onClick, true);
      } else if (typeof step.wait === 'function') {
        poll = setInterval(() => { try { if (step.wait()) setTimeout(() => finish('done'), step.delay ?? 300); } catch (_) {} }, 250);
      }
    });
  }

  async function runChapter(ch) {
    closeModal();
    try { if (ch.prepare) await ch.prepare(); } catch (e) { console.error('onb prepare', e); }
    const steps = ch.steps();
    for (let i = 0; i < steps.length; i++) {
      const res = await runStep(ch, steps[i], i, steps.length);
      if (res === 'abort') { openMenu(); return; }
    }
    saveDone(ch.key);
    try { await gasPost('saveOnboardingProgress', { name: NAME, storeId: STORE, chapter: ch.key, chapterTitle: ch.title, deviceId }); } catch (_) {}
    const left = CHAPTERS.filter(c => isAvailable(c) === true && !myProgress().done[c.key]);
    showModal(`
      <h3>「${esc(ch.title)}」が終わりました</h3>
      <p style="font-size:14px;line-height:1.7;color:#374151">${left.length
        ? `おつかれさまでした。残りは <b>${left.length}章</b> です。目次から次の章を選んでください。`
        : '<b>すべての章が終わりました！</b> これでポータルの基本はばっちりです。'}</p>
      <div style="text-align:right;margin-top:12px"><button class="onb-btn" onclick="onbOpenMenu()">目次へ</button></div>`);
  }

  // ---------- 目次 ----------
  let modalBg = null;
  function showModal(html) {
    closeModal();
    modalBg = document.createElement('div');
    modalBg.className = 'onb-modal-bg';
    modalBg.innerHTML = `<div class="onb-modal">${html}</div>`;
    modalBg.addEventListener('click', e => e.stopPropagation());
    modalBg.addEventListener('touchstart', e => e.stopPropagation());
    document.body.appendChild(modalBg);
  }
  function closeModal() { if (modalBg) { modalBg.remove(); modalBg = null; } }
  function isAvailable(c) { return c.available ? c.available() : true; }

  function openMenu(first) {
    abortCurrent();
    const done = myProgress().done;
    const rows = CHAPTERS.map((c, i) => {
      const av = isAvailable(c);
      const right = av !== true ? `<span class="na">${esc(av || 'この店では使いません')}</span>`
        : !c.steps ? '<span class="na">準備中</span>'
        : `${done[c.key] ? '<span class="ok">✓ 修了</span>' : ''}<button class="onb-btn${done[c.key] ? ' sub' : ''}" onclick="onbRun('${c.key}')">${done[c.key] ? 'もう一度' : 'はじめる'}</button>`;
      return `<div class="onb-chap"><div class="t">${i + 1}. ${esc(c.title)}<div class="s">${esc(c.desc)}（約${c.minutes}分）</div></div>${right}</div>`;
    }).join('');
    const total = CHAPTERS.filter(c => isAvailable(c) === true && c.steps).length;
    const doneCnt = CHAPTERS.filter(c => isAvailable(c) === true && c.steps && done[c.key]).length;
    showModal(`
      <h3>ガイダンスの目次</h3>
      <div style="font-size:12.5px;color:#6b7280;margin-bottom:6px">${esc(NAME)}さん ／ 練習する店：${esc(STORES[STORE] || STORE)} ／ 修了 ${doneCnt} / ${total}章</div>
      ${first ? `<div style="background:#fff7ed;border-radius:10px;padding:10px 12px;font-size:13.5px;line-height:1.7;margin:8px 0">
        ようこそ！ 実際の画面を使って、ポータルの操作を練習します。<br>
        ・<b>明るく光っている所</b>を押すと次に進みます。<br>
        ・好きな章から始められます。途中でやめても、終わった章は残ります。<br>
        ・練習で操作した内容は<b>本番には送られません</b>。</div>` : ''}
      ${rows}
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="onb-btn sub" onclick="onbResetData()">練習データを最初に戻す</button>
        <button class="onb-btn sub" onclick="onbExit()">練習を終える</button>
      </div>`);
  }
  window.onbOpenMenu = () => openMenu(false);
  window.onbRun = key => { const c = CHAPTERS.find(x => x.key === key); if (c) runChapter(c); };
  window.onbResetData = () => {
    if (!confirm('練習で入力した内容（発注・チェックシートなど）を消して、最初の状態に戻しますか？\n終わった章の記録は消えません。')) return;
    const keep = localStorage.getItem(PROGRESS_KEY);
    const keepDev = localStorage.getItem('onb_device_id');
    window.__onbClearAll();
    if (keep) localStorage.setItem(PROGRESS_KEY, keep);
    if (keepDev) localStorage.setItem('onb_device_id', keepDev);
    location.reload();
  };

  // ---------- 章で使う道具 ----------
  const T = {
    homeBtn: () => isMobile() ? one('.phw-home') : one('.partner-hdr-btns button[onclick="goPartnerHome()"]'),
    manualBtn: () => isMobile() ? one('.partner-hdr-pinwheel .manual-menu-btn') : one('.partner-hdr-btns .doc-menu-wrap > button'),
    manualMenu: () => one('#manual-dd-sp.open') || one('#manual-dd-pc.open'),
    draftRows: () => all('#store-tbody tr').filter(tr => tr.querySelector('.prod-input')),
    prodInput: i => (all('#store-tbody .prod-input'))[i] || null,
    prodChosen: i => { const el = T.prodInput(i); return !!el && !el.querySelector('.prod-placeholder') && el.textContent.trim() !== ''; },
    rowOf: i => T.prodInput(i)?.closest('tr') || null,
    qtyPlus: i => [...(T.rowOf(i)?.querySelectorAll('.qty-btn') || [])].find(b => b.textContent.trim() === '＋') || null,
    qtyVal: i => Number(T.rowOf(i)?.querySelector('input[type=number]')?.value || 0),
    groupBar: () => one('#store-tbody .btn-request')?.closest('tr') || null,
  };
  let doneBtnCount = 0;
  // 管理者が発注した状態を再現する(練習データの「確認中」の依頼を発注済み・本日納品予定にする)
  async function simulateOrdered() {
    const db = window.__onbDb.get();
    const today = window.__onbDb.ymd(new Date());
    db.orders.forEach(r => { if (r.store_id === STORE && r.locked && r.is_new && !r.denied) { r.is_new = false; r.order_date = today; r.delivery_date = today; } });
    window.__onbDb.save();
    const fresh = await gasGet('getOrders');
    const byId = new Map((fresh || []).map(r => [r.id, _dbToRow(r)]));
    storeRows.forEach(r => { const f = byId.get(r.id); if (f && r.locked) { r.isNew = f.isNew; r.denied = f.denied; r.orderDate = f.orderDate; r.deliveryDate = f.deliveryDate; } });
    renderStore();
    if (typeof _historyOpen !== 'undefined' && _historyOpen) renderOrderHistory();
    updatePartnerOrderBadge();
  }

  // ---------- 章 ----------
  const CHAPTERS = [
    {
      key: 'basics', title: '画面の見方', desc: '業務連絡・マニュアル・ホームボタン', minutes: 5,
      prepare: async () => { goPartnerHome(); await sleep(300); },
      steps: () => [
        { text: `ここは <b>${esc(STORES[STORE] || '')}店</b> の練習用の画面です。<br>まずは画面の見方から始めましょう。<br>光っている所を押すと、次に進みます。` },
        { target: '#active-store-label', text: 'ここに、ログインしている<b>店の名前</b>が出ます。違う店の名前が出ていたら、ログインし直してください。' },
        { target: '#announce-widget-wrap', text: 'ここは<b>業務連絡</b>です。本部からのお知らせが届きます。毎日、出勤したら確認しましょう。' },
        { target: '#announce-widget-wrap span[onclick="showAnnounceList()"]', wait: 'click', text: '「<b>一覧を見る</b>」を押してください。' },
        { target: () => one('#announce-drill-wrap [onclick^="showAnnounceDetail"]'), wait: 'click', text: 'お知らせの一覧です。一番上のお知らせを押して、開いてみましょう。' },
        { target: '#announce-drill-wrap', text: 'お知らせの本文が読めます。' },
        { target: () => one('#announce-drill-wrap span[onclick="showAnnounceList()"]'), wait: 'click', text: '「<b>一覧に戻る</b>」を押してください。' },
        { target: () => one('#announce-drill-wrap [onclick="announceGoHome()"]'), wait: 'click', text: '左上の戻るボタンを押すと、元の画面に戻ります。' },
        { target: '.partner-tab-bar', text: 'ここで<b>発注・忘れ物・チェックシート・バグ報告・棚卸表</b>を切り替えます。それぞれの使い方は、このあとの章で練習します。' },
        { target: T.manualBtn, wait: 'click', text: '「<b>マニュアル</b>」を押してください。' },
        { target: T.manualMenu, text: 'マシンの説明書などが開けます。困ったときに見てください（今は開かなくて大丈夫です）。',
          after: true },
        { setup: () => document.querySelectorAll('.doc-menu-dd.open').forEach(d => d.classList.remove('open')),
          target: () => one('#page-store a.guide-link-btn'), text: '「<b>使い方ガイド</b>」では、操作の手順を文章と写真で確認できます（今は開かなくて大丈夫です）。' },
        { target: '#ptab-checklist', wait: 'click', text: 'ためしに「<b>チェックシート</b>」のタブを押してみてください。' },
        { target: T.homeBtn, wait: 'click', text: '迷ったときは「<b>ホーム</b>」を押すと、最初の画面に戻れます。押してみてください。' },
        { text: 'ホームに戻りました。<b>セルフカフェ</b>のロゴを押しても、同じようにホームに戻れます。<br>これで「画面の見方」はおしまいです。', nextLabel: '章を終える' },
      ],
    },
    {
      key: 'attendance', title: '業務開始・休み申請', desc: '出勤したら業務開始を押す／休みの申請', minutes: 8,
      steps: null,
    },
    {
      key: 'order', title: '発注依頼', desc: '商品を選んで依頼する／届いたら納品済み', minutes: 15,
      available: () => getStoreRegion(STORE) === 'fc' ? 'FC店は使いません' : true,
      prepare: async () => {
        goPartnerHome(); await sleep(200);
        switchPartnerTab('order'); switchOrderSubTab('request');
        ensureBlankDraftRow(STORE); renderStore(); await sleep(200);
      },
      steps: () => [
        { text: '発注依頼の練習です。<br>店で足りなくなりそうな商品を、本部に頼む方法を覚えましょう。<br><span style="font-size:13px;color:#6b7280">練習なので、本当に注文されることはありません。</span>' },
        { target: '#ptab-order', wait: 'click', text: '「<b>発注</b>」のタブを押してください。' },
        { target: () => T.prodInput(0), wait: 'click', text: '「<b>タップして選択</b>」を押すと、商品の一覧が開きます。' },
        { target: () => one('.prod-dropdown.open'), scroll: false, wait: () => T.prodChosen(0),
          text: '頼みたい商品を押して選んでください。<br>上の欄に「カップ」などと入れると、絞り込めます。' },
        { target: () => T.qtyPlus(0), wait: () => T.qtyVal(0) >= 2, text: '「<b>＋</b>」を押して、数を <b>2</b> にしてください。' },
        { optional: true, target: () => T.rowOf(0)?.querySelector('.unit-toggle-btn')?.parentElement,
          text: 'この商品は<b>バラ</b>と<b>ケース</b>を切り替えられます。ケースで頼むときはここを押します。' },
        { target: () => T.rowOf(0)?.querySelector('td.c-note textarea'), wait: () => !!T.rowOf(0)?.querySelector('td.c-note textarea')?.value.trim(),
          text: '伝えたいことがあれば<b>備考</b>に書きます。「練習」と入れてみてください。' },
        { target: () => [...(T.groupBar()?.querySelectorAll('label') || [])].find(l => l.textContent.includes('撮影')),
          wait: () => !!T.groupBar()?.querySelector('img'),
          text: '写真を付けることもできます。「<b>📷 撮影</b>」を押して、何か1枚撮ってみましょう。<br><span style="font-size:13px;color:#6b7280">撮った写真が横に出たら次に進みます。</span>' },
        { target: () => one('#store-tbody .btn-add-item'), wait: 'click', text: '「<b>＋ 商品を追加</b>」を押すと、同じ依頼にもう1品足せます。' },
        { target: () => T.prodInput(1), wait: 'click', text: '2品目の「<b>タップして選択</b>」を押してください。' },
        { target: () => one('.prod-dropdown.open'), scroll: false, wait: () => T.prodChosen(1), text: '1品目とは別の商品を選んでください。' },
        { target: () => T.qtyPlus(1), wait: () => T.qtyVal(1) >= 1, text: '「<b>＋</b>」を押して、数を入れてください。' },
        { target: () => one('#store-tbody .btn-request'), wait: () => !one('#store-tbody .btn-request'),
          text: '内容を確かめたら「<b>依頼する →</b>」を押します。' },
        { target: '#ptab-order-history', wait: 'click', text: '送った依頼は「<b>依頼済み履歴</b>」で見られます。押してください。' },
        { target: '#order-history-panel', text: '本部が確認するまでは「<b>確認中</b>」と出ます。<br>間違えて送ったときは、確認中のうちなら「<b>取り下げ</b>」で取り消せます。' },
        { setup: simulateOrdered, target: '#order-history-panel',
          text: '本部が発注すると、発注日と納品予定日が入ります。<br><span style="font-size:13px;color:#6b7280">（練習なので、いま本部が発注したことにしました）</span>' },
        { target: '#ptab-order', text: '本部から返事があると、発注タブに「<b>NEW</b>」や「<b>納品</b>」の印が付きます。' },
        { setup: () => { doneBtnCount = all('#order-history-panel .btn-done').length; },
          target: () => one('#order-history-panel .btn-done'), wait: () => all('#order-history-panel .btn-done').length < doneBtnCount,
          text: '商品が店に届いたら「<b>納品済み</b>」を押します。確認が出たら「OK」を押してください。' },
        { optional: true, when: () => all('#order-history-panel .btn-done').length > 0, target: '#order-history-panel',
          text: '納品済みは<b>商品ごと</b>に押します。届いた商品から順に押してください（残りは押さなくても大丈夫です）。' },
        { text: 'これで「発注依頼」はおしまいです。<br>・足りない物は「発注」から依頼する<br>・届いたら「納品済み」を押す<br>この2つを覚えておきましょう。', nextLabel: '章を終える' },
      ],
    },
    { key: 'checksheet', title: 'チェックシート（毎日）', desc: '補充した数・清掃のチェック・修正', minutes: 15, steps: null },
    { key: 'machinephoto', title: 'マシン撮影（5の倍数の日）', desc: '5・10・15…日に庫内の写真を送る', minutes: 10, steps: null },
    { key: 'lost', title: '忘れ物', desc: '忘れ物を見つけたら登録する', minutes: 5, steps: null },
    { key: 'inventory', title: '棚卸（月末）', desc: '月末に在庫を数えて送る', minutes: 15, steps: null },
    { key: 'bugreport', title: 'バグ報告', desc: '困ったこと・要望を送る／返信を読む', minutes: 5, steps: null },
    { key: 'finish', title: '仕上げ', desc: 'ホームとログアウト', minutes: 2, steps: null },
  ];

  // ---------- 起動 ----------
  (async () => {
    await waitUntil(() => document.getElementById('page-store')?.classList.contains('active'), 60000);
    mountOnce();
    await mergeServerProgress();
    openMenu(Object.keys(myProgress().done).length === 0);
  })();
})();
