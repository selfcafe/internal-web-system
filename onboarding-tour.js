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
      <input class="pin-input" id="onb-name" type="text" placeholder="例：山田 花子（10文字まで）" value="${esc(lastName)}" maxlength="10" autocomplete="off">
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
    // 名前は10文字まで(管理画面の受講状況の表が崩れないように)。maxlengthに加えて、貼り付け等でも超えないよう確かめる
    if ([...name].length > 10) { if (err) err.textContent = 'お名前は10文字までにしてください'; return; }
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
    ['onboarding', 'onb_name', 'site_authed', 'site_authed_store', 'last_active', 'auth_t'].forEach(k => sessionStorage.removeItem(k));
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
    .onb-block{position:absolute;z-index:99991;background:rgba(15,23,42,.55)}
    .onb-ring{position:absolute;z-index:99992;pointer-events:none;border-radius:10px;box-shadow:0 0 0 3px #fbbf24,0 0 18px 4px rgba(251,191,36,.9)}
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
    .onb-btn:disabled{background:#c7d2cb;cursor:default}
    .onb-bubble .onb-hint{font-size:12px;color:#9ca3af;text-align:right;margin-top:4px}
    /* 入力欄に文字を打っている間は、説明をたたんで1行にする(キーボードで見える範囲が狭く、入力欄にかぶるため) */
    .onb-bubble .onb-typing{display:none;font-size:13.5px;color:#374151;font-weight:700}
    .onb-bubble.onb-compact{padding:7px 10px 7px 14px;border-radius:12px}
    .onb-bubble.onb-compact .onb-ch,.onb-bubble.onb-compact .onb-text,.onb-bubble.onb-compact .onb-links,
    .onb-bubble.onb-compact .onb-count,.onb-bubble.onb-compact .onb-hint{display:none}
    .onb-bubble.onb-compact .onb-foot{margin-top:0}
    .onb-bubble.onb-compact .onb-typing{display:block}
    .onb-bubble.onb-compact .onb-btn{padding:7px 16px}
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
  // 押す所の矩形(画面上の座標)。横スクロールする表などの中にある時は、その枠からはみ出た部分を除く
  function unionRect(els) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    els.forEach(el => {
      const x = el.getBoundingClientRect();
      let rr = { left: x.left, top: x.top, right: x.right, bottom: x.bottom };
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(cs.overflowX + ' ' + cs.overflowY)) {
          const pr = p.getBoundingClientRect();
          rr = { left: Math.max(rr.left, pr.left), top: Math.max(rr.top, pr.top), right: Math.min(rr.right, pr.right), bottom: Math.min(rr.bottom, pr.bottom) };
        }
      }
      l = Math.min(l, rr.left); t = Math.min(t, rr.top); r = Math.max(r, rr.right); b = Math.max(b, rr.bottom);
    });
    const P = 6;
    return { left: l - P, top: t - P, right: r + P, bottom: b + P };
  }
  // 暗い部分と枠はページ上の位置(position:absolute)で置く。画面に固定(fixed)だとスクロール中や
  // スマホのキーボードが出た時に遅れて・ずれて動き、入力欄が暗い部分に隠れることがあったため(2026-10-16、棚卸)
  function layout() {
    if (!cur) return;
    const W = window.innerWidth, H = window.innerHeight;
    const sx = window.scrollX, sy = window.scrollY;
    const page = document.getElementById('page-store');
    const docW = document.documentElement.clientWidth + sx;
    const docH = Math.max(sy + H, (page ? page.getBoundingClientRect().bottom + sy : 0) + 40);
    const els = resolveTarget(cur.step.target);
    let rect = null;
    const set = (d, x, y, w, h) => Object.assign(d.style, { display: 'block', left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
    if (els.length) {
      rect = unionRect(els);
      const L = rect.left + sx, T = rect.top + sy, R = rect.right + sx, B = rect.bottom + sy;
      set(blocks[0], 0, 0, docW, T);
      set(blocks[1], 0, B, docW, docH - B);
      set(blocks[2], 0, T, L, B - T);
      set(blocks[3], R, T, docW - R, B - T);
      set(ring, L, T, R - L, B - T);
    } else {
      set(blocks[0], 0, 0, docW, docH);
      blocks.slice(1).forEach(b => { b.style.display = 'none'; });
      ring.style.display = 'none';
    }
    // 吹き出しは画面に固定。スマホのキーボードが出ている時は、見えている範囲(visualViewport)の中に置く。
    // 画面が拡大されている時(ピンチ等)は、吹き出しが一緒に大きくなって入力欄を覆わないよう、拡大の分だけ縮めて
    // いつもの大きさで見せる(以下の bw・bh・余白は「画面上の大きさ」を拡大率で割ったページ上の大きさ)
    const vv = window.visualViewport;
    const vTop = vv ? vv.offsetTop : 0, vH = vv ? vv.height : H, vLeft = vv ? vv.offsetLeft : 0, vW = vv ? vv.width : W;
    const zoom = vv && vv.scale > 1.01 ? vv.scale : 1;
    // 押す所の中の入力欄に文字を打っている間(=スマホならキーボードが出ている間)は説明を1行にたたむ
    const ae = document.activeElement;
    const typing = !!rect && !!ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && !/^(file|checkbox|radio|button|submit)$/.test(ae.type || '')
      && els.some(el => el.contains(ae));
    const compact = typing && (isMobile() || zoom > 1);
    bubble.classList.toggle('onb-compact', compact);
    const screenW = vW * zoom;
    const cssW = isMobile() || zoom > 1 ? screenW - 24 : Math.min(380, screenW - 24);
    bubble.style.width = cssW + 'px';
    bubble.style.transformOrigin = '0 0';
    bubble.style.transform = zoom > 1 ? `scale(${1 / zoom})` : '';
    const bw = cssW / zoom;
    const bh = bubble.offsetHeight / zoom;
    let top, left;
    const overlapsRect = y => !(y + bh <= rect.top || y >= rect.bottom);
    if (!rect) { top = vTop + (vH - bh) / 2; left = vLeft + (vW - bw) / 2; }
    else if (compact) {
      // 入力欄のすぐ上か下(広い方を先に)。どちらも無理なら見えている範囲の上か下で、かぶらない方
      const minY = vTop + 4 / zoom, maxY = vTop + vH - bh - 4 / zoom;
      const above = rect.top - bh - 6 / zoom, below = rect.bottom + 6 / zoom;
      const order = (rect.top - vTop) > (vTop + vH - rect.bottom) ? [above, below, minY, maxY] : [below, above, maxY, minY];
      top = order.find(y => y >= minY && y <= maxY && !overlapsRect(y));
      if (top === undefined) top = order.find(y => y >= minY && y <= maxY) ?? minY;
      left = vLeft + 12 / zoom;
    }
    else if (isMobile() || zoom > 1) {
      // スマホは見えている範囲の上か下に置き、スクロールしても位置を変えない(押す所に重なる時だけ反対側へ)
      const posTop = vTop + 38 / zoom, posBottom = vTop + vH - bh - 10 / zoom;
      const overlaps = y => !(y + bh <= rect.top || y >= rect.bottom);
      if (!cur.side) cur.side = (rect.top + rect.bottom) / 2 > vTop + vH * 0.55 ? 'top' : 'bottom';
      let y = cur.side === 'top' ? posTop : posBottom;
      if (overlaps(y)) {
        const other = cur.side === 'top' ? posBottom : posTop;
        if (!overlaps(other)) { cur.side = cur.side === 'top' ? 'bottom' : 'top'; y = other; }
      }
      top = y; left = vLeft + 12 / zoom;
    } else {
      if (vTop + vH - rect.bottom >= bh + 14) top = rect.bottom + 10;
      else if (rect.top - vTop >= bh + 44) top = rect.top - bh - 10;
      else top = vTop + vH - bh - 12;
      left = Math.min(Math.max(vLeft + 12, (rect.left + rect.right) / 2 - bw / 2), vLeft + vW - bw - 12);
    }
    bubble.style.top = (compact ? top : Math.max(vTop + 36 / zoom, top)) + 'px';
    bubble.style.left = left + 'px';
  }
  function loop() { if (!cur) return; layout(); requestAnimationFrame(loop); }
  function hideUI() {
    blocks.forEach(b => { b.style.display = 'none'; });
    ring.style.display = 'none';
    bubble.style.display = 'none';
  }
  // 動いている章(1つだけ)。目次を開いたり別の章を始めたりしたら aborted にして、その章の続きを止める。
  // 手順の準備中・押す場所が出るのを待っている間(吹き出しが出る前)に目次を開いた時も、前の章が裏で
  // 動き続けて次の章の案内と混ざらないようにするため(2026-10-16、マシン撮影の途中で忘れ物の章を始めると
  // マシン撮影の案内が出てくる不具合)
  let activeRun = null;
  let lastBubblePress = 0;
  function abortCurrent() {
    if (activeRun) { activeRun.aborted = true; activeRun = null; }
    if (cur && cur.finish) cur.finish('abort');
  }

  async function runStep(run, chapter, step, idx, total) {
    if (step.setup) { try { await step.setup(); } catch (e) { console.error('onb setup', e); } }
    if (run.aborted) return 'abort';
    if (step.when && !step.when()) return 'skipped';
    if (step.target) {
      const found = await waitUntil(() => run.aborted || resolveTarget(step.target).length > 0, step.optional ? 1200 : 6000);
      if (run.aborted) return 'abort';
      if (!found && step.optional) return 'skipped';
      const el = resolveTarget(step.target)[0];
      if (el && step.scroll !== false) {
        const r = el.getBoundingClientRect();
        if (r.top < 40 || r.bottom > window.innerHeight - 160 || r.left < 0 || r.right > window.innerWidth)
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
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
      // 文字・数字・日付などを入れる手順は、1文字目で勝手に進むと分かりにくいので、入力が終わったら
      // 本人が「次へ」を押して進む(入力があるまで「次へ」は押せない)(2026-10-16)
      const isConfirm = !!step.confirm && typeof step.wait === 'function';
      bubble.innerHTML = `
        <div class="onb-ch">${esc(chapter.title)}</div>
        <div class="onb-text">${typeof step.text === 'function' ? step.text() : step.text}</div>
        <div class="onb-foot">
          <span class="onb-typing">${isConfirm ? '入力中… 終わったら「次へ」' : '入力中…'}</span>
          <div class="onb-links">
            ${isNext || isConfirm ? '' : '<a data-act="skip">この手順を飛ばす</a>'}
            <a data-act="menu">目次へ</a>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="onb-count">${idx + 1} / ${total}</span>
            ${isNext ? `<button class="onb-btn" data-act="next">${esc(step.nextLabel || '次へ')}</button>` : ''}
            ${isConfirm ? '<button class="onb-btn" data-act="next" disabled>次へ</button>' : ''}
          </div>
        </div>
        ${isConfirm ? '<div class="onb-hint">入力が終わったら「次へ」を押してください</div>' : ''}`;
      // 押した瞬間(pointerdown)に反応する。clickを待つと、入力中の欄から外れた時点で吹き出しが元の大きさに
      // 戻って動き、指を離す前にボタンが指の下から逃げて押せないことがあったため(1行にたたんだ時)。
      // pointerdownで既定動作を止めると入力欄から外れないので、外す・保存するのは下で行う
      const onAct = (a, e) => {
        e.preventDefault();
        // pointerdownで進んだ直後に来るclickは、同じ場所に出た次の手順の「次へ」を押してしまうので無視する
        if (e.type === 'click' && Date.now() - lastBubblePress < 700) return;
        if (e.type === 'pointerdown') lastBubblePress = Date.now();
        const act = a.dataset.act;
        if (act === 'next') {
          if (a.disabled) return;
          // 入力欄にカーソルが残ったままだと(iPhoneのSafariはボタンを押しても入力欄から外れない)、
          // 入力した内容の保存(onchange)が起きないので、先に入力欄から外して保存させてから次へ進む
          const ae = document.activeElement;
          if (ae && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { ae.blur(); setTimeout(() => finish('done'), 120); }
          else finish('done');
        }
        if (act === 'skip') finish('skipped');
        if (act === 'menu') { finish('abort'); }
      };
      bubble.querySelectorAll('[data-act]').forEach(a => {
        a.addEventListener('pointerdown', e => onAct(a, e));
        a.addEventListener('click', e => onAct(a, e)); // キーボード操作など(二重に進まないよう finish 側で1回だけにしている)
      });
      bubble.style.display = 'block';
      requestAnimationFrame(loop);
      if (step.wait === 'click') {
        onClick = e => {
          if (resolveTarget(step.target).some(el => el.contains(e.target))) setTimeout(() => finish('done'), step.delay ?? 450);
        };
        document.addEventListener('click', onClick, true);
      } else if (isConfirm) {
        const btn = bubble.querySelector('[data-act=next]');
        poll = setInterval(() => { let ok = false; try { ok = !!step.wait(); } catch (_) {} if (btn) btn.disabled = !ok; }, 200);
      } else if (typeof step.wait === 'function') {
        poll = setInterval(() => { try { if (step.wait()) setTimeout(() => finish('done'), step.delay ?? 300); } catch (_) {} }, 250);
      }
    });
  }

  async function runChapter(ch) {
    abortCurrent();
    const run = { aborted: false };
    activeRun = run;
    closeModal();
    try { if (ch.prepare) await ch.prepare(); } catch (e) { console.error('onb prepare', e); }
    if (run.aborted) return;
    const steps = ch.steps();
    for (let i = 0; i < steps.length; i++) {
      const res = await runStep(run, ch, steps[i], i, steps.length);
      if (run.aborted) return; // 目次を開いた・別の章を始めた(目次はそちらで出ている)
      if (res === 'abort') { openMenu(); return; }
    }
    if (activeRun === run) activeRun = null;
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
  let snap = 0; // 手順の前後で数を比べるための一時置き場
  const attBtn = () => isMobile() ? one('#ptab-attendance-sp') : one('#ptab-attendance-pc');
  const csQtyRow = i => all('#checksheet-table-wrap .checksheet-today-row').filter(r => r.querySelector('input[type=number]'))[i] || null;
  const csPlus = i => [...(csQtyRow(i)?.querySelectorAll('.qty-btn') || [])].find(b => b.textContent.trim() === '＋') || null;
  const csMinus = i => [...(csQtyRow(i)?.querySelectorAll('.qty-btn') || [])].find(b => b.textContent.trim() === '－') || null;
  const csVal = i => Number(csQtyRow(i)?.querySelector('input[type=number]')?.value || 0);
  const csUnsaved = () => (typeof _checksheetUnsavedCount === 'function' ? _checksheetUnsavedCount(STORE) : 0);
  const csLoaded = () => !!one('#checksheet-table-wrap .cs-saved-note') && !all('#checksheet-table-wrap .cs-saved-note').some(n => n.textContent.includes('読み込み'));
  const mpCard = () => one('#machine-photo-machines > div');
  const mpCell = k => mpCard()?.children[1]?.children[k] || null;
  const mpFilled = k => !!mpCell(k)?.querySelector('img');
  const leaveOverlay = () => { const o = document.getElementById('leave-groupchat-overlay'); return o && getComputedStyle(o).display !== 'none' ? o : null; };
  const bugItem = () => one('#bugreport-list > div');
  // 棚卸の練習用に、先月分の棚卸(期首在庫・先月の消費量)を練習データに用意し、
  // 1品目以外の期末在庫は「先月と同じ消費量」になる数で埋めておく(全部を入れなくても練習できるように)
  async function prepareInventory() {
    const period = getInventoryPeriod();
    const prev = _prevPeriodLabel(period.label);
    const db = window.__onbDb.get();
    const products = _inventoryProductList();
    if (!db.invHistory[prev] || !db.invHistory[prev].length) {
      db.invHistory[prev] = products.map(pr => ({ period_label: prev, store_id: STORE, code: pr.code || '', product: pr.name,
        open_stock: 10, delivery: 5, end_stock: 12, consumption: 3, disposed_qty: 0, price: pr.price || '', amount: '', remarks: '', anomaly_note: '', daily_count: '', matched: '', store_type: '' }));
      window.__onbDb.save();
    }
    inventoryStep = 'input'; inventoryShowLastMonth = false;
    await loadInventoryTabData(STORE, period.label);
    const rec = getInventoryPeriodData(STORE, period.label);
    products.forEach((pr, i) => {
      if (i === 0) { delete rec.endStock[pr.name]; delete rec.anomalyNote[pr.name]; return; }
      const open = Number(getInventoryOpeningStock(STORE, period.label, pr.name) || 0);
      const deliv = Number(getInventoryDelivery(STORE, period.label, pr.name) || 0);
      rec.endStock[pr.name] = String(Math.max(0, open + deliv - 3));
    });
    rec.lastSentAt = null;
    setInventoryPeriodData(STORE, period.label, rec);
    renderInventory();
  }
  const invCell = section => invFirstRow()?.querySelector(`input[onchange^="updateInventoryPeriodField('${section}'"]`)?.closest('td') || null;
  const invFirstRow = () => all('#inventory-table-wrap tr').find(tr => tr.querySelector('input[onchange^="updateInventoryPeriodField(\'endStock\'"]')) || null;
  // 管理者(本部)からの返信を再現する
  async function simulateBugReply() {
    const db = window.__onbDb.get();
    const issue = db.bugs.filter(b => b.store_id === STORE).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!issue) return;
    const t = new Date(Date.now() + 2000);
    const at = window.__onbDb.ymdhms(t);
    db.comments.push({ report_no: issue.no, id: window.__onbDb.uid(), issue_id: issue.id, poster_type: 'admin', poster_name: '本部',
      store_id: STORE, text: '報告ありがとうございます！確認して対応します。（これは練習用の返信です）', created_at: at });
    issue.status = '対応中'; issue.updated_at = at;
    window.__onbDb.save();
    await loadBugReportsFromDb(STORE);
    renderBugReports();
  }
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
        { target: '#announce-widget-wrap span[onclick="showAnnounceList()"]', wait: 'click', text: '「<b>過去の業務連絡も見る</b>」を押してください。<br><span style="font-size:13px;color:#6b7280">まだ開いていないお知らせは太字で「未読」と付き、開くまでこの枠に出続けます。読んだものは細い字になります。前のお知らせは、ここから見られます。</span>' },
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
      prepare: async () => { goPartnerHome(); await sleep(200); },
      steps: () => [
        { text: '店に着いたら、最初に「<b>業務開始</b>」を押して出勤を記録します。<br>休みの申請も、同じ画面からできます。' },
        { target: attBtn, wait: 'click', text: '右上の「<b>業務管理</b>」を押してください。' },
        { confirm: true, target: '#attendance-name-sel', wait: () => document.getElementById('attendance-name-sel')?.value === NAME,
          text: `ここで自分の名前を選びます。「<b>${esc(NAME)}</b>」を選んでください。` },
        { target: '#attendance-clockin-btn', wait: () => { const t = document.getElementById('attendance-msg')?.textContent || ''; return t && !t.includes('取得しています'); },
          text: '「<b>業務開始</b>」を押してください。<br>位置情報を使ってよいか聞かれたら「<b>許可</b>」を押します。<br><span style="font-size:13px;color:#6b7280">練習では位置情報はどこにも送りません。</span>' },
        { target: '#attendance-msg', text: () => (document.getElementById('attendance-msg')?.textContent || '').includes('記録しました')
            ? '記録できました！<br>本番では、<b>店から300m以内</b>で押したときに出勤として記録されます。'
            : '位置情報が使えませんでした。<br>本番では位置情報を<b>許可</b>しないと記録できません。スマホの設定で、このブラウザの位置情報を「許可」にしておきましょう。' },
        { target: () => one('#partner-tab-attendance .settings-accordion-hdr'), wait: 'click', text: '「<b>業務開始履歴</b>」を押すと、これまでの記録が見られます。' },
        { target: '#attendance-history-wrap', text: '押した日時と、店の近くで押せたか（✓）が出ます。' },
        { confirm: true, target: '#leave-date-input', wait: () => !!document.getElementById('leave-date-input')?.value,
          text: '次は<b>休み申請</b>です。休みたい日を選んでください（練習なので、どの日でも大丈夫です）。' },
        { target: () => one('#partner-tab-attendance button[onclick="submitLeaveRequest()"]'),
          wait: () => !!one('#leave-request-list-wrap button[onclick^="cancelLeaveRequest"]') || !!leaveOverlay(),
          text: '「<b>申請する</b>」を押してください。' },
        { optional: true, when: () => !!leaveOverlay(), target: () => leaveOverlay()?.querySelector('button'), wait: 'click',
          text: '<b>当日</b>休むときは、申請に加えて<b>店のグループトーク</b>にも連絡します。「閉じる」を押してください。' },
        { target: '#leave-request-list-wrap', text: '申請した休みがここに出ます。' },
        { target: () => one('#leave-request-list-wrap button[onclick^="cancelLeaveRequest"]'), wait: () => !one('#leave-request-list-wrap button[onclick^="cancelLeaveRequest"]'),
          text: '予定が変わったら「<b>キャンセル</b>」で取り消せます。押して、確認が出たら「OK」を押してください。' },
        { text: 'これで「業務開始・休み申請」はおしまいです。<br>店に着いたら、まず「業務管理」→「業務開始」です。', nextLabel: '章を終える' },
      ],
    },
    {
      key: 'order', title: '発注依頼', desc: '商品を選んで依頼する／届いたら納品済み', minutes: 15,
      available: () => true,
      prepare: async () => {
        goPartnerHome(); await sleep(200);
        switchPartnerTab('order'); switchOrderSubTab('request');
        ensureBlankDraftRow(STORE); renderStore(); await sleep(200);
      },
      steps: () => [
        { text: '発注依頼の練習です。<br>店で足りなくなりそうな商品を、本部に頼む方法を覚えましょう。<br><span style="font-size:13px;color:#6b7280">練習なので、本当に注文されることはありません。</span>' },
        { target: '#ptab-order', wait: 'click', text: '「<b>発注</b>」のタブを押してください。' },
        { target: () => one('#partner-tab-order .note-box'),
          text: '依頼の前に、上の注意書きを読んでおきましょう。<br>お店の機械（アペックス・トーヨーなど）と、頼むときのルールが書いてあります。<br>アペックスの店は、どれか1品を<b>1ケース以上</b>で頼みます（トーヨーの店は1ケース未満でも大丈夫です）。' },
        { target: () => T.prodInput(0), wait: 'click', text: '「<b>タップして選択</b>」を押すと、商品の一覧が開きます。' },
        { target: () => one('.prod-dropdown.open'), scroll: false, wait: () => T.prodChosen(0),
          text: '頼みたい商品を押して選んでください。<br>上の欄に「カップ」などと入れると、絞り込めます。' },
        { target: () => T.qtyPlus(0), wait: () => T.qtyVal(0) >= 2, text: '「<b>＋</b>」を押して、数を <b>2</b> にしてください。' },
        { optional: true, target: () => T.rowOf(0)?.querySelector('.unit-toggle-btn')?.parentElement,
          text: 'この商品は<b>バラ</b>と<b>ケース</b>を切り替えられます。ケースで頼むときはここを押します。' },
        { confirm: true, target: () => T.rowOf(0)?.querySelector('td.c-note textarea'), wait: () => !!T.rowOf(0)?.querySelector('td.c-note textarea')?.value.trim(),
          text: '伝えたいことがあれば<b>備考</b>に書きます。「練習」と入れてみてください。' },
        { target: () => [...(T.groupBar()?.querySelectorAll('label') || [])].find(l => l.textContent.includes('撮影')),
          wait: () => !!T.groupBar()?.querySelector('img'),
          text: '写真を付けることもできます。「<b>📷 撮影</b>」を押して、何か1枚撮ってみましょう。<br><span style="font-size:13px;color:#6b7280">撮った写真が横に出たら次に進みます。</span>' },
        { target: () => one('#store-tbody .btn-add-item'), wait: 'click', text: '「<b>＋ 商品を追加</b>」を押すと、同じ依頼にもう1品足せます。' },
        { target: () => T.prodInput(1), wait: 'click', text: '2品目の「<b>タップして選択</b>」を押してください。' },
        { target: () => one('.prod-dropdown.open'), scroll: false, wait: () => T.prodChosen(1), text: '1品目とは別の商品を選んでください。' },
        { target: () => T.qtyPlus(1), wait: () => T.qtyVal(1) >= 1, text: '「<b>＋</b>」を押して、数を入れてください。' },
        // 依頼すると次の依頼用の空の行がすぐ出る(2026-10-29〜)ので、「依頼する」ボタンが消えるのではなく、
        // 商品を選んだ下書きが無くなった(=依頼した)ことで進む
        { target: () => one('#store-tbody .btn-request'), wait: () => typeof storeRows !== 'undefined' && !storeRows.some(r => !r.locked && String(r.product || '').trim()),
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
    {
      key: 'checksheet', title: 'チェックシート（毎日）', desc: '補充した数・清掃のチェック・修正', minutes: 15,
      prepare: async () => {
        goPartnerHome(); await sleep(200);
        if (checksheetEditDay) endChecksheetPastEdit();
        checksheetActiveView = 'today'; checksheetActiveCategory = 'daily_count';
      },
      steps: () => [
        { text: 'チェックシートは<b>毎日</b>つけます。<br>補充した商品の数と、清掃・点検をしたかを記録します。' },
        { target: '#ptab-checklist', wait: 'click', text: '「<b>チェックシート</b>」のタブを押してください。' },
        { target: '#checksheet-cat-daily_count', wait: csLoaded, text: '「<b>デイリーカウント</b>」は、補充した商品の数をつける所です。<br><span style="font-size:13px;color:#6b7280">今日の数を読み込んでいます…</span>' },
        { target: () => csQtyRow(0), text: '商品の下の小さい字が、今日すでに保存されている数です。<br>大きい欄には「<b>今回補充した数</b>」を入れます。' },
        { target: () => csPlus(0), wait: () => csVal(0) >= 2, text: 'この商品を2個補充したことにしましょう。「<b>＋</b>」を2回押してください。' },
        { target: () => csQtyRow(0), text: '小さい字が「保存後 ○」に変わりました。保存すると、今日の数に足されます。' },
        { target: '#checksheet-save-btn', wait: () => csUnsaved() === 0 && csVal(0) === 0,
          text: '入力が終わったら「<b>保存する</b>」を押します。<br><span style="font-size:13px;color:#6b7280">押し忘れても1分たつと自動で保存されます。</span>' },
        { target: () => csMinus(0), wait: () => csVal(0) <= -1, text: '多く保存してしまったときは「<b>－</b>」で減らせます。1回押してみてください。' },
        { target: '#checksheet-cancel-btn', wait: () => csUnsaved() === 0,
          text: 'やっぱりやめるときは「<b>キャンセル</b>」で入力前に戻せます。押して、確認が出たら「OK」を押してください。' },
        { target: '#checksheet-cat-clean_check', wait: 'click', text: '次は「<b>清掃・点検</b>」です。押してください。' },
        { target: () => one('#checksheet-table-wrap .checksheet-today-row input[type=checkbox]')?.closest('.checksheet-today-row'),
          wait: () => all('#checksheet-table-wrap .checksheet-today-row input[type=checkbox]').some(c => c.checked),
          text: 'やった作業にチェックを付けます。1つチェックを付けてください。' },
        { target: '#checksheet-save-btn', wait: () => csUnsaved() === 0, text: '「<b>保存する</b>」を押してください。' },
        { target: () => one('#checksheet-table-wrap .checksheet-past-edit-btn'), wait: 'click',
          text: '前の日の分や、保存した合計を直したいときは「<b>保存済みの分を修正する</b>」を押します。押してください。' },
        { target: () => one('.checksheet-past-edit select'), text: 'ここで直したい日を選びます（今月と先月の分）。この画面では、<b>その日の合計そのもの</b>を正しい数にして保存します。' },
        { target: () => one('.checksheet-past-edit button'), wait: 'click', text: '今は直さずに「<b>今日の入力に戻る</b>」を押してください。' },
        { target: '#checksheet-view-toggle', wait: 'click', text: '「<b>当月のチェックシート履歴</b>」を押すと、今月の記録が表で見られます。' },
        { target: '#checksheet-table-wrap', text: '日ごとの記録と、下に合計が出ます。今日の行は黄色です。' },
        { target: '#checksheet-view-toggle', wait: 'click', text: 'もう一度押すと、今日の入力に戻ります。' },
        { text: 'これで「チェックシート」はおしまいです。<br>・補充したら＋で数を入れて保存<br>・清掃・点検はチェックを付けて保存', nextLabel: '章を終える' },
      ],
    },
    {
      key: 'machinephoto', title: 'マシン撮影（5の倍数の日）', desc: '5・10・15…日に庫内の写真を送る', minutes: 10,
      prepare: async () => { goPartnerHome(); await sleep(200); },
      steps: () => [
        { text: '毎月<b>5日・10日・15日・20日・25日・30日</b>に、マシンの中の写真を撮って送ります。<br>フィルター切れや材料切れを防ぐための点検です。<br><span style="font-size:13px;color:#6b7280">店にいない場合は、何を撮っても練習になります。</span>' },
        { target: '#ptab-checklist', wait: 'click', text: '「<b>チェックシート</b>」のタブを押してください。' },
        { target: '#checksheet-cat-album', wait: 'click', text: '「<b>アルバム</b>」を押してください。' },
        { target: '#machine-photo-samples', text: '撮り方の<b>お手本</b>です。押すと大きく見られます。お手本と同じ向き・同じ場所を撮りましょう。' },
        ...[0, 1, 2, 3, 4].map(k => ({
          target: () => mpCell(k), wait: () => mpFilled(k),
          text: () => `マシン①の「<b>${esc(MACHINE_PHOTO_SLOTS[k].label)}</b>」を撮ります。📷を押して撮影してください。<br><span style="font-size:13px;color:#6b7280">お手本${k + 1}と同じように撮ります（${k + 1} / 5枚目）</span>`,
        })),
        { setup: () => { snap = window.__onbDb.get().photos.length; },
          target: () => mpCard()?.querySelector('button[onclick^="submitMachinePhotoForMachine"]'), wait: () => window.__onbDb.get().photos.length > snap,
          text: '5枚そろったら「<b>マシン①をアップロード</b>」を押します。' },
        { target: () => document.getElementById('machine-photo-last-0'), text: '送った日時がここに出ます。<br>マシンが2台以上ある店は、<b>向かって左から</b>①②③…の順に、同じように撮って送ります。' },
        { text: 'これで「マシン撮影」はおしまいです。<b>5の倍数の日</b>を忘れないようにしましょう。', nextLabel: '章を終える' },
      ],
    },
    {
      key: 'lost', title: '忘れ物', desc: '忘れ物を見つけたら登録する', minutes: 5,
      prepare: async () => { goPartnerHome(); await sleep(200); },
      steps: () => [
        { text: 'お客様の忘れ物を見つけたら、ポータルに登録します。' },
        { target: '#ptab-lost', wait: 'click', text: '「<b>忘れ物</b>」のタブを押してください。' },
        { target: () => one('#partner-tab-lost > div > div:nth-child(2)'), text: '財布やスマホなどの<b>貴重品</b>は、交番か警察署に届けたうえで登録します。<br>それ以外の物は、登録して<b>店で1か月保管</b>したあと処分します。' },
        { target: '#lost-date-input', text: '見つけた日です。今日の日付が入っています。' },
        { confirm: true, target: '#lost-note-input', wait: () => !!document.getElementById('lost-note-input')?.value.trim(),
          text: 'どんな物か、どこにあったかを書きます。「黒い傘・入口の傘立て」のように入れてみてください。' },
        { target: () => all('#partner-tab-lost label').find(l => l.textContent.includes('撮影')), wait: () => !!one('#lost-image-preview img'),
          text: '写真を付けます。「<b>📷 撮影</b>」を押して、何か1枚撮ってください。' },
        { setup: () => { snap = window.__onbDb.get().lost.length; },
          target: '#lost-add-btn', wait: () => window.__onbDb.get().lost.length > snap && !!one('#lost-items-list button[onclick^="deleteLostItem"]'),
          text: '「<b>追加</b>」を押すと登録されます。' },
        { target: '#lost-items-list', text: '登録した忘れ物の一覧です。写真を押すと大きく見られます。<br>登録から30日たつと自動で消えます。' },
        { target: () => one('#lost-items-list button[onclick^="deleteLostItem"]'), wait: () => window.__onbDb.get().lost.length < snap + 1,
          text: 'お客様に返したら「<b>削除</b>」を押します。練習なので押してみてください。' },
        { text: 'これで「忘れ物」はおしまいです。', nextLabel: '章を終える' },
      ],
    },
    {
      key: 'inventory', title: '棚卸（月末）', desc: '月末に在庫を数えて送る', minutes: 15,
      prepare: async () => { goPartnerHome(); await sleep(200); },
      steps: () => [
        { text: '<b>月末</b>に、店にある商品の数（在庫）を数えて送ります。これを<b>棚卸</b>といいます。<br><span style="font-size:13px;color:#6b7280">練習では、1品目以外の数は入れておきました。</span>' },
        { target: '#ptab-inventory', wait: 'click', setup: async () => { switchPartnerTab('order'); await sleep(100); }, text: '「<b>棚卸表</b>」のタブを押してください。' },
        { setup: prepareInventory, target: () => one('#inventory-table-wrap thead'), text: '商品ごとに、数えた数を入れる表です。見出しの「期末在庫」の列に数を入れます。' },
        { confirm: true, target: () => invCell('endStock'), wait: () => !!invCell('endStock')?.querySelector('input')?.value,
          text: '1品目の「<b>期末在庫</b>」に、数えた数を入れます。練習なので「<b>5</b>」と入れてください。' },
        { optional: true, target: () => invFirstRow()?.querySelector('input[type=date]')?.closest('td'),
          text: '消費期限がある商品は、期限の日付と、その期限の個数も入れます。期限が近い物・切れた物は色が変わります。' },
        { target: () => invCell('disposedQty'),
          text: '期限切れなどで捨てた数は「<b>処分数量</b>」に入れます（無ければ空のままで大丈夫です）。' },
        { target: () => one('#inventory-table-wrap button[onclick="goToInventoryConfirm()"]'), wait: 'click', text: '全部入れたら「<b>確認 →</b>」を押します。' },
        { target: () => one('#inventory-table-wrap thead'), text: '確認画面です。先月の在庫・届いた数・今回の数から、使った数（<b>消費量</b>）が自動で計算されます。' },
        { confirm: true, optional: true, target: () => one('#inventory-table-wrap input[onchange^="updateInventoryPeriodField(\'anomalyNote\'"]')?.closest('tr'),
          wait: () => all('#inventory-table-wrap input[onchange^="updateInventoryPeriodField(\'anomalyNote\'"]').every(i => i.value.trim()),
          text: '先月より使った数がとても多い商品には、<b>理由</b>を書きます。「イベントで多く出た」などと入れてください。' },
        { target: '#inventory-submit-btn', wait: () => !!getInventoryPeriodData(STORE, getInventoryPeriod().label).lastSentAt,
          text: '最後に「<b>棚卸完了</b>」を押して送ります。確認が出たら「OK」を押してください。' },
        { text: 'これで「棚卸」はおしまいです。<br>月末の数日のうちに、全部の商品を数えて送りましょう。間違えたら、もう一度送り直せます。', nextLabel: '章を終える' },
      ],
    },
    {
      key: 'bugreport', title: 'バグ報告', desc: '困ったこと・要望を送る／返信を読む', minutes: 5,
      prepare: async () => { goPartnerHome(); await sleep(200); },
      steps: () => [
        { text: 'ポータルがうまく動かないときや「こうしてほしい」という要望は、「バグ報告」から本部に送れます。' },
        { target: '#ptab-bugreport', wait: 'click', text: '「<b>バグ報告</b>」のタブを押してください。' },
        { target: () => [one('#bugreport-kind-bug'), one('#bugreport-kind-request')].filter(Boolean), wait: 'click',
          text: '不具合なら左、要望なら右を選びます。どちらか押してください。' },
        { confirm: true, target: '#bugreport-content-input', wait: () => !!document.getElementById('bugreport-content-input')?.value.trim(),
          text: '何があったかを書きます。「練習の投稿です」と入れてください。<br><span style="font-size:13px;color:#6b7280">本番では、どの画面で何をしたらどうなったか、を書くと助かります。写真も付けられます。</span>' },
        { setup: () => { snap = window.__onbDb.get().bugs.length; },
          target: '#bugreport-submit-btn', wait: () => window.__onbDb.get().bugs.length > snap && !!bugItem(), text: '「<b>投稿する</b>」を押してください。' },
        { setup: simulateBugReply, target: bugItem,
          text: '本部から返事が来ると「<b>返信あり</b>」と出ます。<br><span style="font-size:13px;color:#6b7280">（練習なので、いま本部が返信したことにしました）</span>' },
        { target: () => bugItem()?.querySelector('[onclick^="toggleBugReportThread"]'), wait: () => !!one('#bugreport-list input[id^="bugreport-reply-input-"]'),
          text: '下の部分を押すと、やり取りが開きます。' },
        { target: () => one('#bugreport-list input[id^="bugreport-reply-input-"]')?.parentElement,
          wait: () => window.__onbDb.get().comments.filter(c => c.poster_type === 'partner').length > 0,
          text: '返事を書いて送れます。「ありがとうございます」と入れて「送信」を押してください。' },
        { text: 'これで「バグ報告」はおしまいです。困ったら遠慮なく送ってください。', nextLabel: '章を終える' },
      ],
    },
    {
      key: 'finish', title: '仕上げ', desc: 'ホームとログアウト', minutes: 2,
      prepare: async () => { goPartnerHome(); await sleep(200); },
      steps: () => [
        { target: T.homeBtn, text: '迷ったら「<b>ホーム</b>」。最初の画面に戻れます。' },
        { target: () => isMobile() ? one('.partner-hdr-pinwheel .phw-tr') : one('.partner-hdr-btns .portal-logout-btn'),
          text: '仕事が終わったら「<b>ログアウト</b>」を押します。<br>何もしないまま3時間たつと、自動でログアウトします。<br><span style="font-size:13px;color:#6b7280">（練習中にここを押すと、ガイダンスが終わります）</span>' },
        { text: 'スマホの<b>ホーム画面にアイコンを追加</b>しておくと、すぐに開けて便利です。やり方は「使い方ガイド」に載っています。' },
        { text: 'おつかれさまでした！ 目次で、まだ終わっていない章があれば進めてください。<br>全部終わったら「練習を終える」で、いつものログイン画面に戻ります。', nextLabel: '章を終える' },
      ],
    },
  ];

  // ---------- 起動 ----------
  (async () => {
    await waitUntil(() => document.getElementById('page-store')?.classList.contains('active'), 60000);
    mountOnce();
    await mergeServerProgress();
    openMenu(Object.keys(myProgress().done).length === 0);
  })();
})();
