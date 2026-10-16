/* 初めての人向けガイダンス(練習モード)の「本番に送らない」仕組み (2026-10-16)
 *
 * 練習用パスワードでログインすると sessionStorage.onboarding='1' でページを開き直し、
 * このファイルが<head>の最初で次の3つを差し替える。どれも練習モードの間だけで、通常のログインには一切影響しない。
 *  1. localStorage: キーの頭に 'onb:' を付けた別の場所に読み書きする。端末に残っている本番の
 *     未保存分(チェックシート等)や店舗データを練習で上書きしたり、本番のログインで練習データが
 *     送られたりしないようにするため。
 *  2. fetch: 社内ポータルのGASへの通信は、設定など読むだけのもの(ONB_PASS_GET)と修了記録
 *     (ONB_PASS_POST)以外はすべてこの中の練習用データ(onb_db)で返す。書き込みは本番に届かない。
 *     未知のactionもGETは[]、POSTは{ok:true}を返す(本番には送らない側に倒す)。
 *  3. Firebase(他端末への更新通知): onboarding-firebase-stub として index.html 側で差し替える。
 */
(function () {
  let on = false;
  try { on = sessionStorage.getItem('onboarding') === '1'; } catch (_) {}
  window.__ONB = on;
  if (!on) return;

  // ---- 1. localStorage の名前空間 ----
  const P = 'onb:';
  const proto = Storage.prototype;
  const _get = proto.getItem, _set = proto.setItem, _rm = proto.removeItem;
  const isLS = s => { try { return s === window.localStorage; } catch (_) { return false; } };
  proto.getItem = function (k) { return _get.call(this, isLS(this) ? P + k : k); };
  proto.setItem = function (k, v) { return _set.call(this, isLS(this) ? P + k : k, v); };
  proto.removeItem = function (k) { return _rm.call(this, isLS(this) ? P + k : k); };
  // 練習データを全部消す(ガイダンスの「最初からやり直す」用。本番のデータには触れない)
  window.__onbClearAll = function () {
    const ls = window.localStorage, keys = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(P)) keys.push(k); }
    keys.forEach(k => _rm.call(ls, k));
  };

  // ---- 練習用データ ----
  const DB_KEY = 'onb_db';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ymdhms = d => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const uid = () => 'onb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const trainee = () => { try { return sessionStorage.getItem('onb_name') || '練習 太郎'; } catch (_) { return '練習 太郎'; } };
  const storeId = () => { try { return sessionStorage.getItem('site_authed_store') || ''; } catch (_) { return ''; } };

  function seed() {
    const now = new Date();
    const d = n => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
    return {
      orders: [], checksheet: {}, lost: [], bugs: [], comments: [], att: [], leave: [], photos: [],
      deliveries: [], invHistory: {}, invSnapshots: {}, images: {},
      announcements: [
        { id: 'onb_a1', title: '【練習】年末年始の営業について', body: '練習用の業務連絡です。\n本番では、ここに本部からのお知らせが届きます。\n\nタイトルを押すと、このように本文が読めます。', publish_date: d(0), scope: 'all', status: 'published' },
        { id: 'onb_a2', title: '【練習】チェックシートに「保存する」ボタンができました', body: '練習用の業務連絡です。', publish_date: d(3), scope: 'all', status: 'published' },
      ],
    };
  }
  let db;
  try { db = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (_) { db = null; }
  if (!db) db = seed();
  const save = () => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { console.error('onb db save', e); } };
  save();

  // 画像: 本番ではDriveのURLが返る。練習では端末内に保存し、表示用のblob URLを返す
  // (data URLはカンマを含み、忘れ物の「URLをカンマ区切り」の形式を壊すため使わない)。
  // 行には 'onbimg:<id>' の目印で保存し、取り出す時にblob URLへ戻す(ページを開き直すとblob URLは無効になるため)
  const blobById = {}, idByBlob = {};
  function imgUrl(id) {
    if (blobById[id]) return blobById[id];
    const dataUrl = db.images[id];
    if (!dataUrl) return '';
    const [head, b64] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: mime }));
    blobById[id] = url; idByBlob[url] = id;
    return url;
  }
  function storeImage(b64, mime) {
    const id = uid();
    db.images[id] = `data:${mime || 'image/jpeg'};base64,${b64}`;
    return 'onbimg:' + id;
  }
  const detok = s => String(s || '').split(',').filter(Boolean).map(t => t.startsWith('onbimg:') ? imgUrl(t.slice(7)) : t).join(',');
  const tok = s => String(s || '').split(',').filter(Boolean).map(u => idByBlob[u] ? 'onbimg:' + idByBlob[u] : u).join(',');

  // ---- 2. GAS通信の差し替え ----
  const GAS_PREFIX = 'https://script.google.com/macros/s/';
  // 読むだけで本番に影響しないもの(店舗の設定・参考在庫)は本物を読む
  const ONB_PASS_GET = new Set(['getSettings', 'getStoreSettings', 'getSteraStockEstimate', 'getSteraProductGroups']);
  // 本番に送るのは修了記録だけ
  const ONB_PASS_POST = new Set(['saveOnboardingProgress']);
  const ONB_PASS_GET_READONLY = new Set(['getOnboardingProgress']);

  // 練習では、配属店の設定に関係なく業務開始・マシン撮影を体験できるようにする
  function adjustSettings(rows) {
    if (!Array.isArray(rows)) return rows;
    const sid = storeId();
    const get = k => { const r = rows.find(x => x.key === k); try { return r ? JSON.parse(r.value) : null; } catch (_) { return null; } };
    const put = (k, v) => {
      const r = rows.find(x => x.key === k);
      if (r) r.value = JSON.stringify(v); else rows.push({ key: k, value: JSON.stringify(v) });
    };
    const enabled = get('attendance_enabled_stores') || [];
    if (!enabled.includes(sid)) enabled.push(sid);
    put('attendance_enabled_stores', enabled);
    const staff = get('attendance_staff_list') || {};
    staff[sid] = [trainee(), '見本 花子'];
    put('attendance_staff_list', staff);
    put('machine_photo_disabled_stores', (get('machine_photo_disabled_stores') || []).filter(x => x !== sid));
    return rows;
  }

  function periodRows(sid) {
    const byP = db.checksheet[sid] || {};
    return Object.keys(byP).map(p => ({ store_id: sid, period_label: p, data: byP[p] }));
  }
  function attendanceRows(sid) { return db.att.filter(r => r.store_id === sid).sort((a, b) => b.clocked_at.localeCompare(a.clocked_at)); }
  function leaveRows(sid) { return db.leave.filter(r => r.store_id === sid).sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at))); }

  const GET = {
    getOrders: () => db.orders.map(r => Object.assign({}, r, { image_url: detok(r.image_url) || null })),
    getAnnouncements: () => db.announcements,
    getChecksheetData: q => periodRows(q.storeId),
    getInventoryHistory: q => db.invHistory[q.periodLabel] || [],
    getInventoryTabData: q => {
      const totals = {};
      db.deliveries.filter(x => x.periodLabel === q.periodLabel).forEach(x => { totals[x.product] = (totals[x.product] || 0) + Number(x.qty || 0); });
      return { history: db.invHistory[q.prevPeriodLabel] || [], deliveryAuto: totals, deliveryManual: { totals: {}, skipped: [] }, checksheet: periodRows(q.storeId) };
    },
    getLostItems: q => db.lost.filter(r => !q.storeId || r.store_id === q.storeId).map(r => Object.assign({}, r, { image_url: detok(r.image_url) })),
    getBugReports: q => db.bugs.filter(r => !q.storeId || r.store_id === q.storeId).map(r => Object.assign({}, r, { image_urls: detok(r.image_urls) })).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    getBugReportThread: q => db.comments.filter(c => c.issue_id === q.issueId),
    getAttendance: q => attendanceRows(q.storeId),
    getLeaveRequests: q => leaveRows(q.storeId),
    getAttendanceTabData: q => ({ history: attendanceRows(q.storeId), leaveRequests: leaveRows(q.storeId) }),
    getMachinePhotoHistory: q => db.photos.filter(r => r.store_id === q.storeId).map(r => {
      const pc = {}; Object.entries(r.photosByCategory || {}).forEach(([k, v]) => { pc[k] = detok(v); });
      return Object.assign({}, r, { photosByCategory: pc });
    }).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)),
    // 棚卸完了の後に呼ばれる集計(本番では書き込みを伴う)。練習では何もしない
    buildStoreInventorySheet: () => ({ ok: true }),
    buildStockCheckMonthly: () => ({ ok: true }),
    processMonthlyReorder: () => ({ ok: true }),
  };

  const POST = {
    upsertOrders: b => {
      (b.rows || []).forEach(r => {
        const row = Object.assign({}, r, { store_id: b.storeId, image_url: tok(r.image_url) || null });
        const i = db.orders.findIndex(x => x.id === row.id);
        if (i >= 0) db.orders[i] = Object.assign({}, db.orders[i], row); else db.orders.push(row);
      });
      return { ok: true };
    },
    saveOrders: b => {
      db.orders = db.orders.filter(r => r.store_id !== b.storeId)
        .concat((b.rows || []).map(r => Object.assign({}, r, { store_id: b.storeId, image_url: tok(r.image_url) || null })));
      return { ok: true };
    },
    deleteOrders: b => { const ids = new Set(b.ids || []); db.orders = db.orders.filter(r => !ids.has(r.id)); return { ok: true }; },
    saveOrderImage: b => { const t = storeImage(b.imageBase64, b.imageMime); return { ok: true, image_url: detok(t) }; },
    saveDeliveryHistory: () => ({ ok: true }),
    recordInventoryDelivery: b => { db.deliveries.push({ periodLabel: b.periodLabel, product: b.product, qty: b.qty }); return { ok: true }; },
    saveChecksheetData: b => {
      const byP = db.checksheet[b.storeId] = db.checksheet[b.storeId] || {};
      const cur = byP[b.periodLabel] = byP[b.periodLabel] || {};
      Object.entries(b.data || {}).forEach(([day, items]) => {
        cur[day] = Object.assign(cur[day] || {}, items, { _enteredAt: new Date().toISOString() });
      });
      return { ok: true };
    },
    checkWaterStockMismatch: () => ({ ok: true, skipped: 'onboarding' }),
    saveInventorySnapshot: b => { db.invSnapshots[b.periodLabel] = { rows: b.rows, remarks: b.remarks, at: ymdhms(new Date()) }; return { ok: true }; },
    saveLostItem: b => {
      const urls = (b.imagesBase64 || []).map(x => storeImage(x, b.imageMime)).join(',');
      db.lost.push(Object.assign({}, b.item, { image_url: urls }));
      return { ok: true, image_url: detok(urls) };
    },
    deleteLostItem: b => { db.lost = db.lost.filter(r => r.id !== b.id); return { ok: true }; },
    submitBugReport: b => {
      const now = ymdhms(new Date());
      const id = uid();
      db.bugs.push({
        no: 900 + db.bugs.length + 1, id, store_id: b.storeId, store_name: '', kind: b.kind, content: b.content,
        poster_type: b.posterType || 'partner', poster_name: b.posterName || '', status: '未対応', created_at: now, updated_at: now,
        image_urls: (b.imagesBase64 || []).map(x => storeImage(x, b.imageMime)).join(','), lineworks_user_id: '',
      });
      return { ok: true, id };
    },
    addBugReportComment: b => {
      const now = ymdhms(new Date());
      db.comments.push({ report_no: '', id: uid(), issue_id: b.issueId, poster_type: b.posterType, poster_name: b.posterName || '', store_id: b.storeId, text: b.text, created_at: now });
      const issue = db.bugs.find(x => x.id === b.issueId); if (issue) issue.updated_at = now;
      return { ok: true };
    },
    saveAttendance: b => {
      const now = new Date(), today = ymd(now);
      const i = db.att.findIndex(r => r.store_id === b.storeId && r.name === b.name && r.clocked_at.slice(0, 10) === today);
      // 位置情報は記録しない(練習では保存先が端末内でも残さない)。判定はどこにいても範囲内扱い
      const row = { id: i >= 0 ? db.att[i].id : uid(), store_id: b.storeId, name: b.name, clocked_at: ymdhms(now), lat: '', lng: '', within_range: true };
      if (i >= 0) db.att[i] = row; else db.att.push(row);
      return { ok: true, withinRange: true, updated: i >= 0 };
    },
    saveLeaveRequest: b => { db.leave.push({ id: uid(), store_id: b.storeId, name: b.name, leave_date: b.leaveDate, submitted_at: ymdhms(new Date()) }); return { ok: true }; },
    deleteLeaveRequest: b => { db.leave = db.leave.filter(r => r.id !== b.id); return { ok: true }; },
    saveMachinePhotoSet: b => {
      const pc = {}; Object.entries(b.imagesByCategory || {}).forEach(([k, v]) => { pc[k] = storeImage(v, b.imageMime); });
      const uploadedAt = ymdhms(new Date());
      db.photos.push({ id: uid(), store_id: b.storeId, machine_index: b.machineIndex, uploaded_at: uploadedAt, photosByCategory: pc });
      const urls = {}; Object.entries(pc).forEach(([k, v]) => { urls[k] = detok(v); });
      return { ok: true, urlsByCategory: urls, uploadedAt };
    },
  };

  const origFetch = window.fetch.bind(window);
  const json = (obj, delay) => new Promise(res => setTimeout(() => res(new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } })), delay));
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.startsWith(GAS_PREFIX)) return origFetch(input, init);
    const method = ((init && init.method) || 'GET').toUpperCase();
    if (method === 'GET') {
      const q = {}; new URL(url).searchParams.forEach((v, k) => { q[k] = v; });
      if (q.action === 'getSettings' || q.action === 'getStoreSettings') {
        return origFetch(input, init).then(r => r.json()).then(rows => json(adjustSettings(rows), 0));
      }
      if (ONB_PASS_GET.has(q.action) || ONB_PASS_GET_READONLY.has(q.action)) return origFetch(input, init);
      const h = GET[q.action];
      let out;
      try { out = h ? h(q) : []; } catch (e) { console.error('onb GET', q.action, e); out = []; }
      return json(out, 250);
    }
    let body = {};
    try { body = JSON.parse((init && init.body) || '{}'); } catch (_) {}
    if (ONB_PASS_POST.has(body.action)) return origFetch(input, init);
    const h = POST[body.action];
    let out;
    try { out = h ? h(body) : { ok: true }; } catch (e) { console.error('onb POST', body.action, e); out = { ok: true }; }
    save();
    return json(out, 400);
  };

  // ガイダンス側から練習データを動かす入口(管理者の対応を再現する等)
  window.__onbDb = {
    get: () => db,
    save,
    ymd, ymdhms, uid,
    reset: () => { db = seed(); save(); },
  };

  // 練習の開始直後に業務開始のリマインダー(モーダル)が出て案内の邪魔をしないよう、今日は表示済みにしておく
  try { localStorage.setItem('attendance_reminder_shown_' + storeId() + '_' + ymd(new Date()), '1'); } catch (_) {}
})();
