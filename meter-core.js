/* 集計表（ドリンクマシンのメーター）の中身。社内ポータル(index.html)と単独ページ(meter.html)で共通に使う(2026-10-19〜)。
   - ドリンクマシンの表示は「金種(売価)ごとの累計杯数」。その日に読んだ累計を入れると、前回の記録との差で杯数、
     杯数×売価でメーター上の金額を出す。メーター上の金額はサブスク(オフィス決済)分も含むので実売上ではない(要検討)。
   - 使う店と機械・金種は設定 meter_config = {店舗ID: {machines:[{label, prices:[520,...]}]}}(外した店は null)。
     管理者が「使う店の設定」でチェックを入れて紐づける。
   - salesReport: true の店(布袋。名鉄へ毎日売上を報告する)は、入力画面と月の表に「売上報告」として
     総売上(=金額、税込)・税抜・消費税・客数(=杯数)を出す(2026-10-29〜、元のスプレッドシートの「売上報告」欄の代わり)。
     税抜は 総売上÷1.1 を四捨五入、消費税は 総売上−税抜。
     報告サイトのログイン情報は設定 meter_report_info({店舗ID:{text}})。設定の読み込みには入れず(公開で読めるため)、
     getMeterReportInfo(その店の通行証だけ)で読んで、売上報告の下に「タップで表示」で出す。
   - 記録はGASの meter_readings(getMeterReadings / saveMeterReading。同じ日は置き換え)。
   使い方: MeterCore.init({ get, post, names, configAll, onConfigSaved }) のあと
     MeterCore.mountSheet(要素, 店舗ID)  … 入力画面＋月の表(店舗・管理者で共通)
     MeterCore.mountAdmin(要素)           … 管理者の「店ごとの集計表」「使う店の設定」
   get(action, params) / post(action, body) は通行証付きでGASを呼ぶ関数(ポータルの gasGet/gasPost)。
   names() は {店舗ID: 店名}、configAll() は今の meter_config、onConfigSaved(新しい meter_config) で呼び出し元が手元の設定を更新する。 */
(function () {
  const esc = s => (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const today = () => new Date().toLocaleDateString('sv');
  const yen = n => Number(n || 0).toLocaleString('ja-JP');
  const md = d => { const [, m, dd] = String(d).split('-'); return `${Number(m)}/${Number(dd)}`; };
  // 売上報告の税抜・消費税(税込の総売上から。消費税は総売上−税抜にして、足すと総売上に合うように)
  const exTax = t => Math.round(Number(t || 0) / 1.1);
  const monthOf = k => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); return d.toLocaleDateString('sv').slice(0, 7); };

  const CSS = `
  .mc-root { --mc-green:#22703d; --mc-green-bg:#f0f7e8; --mc-muted:#64748b; --mc-red:#dc2626; color:#1f2937; }
  .mc-root .mc-card { background:white; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.08); padding:12px 14px; margin-bottom:12px; }
  .mc-root .mc-note { font-size:12px; color:#92400e; background:#fef9c3; border:1px solid #fde68a; border-radius:6px; padding:8px 12px; line-height:1.7; margin-bottom:12px; }
  .mc-root .mc-btn { padding:8px 18px; border:none; border-radius:6px; font-weight:700; cursor:pointer; font-family:inherit; font-size:14px; background:var(--mc-green); color:white; }
  .mc-root .mc-btn.sub { background:white; color:#334155; border:1px solid #cbd5e1; }
  .mc-root .mc-btn.small { padding:4px 10px; font-size:12px; }
  .mc-root .mc-btn:disabled { opacity:.6; cursor:default; }
  .mc-root input[type=text], .mc-root input[type=number], .mc-root input[type=date], .mc-root select { padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:15px; font-family:inherit; background:white; }
  .mc-root .mc-tabs { display:flex; gap:4px; margin-bottom:12px; background:var(--mc-green-bg); padding:4px; border-radius:8px; }
  .mc-root .mc-tabs button { flex:1; padding:8px; border:none; background:transparent; border-radius:6px; font-weight:700; color:var(--mc-green); cursor:pointer; font-family:inherit; }
  .mc-root .mc-tabs button.on { background:var(--mc-green); color:white; }
  .mc-root table.mc-grid { border-collapse:collapse; width:100%; }
  .mc-root thead tr { background:transparent; color:inherit; }   /* ポータルは thead tr に緑の背景を付けているので、集計表の中では外す */
  .mc-root table.mc-grid th { font-size:11px; color:var(--mc-muted); background:transparent; text-align:left; padding:4px 8px; border-bottom:1px solid #e5e7eb; white-space:nowrap; font-weight:600; }
  .mc-root table.mc-grid td { padding:6px 8px; border-bottom:1px solid #f1f5f9; }
  .mc-root .mc-num { text-align:right; white-space:nowrap; }
  .mc-root .mc-month { overflow-x:auto; }
  .mc-root .mc-month table { border-collapse:collapse; min-width:100%; background:white; }
  .mc-root .mc-month th { padding:4px 6px; border-bottom:1px solid #e5e7eb; font-size:11px; white-space:nowrap; background:var(--mc-green-bg); color:#1f2937; font-weight:600; }
  .mc-root .mc-month td { padding:4px 6px; border-bottom:1px solid #f1f5f9; text-align:right; white-space:nowrap; font-size:12px; }
  .mc-root .mc-month td:first-child { text-align:left; }
  .mc-root .mc-msg { font-size:13px; min-height:18px; }
  .mc-root .ok { color:#16a34a; } .mc-root .ng { color:var(--mc-red); }
  .mc-root .mc-store { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-bottom:1px solid #f1f5f9; flex-wrap:wrap; }
  .mc-root .mc-store label { min-width:200px; font-weight:600; display:flex; gap:6px; align-items:center; cursor:pointer; }
  .mc-root .mc-machines { flex:1; min-width:280px; }
  .mc-root .mc-mline { display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap; }
  @media (max-width:600px) { .mc-root .mc-store label { min-width:100%; } }`;

  const M = {
    o: null,
    s: { storeId: null, readings: null, date: today(), month: today().slice(0, 7), draft: {}, adminTab: 'sheet', filter: '', wrap: null },

    init(opts) {
      this.o = opts;
      if (!document.getElementById('mc-style')) {
        const st = document.createElement('style'); st.id = 'mc-style'; st.textContent = CSS; document.head.appendChild(st);
      }
    },
    configOf(sid) { const c = (this.o.configAll() || {})[sid]; return c && Array.isArray(c.machines) && c.machines.length ? c : null; },
    linkedStores() { const all = this.o.configAll() || {}, names = this.o.names(); return Object.keys(all).filter(s => this.configOf(s)).sort((a, b) => String(names[a] || a).localeCompare(String(names[b] || b), 'ja')); },

    /* ----- 計算 ----- */
    buttonsOf(cfg) {
      const out = [];
      cfg.machines.forEach((m, mi) => (m.prices || []).forEach((p, si) => out.push({ key: mi + '_' + si, machine: mi, slot: si, price: Number(p) || 0, label: m.label || ('機械' + (mi + 1)) })));
      return out;
    },
    daily(cfg, readings) {
      const buttons = this.buttonsOf(cfg), byDate = {}, last = {};
      (readings || []).forEach(r => { if (r && r.date && r.count !== null && r.count !== undefined) (byDate[r.date] = byDate[r.date] || {})[r.machine + '_' + r.slot] = Number(r.count); });
      return Object.keys(byDate).sort().map(date => {
        const counts = byDate[date], cups = {}, warn = [];
        let cupsTotal = 0, yenTotal = 0;
        buttons.forEach(b => {
          const c = counts[b.key];
          if (c === undefined) return;
          if (last[b.key] !== undefined) {
            const d = c - last[b.key].count;
            cups[b.key] = d;
            if (d < 0) warn.push(`${b.label} ${b.price}円 が前回(${md(last[b.key].date)})より小さい`);
            else { cupsTotal += d; yenTotal += d * b.price; }
          }
          last[b.key] = { count: c, date };
        });
        return { date, counts, cups, cupsTotal, yenTotal, warn };
      });
    },
    previousOf(readings, beforeDate) {
      const prev = {};
      (readings || []).filter(r => r && r.date < beforeDate && r.count !== null && r.count !== undefined)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .forEach(r => { prev[r.machine + '_' + r.slot] = { count: Number(r.count), date: r.date }; });
      return prev;
    },
    monthTableHtml(cfg, readings, month) {
      const buttons = this.buttonsOf(cfg);
      const days = this.daily(cfg, readings).filter(d => d.date.startsWith(month));
      if (!days.length) return '<div style="color:#aaa;padding:12px 0;font-size:13px">この月の記録はまだありません</div>';
      const rep = !!cfg.salesReport;
      const repCells = t => rep ? `<td>${yen(exTax(t))}</td><td>${yen(t - exTax(t))}</td>` : '';
      let sc = 0, sy = 0;
      const rows = days.map(d => {
        sc += d.cupsTotal; sy += d.yenTotal;
        const cells = buttons.map(b => {
          const c = d.counts[b.key], cup = d.cups[b.key];
          if (c === undefined) return '<td></td>';
          const t = cup === undefined ? '' : (cup < 0 ? '<span class="ng">要確認</span>' : `${cup}杯`);
          return `<td><div style="font-weight:600">${t}</div><div style="color:#94a3b8;font-size:10px">${c}</div></td>`;
        }).join('');
        const w = d.warn.length ? ` class="ng" title="${esc(d.warn.join('／'))}"` : '';
        return `<tr><td><span${w}>${md(d.date)}</span></td>${cells}<td><b>${d.cupsTotal}</b></td><td><b>${yen(d.yenTotal)}</b></td>${repCells(d.yenTotal)}</tr>`;
      }).join('');
      return `<div class="mc-month"><table>
        <thead><tr><th rowspan="2">日付</th>${cfg.machines.map(m => `<th colspan="${(m.prices || []).length}">${esc(m.label || '')}</th>`).join('')}<th rowspan="2">${rep ? '杯数<br>(客数)' : '杯数'}</th><th rowspan="2">${rep ? '金額(円)<br>(総売上)' : '金額(円)'}</th>${rep ? '<th rowspan="2">税抜</th><th rowspan="2">消費税</th>' : ''}</tr>
        <tr>${buttons.map(b => `<th>${b.price}円</th>`).join('')}</tr></thead>
        <tbody>${rows}<tr><td><b>合計</b></td>${buttons.map(() => '<td></td>').join('')}<td><b>${sc}</b></td><td><b>${yen(sy)}</b></td>${repCells(sy)}</tr></tbody>
      </table></div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;line-height:1.6">太字は前回の記録からの杯数、小さい数字は機械の累計です。金額は杯数×売価（メーター上の金額。サブスク分も含むので実売上ではありません）。前回より小さい数字は「要確認」と出ます。${rep ? '税抜は金額÷1.1（四捨五入）、消費税は金額−税抜です。' : ''}</div>`;
    },

    /* ----- 入力画面＋月の表 ----- */
    async loadReadings(sid, force) {
      if (!force && this.s.storeId === sid && this.s.readings) return;
      const res = await this.o.get('getMeterReadings', { storeId: sid });
      if (!Array.isArray(res)) throw new Error((res && res.error) || '記録を読み込めませんでした');
      this.s.storeId = sid; this.s.readings = res;
    },
    async mountSheet(wrap, sid) {
      wrap.classList.add('mc-root');
      this.s.wrap = wrap;
      if (this.s.storeId !== sid) Object.assign(this.s, { storeId: null, readings: null, date: today(), month: today().slice(0, 7), draft: {} });
      const cfg = this.configOf(sid);
      if (!cfg) { wrap.innerHTML = '<div class="mc-card">この店舗は集計表の対象ではありません。必要なときは本部にご連絡ください。</div>'; return; }
      if (!this.s.readings) {
        wrap.innerHTML = '<div class="mc-card" style="color:#aaa">読み込み中…</div>';
        try { await this.loadReadings(sid); } catch (e) { wrap.innerHTML = `<div class="mc-card ng">集計表を読み込めませんでした（${esc(e.message)}）。通信環境の良い場所で再読み込みしてください。</div>`; return; }
        if (this.s.wrap !== wrap || !wrap.isConnected) return;
      }
      const date = this.s.date, readings = this.s.readings, prev = this.previousOf(readings, date);
      const todays = {};
      readings.filter(r => r.date === date).forEach(r => { todays[r.machine + '_' + r.slot] = r.count; });
      const noteToday = (readings.find(r => r.date === date && r.note) || {}).note || '';
      const machines = cfg.machines.map((m, mi) => `<div class="mc-card">
        <div style="font-weight:700;color:var(--mc-green);margin-bottom:6px">${esc(m.label || ('機械' + (mi + 1)))}</div>
        <table class="mc-grid"><thead><tr><th>金種（売価）</th><th>前回の数字</th><th>今日の数字</th><th class="mc-num">杯数</th><th class="mc-num">金額</th></tr></thead><tbody>
        ${(m.prices || []).map((p, si) => {
          const key = mi + '_' + si, pv = prev[key], dr = (this.s.draft[date] || {})[key];
          const val = dr !== undefined ? dr : (todays[key] !== undefined && todays[key] !== null ? todays[key] : '');
          return `<tr><td style="font-weight:600">${Number(p)}円</td>
            <td style="color:#64748b;font-size:13px">${pv ? `${pv.count}<span style="font-size:10px">（${md(pv.date)}）</span>` : '—'}</td>
            <td><input type="number" inputmode="numeric" min="0" class="mc-input" data-key="${key}" data-machine="${mi}" data-slot="${si}" data-price="${Number(p)}" value="${esc(val)}" oninput="MeterCore.draftInput(this)" style="width:120px"></td>
            <td class="mc-num" data-cups="${key}"></td><td class="mc-num" data-yen="${key}" style="color:#475569"></td></tr>`;
        }).join('')}</tbody></table></div>`).join('');
      const thisMonth = monthOf(0), lastMonth = monthOf(1);
      wrap.innerHTML = `
        <div class="mc-note">ドリンクマシンに出ている<b>金種（売価）ごとの累計の数字</b>を、そのまま入れてください。前回の数字との差が「杯数」、杯数×売価が「金額」として自動で出ます。毎日だいたい同じ時刻に読んでください。</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
          <b style="font-size:13px">読んだ日</b>
          <input type="date" value="${esc(date)}" max="${today()}" onchange="MeterCore.s.date=this.value||'${today()}';MeterCore.refresh()">
          ${readings.some(r => r.date === date) ? '<span style="font-size:12px" class="ok">この日は記録済みです（直して保存すると上書きします）</span>' : ''}
        </div>
        ${machines}
        <div class="mc-card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="font-size:16px">合計 <b class="mc-total-cups">0</b> 杯 ／ <b class="mc-total-yen">0</b> 円</div>
          ${cfg.salesReport ? `<div class="mc-report" style="width:100%;background:var(--mc-green-bg);border-radius:8px;padding:8px 12px">
            <div style="font-weight:700;color:var(--mc-green);margin-bottom:4px">売上報告（この日の分）</div>
            <table class="mc-grid" style="width:auto"><tbody>
              <tr><td>総売上</td><td class="mc-num"><b class="mc-rep-total">—</b> 円</td></tr>
              <tr><td>税抜</td><td class="mc-num"><b class="mc-rep-ex">—</b> 円</td></tr>
              <tr><td>消費税</td><td class="mc-num"><b class="mc-rep-tax">—</b> 円</td></tr>
              <tr><td>客数</td><td class="mc-num"><b class="mc-rep-cust">—</b> 人</td></tr>
            </tbody></table>
            <div style="font-size:11px;color:#64748b;margin-top:4px">すべての金種を入れると出ます（前回の数字との差から計算）。</div>
            <div class="mc-login" style="display:none;margin-top:8px;font-size:13px">
              <button class="mc-btn sub small" onclick="const b=this.nextElementSibling;b.style.display=b.style.display==='none'?'':'none';this.textContent=b.style.display==='none'?'報告サイトのログイン情報を表示':'閉じる'">報告サイトのログイン情報を表示</button>
              <div class="mc-login-text" style="display:none;white-space:pre-wrap;background:white;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-top:6px;user-select:all"></div>
            </div></div>` : ''}
          <input type="text" class="mc-note-input" placeholder="メモ（機械の不具合・補償など）" value="${esc(noteToday)}" style="flex:1;min-width:180px">
          <button class="mc-btn mc-save" onclick="MeterCore.save()">保存する</button>
          <div class="mc-msg mc-save-msg" style="width:100%"></div>
        </div>
        <div class="mc-card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <b style="color:var(--mc-green)">月の集計表</b>
            <select onchange="MeterCore.s.month=this.value;MeterCore.refresh()">
              <option value="${thisMonth}" ${this.s.month === thisMonth ? 'selected' : ''}>今月（${Number(thisMonth.slice(5))}月）</option>
              <option value="${lastMonth}" ${this.s.month === lastMonth ? 'selected' : ''}>先月（${Number(lastMonth.slice(5))}月）</option>
            </select>
          </div>
          ${this.monthTableHtml(cfg, readings, this.s.month)}
        </div>`;
      this.recalc();
      if (cfg.salesReport) this.loadReportInfo(wrap, sid);
    },
    // 報告サイトのログイン情報(読めなくても入力・計算には関係しないので、黙って出さないだけ)
    async loadReportInfo(wrap, sid) {
      try {
        if (!this.s.reportInfo || this.s.reportInfo.sid !== sid) {
          const res = await this.o.get('getMeterReportInfo', { storeId: sid });
          this.s.reportInfo = { sid, text: (res && res.info && res.info.text) || '' };
        }
        const box = wrap.querySelector('.mc-login');
        if (!box || !this.s.reportInfo.text) return;
        box.querySelector('.mc-login-text').textContent = this.s.reportInfo.text;
        box.style.display = '';
      } catch (e) { console.warn('getMeterReportInfo', e); }
    },
    refresh() { if (this.s.wrap && this.s.storeId) this.mountSheet(this.s.wrap, this.s.storeId); },
    draftInput(inp) { (this.s.draft[this.s.date] = this.s.draft[this.s.date] || {})[inp.dataset.key] = inp.value; this.recalc(); },
    recalc() {
      const w = this.s.wrap; if (!w) return;
      const prev = this.previousOf(this.s.readings, this.s.date);
      let cups = 0, sum = 0;
      w.querySelectorAll('.mc-input').forEach(inp => {
        const key = inp.dataset.key, price = Number(inp.dataset.price), pv = prev[key];
        const c = w.querySelector(`[data-cups="${key}"]`), y = w.querySelector(`[data-yen="${key}"]`);
        if (inp.value === '' || !pv) { c.textContent = ''; y.textContent = ''; return; }
        const d = Number(inp.value) - pv.count;
        if (d < 0) { c.innerHTML = '<span class="ng" style="font-weight:700">前回より小さい</span>'; y.textContent = ''; return; }
        c.innerHTML = `<b>${d}</b> 杯`; y.textContent = yen(d * price) + ' 円';
        cups += d; sum += d * price;
      });
      const tc = w.querySelector('.mc-total-cups'), ty = w.querySelector('.mc-total-yen');
      if (tc) tc.textContent = cups;
      if (ty) ty.textContent = yen(sum);
      // 売上報告: 全部の金種が入って、前回より小さい数字が無いときだけ出す(途中の数字を報告してしまわないように)
      if (w.querySelector('.mc-report')) {
        const inputs = [...w.querySelectorAll('.mc-input')];
        const ok = inputs.every(i => i.value !== '' && prev[i.dataset.key] && Number(i.value) >= prev[i.dataset.key].count);
        const set = (c, v) => { const e = w.querySelector(c); if (e) e.textContent = ok ? v : '—'; };
        set('.mc-rep-total', yen(sum)); set('.mc-rep-ex', yen(exTax(sum))); set('.mc-rep-tax', yen(sum - exTax(sum))); set('.mc-rep-cust', String(cups));
      }
    },
    _saving: false,
    async save() {
      if (this._saving) return;
      const w = this.s.wrap, sid = this.s.storeId, date = this.s.date;
      const msg = w.querySelector('.mc-save-msg'), prev = this.previousOf(this.s.readings, date);
      const inputs = [...w.querySelectorAll('.mc-input')];
      const values = inputs.filter(i => i.value !== '').map(i => ({ machine: Number(i.dataset.machine), slot: Number(i.dataset.slot), price: Number(i.dataset.price), count: Number(i.value) }));
      if (!values.length) { msg.innerHTML = '<span class="ng">数字が入っていません</span>'; return; }
      if (values.length < inputs.length && !confirm('空欄の金種があります。入っている分だけ保存しますか？')) return;
      const k = v => v.machine + '_' + v.slot;
      const smaller = values.filter(v => prev[k(v)] && v.count < prev[k(v)].count);
      if (smaller.length && !confirm(`前回より小さい数字があります（${smaller.map(v => v.price + '円').join('・')}）。\n読み間違いでないか確かめてください。このまま保存しますか？`)) return;
      const big = values.filter(v => prev[k(v)] && v.count - prev[k(v)].count > 500);
      if (big.length && !confirm(`前回から500杯より多く増えている金種があります（${big.map(v => v.price + '円').join('・')}）。\n読み間違いでないか確かめてください。このまま保存しますか？`)) return;
      this._saving = true;
      const btn = w.querySelector('.mc-save');
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        const res = await this.o.post('saveMeterReading', { storeId: sid, date, values, note: (w.querySelector('.mc-note-input').value || '').trim() });
        if (!res || res.error) throw new Error((res && res.error) || '保存できませんでした');
        await this.loadReadings(sid, true);
        delete this.s.draft[date];
        await this.mountSheet(w, sid);
        const m2 = w.querySelector('.mc-save-msg'); if (m2) m2.innerHTML = '<span class="ok">保存しました</span>';
      } catch (e) {
        msg.innerHTML = `<span class="ng">保存できませんでした（${esc(e.message)}）。もう一度お試しください</span>`;
        btn.disabled = false; btn.textContent = '保存する';
      } finally { this._saving = false; }
    },

    /* ----- 管理者 ----- */
    mountAdmin(wrap) {
      wrap.classList.add('mc-root');
      this.s.adminWrap = wrap;
      const tabs = `<div class="mc-tabs">
        <button class="${this.s.adminTab === 'sheet' ? 'on' : ''}" onclick="MeterCore.s.adminTab='sheet';MeterCore.mountAdmin(MeterCore.s.adminWrap)">店ごとの集計表</button>
        <button class="${this.s.adminTab === 'config' ? 'on' : ''}" onclick="MeterCore.s.adminTab='config';MeterCore.mountAdmin(MeterCore.s.adminWrap)">使う店の設定</button></div>`;
      if (this.s.adminTab === 'config') { wrap.innerHTML = tabs + '<div class="mc-cfg"></div>'; return this.renderConfig(wrap.querySelector('.mc-cfg')); }
      const names = this.o.names(), linked = this.linkedStores();
      if (!linked.length) { wrap.innerHTML = tabs + '<div class="mc-card">集計表を使う店がまだありません。「使う店の設定」でチェックを入れてください。</div>'; return; }
      const sid = linked.includes(this.s.adminStore) ? this.s.adminStore : linked[0];
      this.s.adminStore = sid;
      wrap.innerHTML = tabs + `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <select onchange="MeterCore.s.adminStore=this.value;MeterCore.mountAdmin(MeterCore.s.adminWrap)">${linked.map(s => `<option value="${esc(s)}" ${s === sid ? 'selected' : ''}>${esc(names[s] || s)}</option>`).join('')}</select>
          <button class="mc-btn sub small" onclick="MeterCore.s.readings=null;MeterCore.mountAdmin(MeterCore.s.adminWrap)">再読み込み</button>
        </div><div class="mc-sheet"></div>`;
      return this.mountSheet(wrap.querySelector('.mc-sheet'), sid);
    },
    renderConfig(wrap) {
      const names = this.o.names(), q = (this.s.filter || '').trim();
      const ids = Object.keys(names).filter(s => !q || String(names[s]).includes(q) || s.includes(q))
        .sort((a, b) => (this.configOf(b) ? 1 : 0) - (this.configOf(a) ? 1 : 0) || String(names[a]).localeCompare(String(names[b]), 'ja'));
      wrap.innerHTML = `<div class="mc-card">
        <div class="mc-note">集計表を使う店にチェックを入れ、ドリンクマシンごとに「機械の名前」と「金種（売価）」を入れて保存してください。金種はマシンの表示と同じ並びで、カンマ区切りです（例: 520,500,470,440,420,390）。チェックを外して保存すると、その店では集計表が出なくなります（これまでの記録は消えません）。</div>
        <input type="text" placeholder="店名で絞り込む" value="${esc(q)}" oninput="MeterCore.s.filter=this.value;MeterCore.renderConfig(this.closest('.mc-cfg'));const i=document.querySelector('.mc-cfg input[type=text]');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}" style="width:100%;max-width:320px;margin-bottom:8px">
        <div>${ids.map(s => {
          const c = this.configOf(s), on = !!c, ms = c ? c.machines : [{ label: 'ドリンクマシン', prices: [] }];
          return `<div class="mc-store" data-sid="${esc(s)}">
            <label><input type="checkbox" ${on ? 'checked' : ''} onchange="this.closest('.mc-store').querySelector('.mc-machines').style.display=this.checked?'':'none'">${esc(names[s] || s)}</label>
            <div class="mc-machines" style="${on ? '' : 'display:none'}">
              <div class="mc-mlist">${ms.map(m => this.machineLine(m)).join('')}</div>
              <button class="mc-btn sub small" onclick="this.previousElementSibling.insertAdjacentHTML('beforeend', MeterCore.machineLine({label:'', prices:[]}))">＋ 機械を足す</button>
              <label style="min-width:0;font-weight:400;font-size:13px;margin-top:6px"><input type="checkbox" class="mc-salesreport" ${c && c.salesReport ? 'checked' : ''}>売上報告（総売上・税抜・消費税・客数）を出す</label>
              <div style="font-size:12px;color:#64748b;margin-top:4px">報告サイトのログイン情報（その店の画面にだけ「タップで表示」で出ます）</div>
              <textarea class="mc-reportinfo" data-sid="${esc(s)}" rows="3" placeholder="読み込み中…" disabled style="width:100%;font-family:inherit;font-size:13px;border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px"></textarea>
            </div>
            <div style="display:flex;gap:6px;align-items:center"><button class="mc-btn" style="padding:6px 14px" onclick="MeterCore.saveConfig('${esc(s)}', this)">保存</button><span class="mc-msg"></span></div>
          </div>`;
        }).join('')}</div></div>`;
      this.fillReportInfo(wrap);
    },
    // 管理者: 売上報告サイトのログイン情報を店ごとに読んで欄に入れる(設定の読み込みには入っていないので getMeterReportInfo で)。
    // 集計表を使う店だけ読む(使っていない店は空欄のまま入力できる)
    async fillReportInfo(wrap) {
      const ph = '例: ID ○○ ／ パスワード ○○ ／ サイトのURL';
      for (const ta of wrap.querySelectorAll('.mc-reportinfo')) {
        const sid = ta.dataset.sid;
        if (!this.configOf(sid)) { ta.disabled = false; ta.placeholder = ph; ta.dataset.orig = ''; continue; }
        try {
          const res = await this.o.get('getMeterReportInfo', { storeId: sid });
          if (!res || res.error) throw new Error((res && res.error) || '');
          ta.value = (res.info && res.info.text) || '';
          ta.dataset.orig = ta.value;
          ta.placeholder = ph;
          ta.disabled = false;
        } catch (e) { ta.placeholder = '読み込めませんでした（ここでは変更できません）'; }
      }
    },
    machineLine(m) {
      return `<div class="mc-mline"><input type="text" class="mc-label" placeholder="機械の名前（例: 左・CS3）" value="${esc(m.label || '')}" style="width:170px">
        <input type="text" class="mc-prices" placeholder="金種（例: 520,500,470）" value="${esc((m.prices || []).join(','))}" style="flex:1;min-width:180px">
        <button class="mc-btn sub small" onclick="this.parentElement.remove()">削除</button></div>`;
    },
    async saveConfig(sid, btn) {
      const row = btn.closest('.mc-store'), msg = row.querySelector('.mc-msg');
      const on = row.querySelector('input[type=checkbox]').checked;
      let value = null;
      if (on) {
        const machines = [...row.querySelectorAll('.mc-mline')].map(l => ({
          label: l.querySelector('.mc-label').value.trim(),
          prices: l.querySelector('.mc-prices').value.split(/[,、\s]+/).map(x => x.trim()).filter(Boolean).map(Number),
        })).filter(m => m.label || m.prices.length);
        if (!machines.length || machines.some(m => !m.prices.length || m.prices.some(p => !(p > 0)))) { msg.innerHTML = '<span class="ng">機械ごとに金種（数字・カンマ区切り）を入れてください</span>'; return; }
        machines.forEach((m, i) => { if (!m.label) m.label = machines.length === 1 ? 'ドリンクマシン' : '機械' + (i + 1); });
        const old = this.configOf(sid);
        if (old && JSON.stringify(old.machines.map(m => m.prices)) !== JSON.stringify(machines.map(m => m.prices))
            && !confirm('金種の並びを変えると、これまでの記録とボタンの対応がずれることがあります（記録は「何台目の何番目のボタン」で持っています）。このまま保存しますか？')) return;
        value = { machines };
        if (row.querySelector('.mc-salesreport').checked) value.salesReport = true;
      }
      btn.disabled = true; msg.textContent = '保存中…';
      try {
        const res = await this.o.post('saveSettingMerge', { key: 'meter_config', value: JSON.stringify({ [sid]: value }) });
        if (!res || res.error) throw new Error((res && res.error) || '保存できませんでした');
        const ta = row.querySelector('.mc-reportinfo');
        if (ta && !ta.disabled && ta.value.trim() !== (ta.dataset.orig || '')) {
          const text = ta.value.trim();
          const r2 = await this.o.post('saveSettingMerge', { key: 'meter_report_info', value: JSON.stringify({ [sid]: text ? { text } : null }) });
          if (!r2 || r2.error) throw new Error('ログイン情報を保存できませんでした: ' + ((r2 && r2.error) || ''));
          ta.dataset.orig = text;
          if (this.s.reportInfo && this.s.reportInfo.sid === sid) this.s.reportInfo = null;
        }
        const all = Object.assign({}, this.o.configAll() || {}); all[sid] = value;
        this.o.onConfigSaved(all);
        msg.innerHTML = '<span class="ok">保存しました</span>';
      } catch (e) { msg.innerHTML = `<span class="ng">${esc(e.message)}</span>`; }
      finally { btn.disabled = false; }
    },
  };
  window.MeterCore = M;
})();
