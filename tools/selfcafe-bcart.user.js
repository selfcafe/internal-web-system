// ==UserScript==
// @name         セルフカフェ Bカート自動カート入れ
// @namespace    https://selfcafe.github.io/internal-web-system/
// @version      1.0.0
// @description  ポータル・Bot の「Bカートに入れる」リンク（#sc-cart=商品番号x数,…）を開くと、ミル挽き珈琲CAFE（Bカート）のカートに品と数を入れる。注文の確定は人が押す
// @match        https://mirubiki-coffee.i16.bcart.jp/*
// @run-at       document-end
// @grant        none
// ==/UserScript==
//
// 使い方（2026-10-16 作成）
// - iPhone の Safari に「Userscripts」アプリ（無料）を入れて、このファイルを登録する。手順は tools/README_bcart.md
// - リンクの形: https://mirubiki-coffee.i16.bcart.jp/list.php#sc-cart=8x6,12x2&store=藤が丘
//   8・12 は Bカートの商品番号（product.php?id=8）、x の後ろはサイトの単位での数（ブレンドAなら kg）
// - Bカートにログインした状態で開くと、商品ページのフォームを読み取り、ボタンと同じ「cart/add」に送ってカートに入れる。
//   ログインは Safari に残っているものを使う（パスワードは扱わない）
// - 同じリンクで二重に入れないよう、入れ終わったらアドレスの #sc-cart を消し、この端末で入れたリンクは覚えておく
(function () {
  'use strict';
  const m = location.hash.match(/sc-cart=([^&]+)/);
  if (!m) return;
  const raw = decodeURIComponent(m[1]);
  const store = decodeURIComponent((location.hash.match(/store=([^&]+)/) || [])[1] || '');
  const items = raw.split(',').map(s => s.trim().match(/^(\d+)x(\d+)$/)).filter(Boolean).map(x => ({ id: x[1], qty: Number(x[2]) }));
  const clearHash = () => history.replaceState(null, '', location.pathname + location.search);
  if (!items.length) { clearHash(); return; }

  const DONE_KEY = 'sc-cart-done';
  let done = [];
  try { done = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch (e) { done = []; }
  const sig = location.hash;

  // 画面の上に出す進み具合
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:2147483647;background:#fff;color:#222;border:2px solid #3a7d44;' +
    'border-radius:10px;padding:12px 14px;font:15px/1.6 -apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);max-height:80vh;overflow:auto';
  const log = (html) => { box.innerHTML += html; };
  const addBox = () => { if (!box.isConnected) document.body.appendChild(box); };

  const sideCart = (html) => {
    const t = new DOMParser().parseFromString(html, 'text/html').body.innerText;
    const s = (t.match(/カート\s*\n([\s\S]{0,120}?)カテゴリ/) || [])[1] || '';
    return s.replace(/\s+/g, ' ').replace('カートを見る', '').trim();
  };

  async function addOne(it) {
    const res = await fetch('/product.php?id=' + it.id, { credentials: 'include' });
    if (/login/.test(res.url)) throw new Error('ログインしていません');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const form = [...doc.forms].find(f => f.querySelector('.__js-add-cart'));
    if (!form) throw new Error('商品ページに「カートに入れる」がありません');
    const num = form.querySelector('input[type=number]');
    const name = (doc.querySelector('h1, .__product-name, title') || {}).textContent || ('商品' + it.id);
    const body = new URLSearchParams(new FormData(form));
    body.set(num.name, String(it.qty));
    const r = await fetch('/cart/add', { method: 'POST', credentials: 'include', body: body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
    let st = '';
    try { st = (await r.json()).status; } catch (e) { st = 'HTTP ' + r.status; }
    if (st !== 'success') throw new Error('カートに入りませんでした（' + st + '）');
    return name.replace(/\s*\|.*$/, '').trim();
  }

  async function run() {
    addBox();
    log('<b>Bカートに入れます' + (store ? '（' + store + '）' : '') + '</b><br>');
    if (done.indexOf(sig) >= 0 && !confirm('このリンクの品は、この iPhone で一度カートに入れています。もう一度入れますか？')) {
      clearHash(); log('入れませんでした（入れ済み）。<br><a href="/cart.php">カートを見る</a>'); return;
    }
    const before = sideCart(await (await fetch('/list.php', { credentials: 'include' })).text());
    if (before && before.indexOf('空') < 0 && !confirm('カートに品が入っています（' + before + '）。足して入れますか？\n（別の店の品なら、先に注文するか削除してください）')) {
      clearHash(); log('入れませんでした（カートに別の品あり）。<br><a href="/cart.php">カートを見る</a>'); return;
    }
    let ok = 0;
    for (const it of items) {
      try { const name = await addOne(it); ok++; log('✓ ' + name + ' ×' + it.qty + '<br>'); }
      catch (e) {
        log('<span style="color:#b00">✗ 商品' + it.id + ' ×' + it.qty + ': ' + e.message + '</span><br>');
        if (/ログイン/.test(e.message)) { log('ログインしてから、もう一度リンクを開いてください。'); return; }
      }
    }
    clearHash();
    if (ok) { done.push(sig); try { localStorage.setItem(DONE_KEY, JSON.stringify(done.slice(-50))); } catch (e) {} }
    const after = sideCart(await (await fetch('/list.php', { credentials: 'include' })).text());
    log('<br>' + ok + ' / ' + items.length + ' 品を入れました。カート: ' + after + '<br>' +
      '<a href="/cart.php" style="display:inline-block;margin-top:8px;padding:8px 14px;background:#3a7d44;color:#fff;border-radius:6px;text-decoration:none">カートを見る（配送先を選んで注文）</a>');
  }

  run().catch(e => { addBox(); log('<span style="color:#b00">エラー: ' + e.message + '</span>'); });
})();
