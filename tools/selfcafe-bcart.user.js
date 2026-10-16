// ==UserScript==
// @name         セルフカフェ Bカート自動カート入れ
// @namespace    https://selfcafe.github.io/internal-web-system/
// @version      1.1.1
// @description  ポータル・Bot の「トーベンのカートに入れる」リンク（#sc-cart=商品番号x数,…）を開くと、ミル挽き珈琲CAFE（Bカート）のカートに品と数を入れる。注文の確定は人が押す
// @match        https://mirubiki-coffee.i16.bcart.jp/*
// @run-at       document-end
// @grant        none
// ==/UserScript==
//
// 使い方（2026-10-16 作成）
// - iPhone の Safari に「Userscripts」アプリ（無料）を入れて、このファイルを登録する。手順は tools/bcart-setup.html
// - リンクの形: https://mirubiki-coffee.i16.bcart.jp/list.php#sc-cart=29x2,12x1,mx1&store=大塚駅南口&area=関東
//   29・12 は Bカートの商品番号（product.php?id=29）、x の後ろはサイトの単位での数（ブレンドAなら kg、カップはケース）。
//   mx1 は無料メンテナンス（アカウントごとに商品が違うので「メンテナンス」で検索して見つける）
// - Bカートにログインした状態で開くと、商品ページのフォームを読み取り、ボタンと同じ「cart/add」に送ってカートに入れる。
//   ログインは Safari に残っているものを使う（パスワードは扱わない）
// - area（関東・東海）を付けると、ログイン中のアカウントの配送先一覧でエリアを確かめ、違えばカートに入れずにログインし直しを頼む。
//   ログインし直したら、覚えておいた品を自動で入れる（30分以内）
// - 同じリンクで二重に入れないよう、入れ終わったらアドレスの #sc-cart を消し、この端末で入れたリンクは覚えておく
(function () {
  'use strict';
  const PENDING_KEY = 'sc-cart-pending', DONE_KEY = 'sc-cart-done';
  // エリアの見分け: アカウントの配送先一覧（my_addr.php）に出る店の名前
  const AREA_SIGS = { '関東': ['上里', '千歳', '烏山', '大塚'], '東海': ['藤が丘', '高畑', '丸の内', '岐阜北方', '本陣'] };

  const store_ = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const save_ = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let hash = location.hash;
  const fromLink = /sc-cart=/.test(hash);
  if (!fromLink) {
    const p = store_(PENDING_KEY);
    if (!p || Date.now() - p.at > 30 * 60 * 1000 || /login/.test(location.pathname)) return;
    hash = p.hash;   // ログインし直したあとの続き
  }
  const param = (k) => decodeURIComponent((hash.match(new RegExp(k + '=([^&]+)')) || [])[1] || '');
  const store = param('store'), area = param('area');
  const items = param('sc-cart').split(',').map(s => s.trim().match(/^(\d+|m)x(\d+)$/)).filter(Boolean).map(x => ({ id: x[1], qty: Number(x[2]) }));
  const clearHash = () => { if (fromLink) history.replaceState(null, '', location.pathname + location.search); };
  if (!items.length) { clearHash(); save_(PENDING_KEY, null); return; }

  const done = store_(DONE_KEY) || [];
  const sig = hash;

  // 画面の上に出す進み具合
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;background:#fff;color:#222;border:2px solid #3a7d44;' +
    'border-radius:10px;padding:12px 14px;font:15px/1.6 -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);max-height:80vh;overflow:auto';
  const log = (html) => { box.innerHTML += html; };
  const button = (href, text) => '<a href="' + href + '" style="display:inline-block;margin-top:8px;padding:8px 14px;background:#3a7d44;color:#fff;border-radius:6px;text-decoration:none">' + text + '</a>';
  const addBox = () => { if (!box.isConnected) document.body.appendChild(box); };

  const getDoc = async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { loggedOut: /login/.test(res.url), doc: new DOMParser().parseFromString(await res.text(), 'text/html') };
  };
  const sideCart = (doc) => {
    const s = (doc.body.innerText.match(/カート\s*\n([\s\S]{0,120}?)カテゴリ/) || [])[1] || '';
    return s.replace(/\s+/g, ' ').replace('カートを見る', '').trim();
  };
  const askLogin = (msg) => {
    save_(PENDING_KEY, { hash: sig, at: Date.now() });
    clearHash();
    log(msg + '<br>ログインすると、続けて自動でカートに入れます（30分以内）。<br>' +
      button('/logout.php', 'ログアウトしてログイン画面へ'));
  };

  // 無料メンテナンス: このアカウントで見える「メンテナンス」の商品を探す
  async function maintenanceId() {
    const { doc } = await getDoc('/list.php?keyword=' + encodeURIComponent('メンテナンス'));
    const a = [...doc.querySelectorAll('a[href*="product.php?id="]')].find(x => /メンテナンス/.test(x.textContent));
    const any = a || doc.querySelector('a[href*="product.php?id="]');
    const m = any && any.getAttribute('href').match(/id=(\d+)/);
    if (!m) throw new Error('無料メンテナンスの商品が見つかりません');
    return m[1];
  }

  async function addOne(it) {
    const id = it.id === 'm' ? await maintenanceId() : it.id;
    const { loggedOut, doc } = await getDoc('/product.php?id=' + id);
    if (loggedOut) throw new Error('ログインしていません');
    const form = [...doc.forms].find(f => f.querySelector('.__js-add-cart'));
    if (!form) throw new Error(/品切れ/.test(doc.body.innerText) ? '品切れ中でカートに入れられません（無料メンテナンスなら今月分は受付終了か、トーヨーに確認）' : 'このアカウントでは商品' + id + 'を注文できません');
    const num = form.querySelector('input[type=number]');
    const name = ((doc.querySelector('title') || {}).textContent || ('商品' + id)).replace(/\s*\|.*$/, '').trim();
    const body = new URLSearchParams(new FormData(form));
    body.set(num.name, String(it.qty));
    const r = await fetch('/cart/add', { method: 'POST', credentials: 'include', body: body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
    let st = '';
    try { st = (await r.json()).status; } catch (e) { st = 'HTTP ' + r.status; }
    if (st !== 'success') throw new Error(name + ' がカートに入りませんでした（' + st + '）');
    return name;
  }

  async function run() {
    addBox();
    log('<b>トーベンのカートに入れます' + (store ? '（' + store + (area ? '・' + area : '') + '）' : '') + '</b><br>');
    // ログインとエリアの確認
    const addr = await getDoc('/my_addr.php');
    if (addr.loggedOut) { askLogin('Bカートにログインしていません。' + (area ? area + 'のアカウントで' : '') + 'ログインしてください。'); return; }
    if (area && AREA_SIGS[area]) {
      const text = addr.doc.body.innerText;
      const hit = Object.keys(AREA_SIGS).filter(a => AREA_SIGS[a].some(k => text.indexOf(k) >= 0));
      if (hit.indexOf(area) < 0) {
        askLogin('いまは' + (hit.length ? hit.join('・') : '別') + 'のアカウントです。<b>' + area + '</b>のアカウントでログインし直してください。');
        return;
      }
    }
    save_(PENDING_KEY, null);
    if (done.indexOf(sig) >= 0 && !confirm('このリンクの品は、この iPhone で一度カートに入れています。もう一度入れますか？')) {
      clearHash(); log('入れませんでした（入れ済み）。<br>' + button('/cart.php', 'カートを見る')); return;
    }
    const before = sideCart((await getDoc('/list.php')).doc);
    if (before && before.indexOf('空') < 0 && !confirm('カートに品が入っています（' + before + '）。足して入れますか？\n（別の店の品なら、先に注文するか削除してください）')) {
      clearHash(); log('入れませんでした（カートに別の品あり）。<br>' + button('/cart.php', 'カートを見る')); return;
    }
    let ok = 0;
    for (const it of items) {
      try { const name = await addOne(it); ok++; log('✓ ' + name + ' ×' + it.qty + '<br>'); }
      catch (e) {
        log('<span style="color:#b00">✗ ' + (it.id === 'm' ? '無料メンテナンス' : '商品' + it.id) + ' ×' + it.qty + ': ' + e.message + '</span><br>');
        if (/ログインしていません/.test(e.message)) { askLogin(''); return; }
      }
    }
    clearHash();
    if (ok) { done.push(sig); save_(DONE_KEY, done.slice(-50)); }
    const after = sideCart((await getDoc('/list.php')).doc);
    log('<br>' + ok + ' / ' + items.length + ' 品を入れました。カート: ' + after + '<br>' +
      (store ? '注文画面で配送先を<b>' + store + '</b>にしてください。<br>' : '') + button('/cart.php', 'カートを見る（配送先を選んで注文）'));
  }

  run().catch(e => { addBox(); log('<span style="color:#b00">エラー: ' + e.message + '</span>'); });
})();
