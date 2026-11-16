// รายงาน / ส่งออก Excel
import { sb, q, state, can, DOC, esc, n0, n2, dTH, dtTH, today, addDays, toast, errMsg, $, pageHead, downloadXlsx, fetchAll } from '../core.js';
import { describe, stockCardSheet } from '../stockcard.js';

const cost = () => can.seeCost();
const movsUntil = (to) => fetchAll(() => sb.from('v_movements').select('*').lte('doc_date', to).order('doc_date').order('id'));
const prods = () => fetchAll(() => sb.from('products').select('*').order('code'));

const REPORTS = [
  { k: 'summary', t: 'สรุปรายการสินค้าใน Stock', tag: 'ใช้บ่อย', d: 'ยกมา / รับ / เบิก / คงเหลือ ทุกสินค้า ในช่วงวันที่ — รูปแบบเดียวกับชีต "สรุป" เดิม', range: true,
    async run({ from, to }) {
      const [ps, ms] = await Promise.all([prods(), movsUntil(to)]);
      const rows = ps.map((p, i) => {
        const m = ms.filter((x) => x.product_id === p.id);
        const open = m.filter((x) => x.doc_date < from).reduce((s, x) => s + Number(x.qty), 0);
        const inR = m.filter((x) => x.doc_date >= from && x.qty > 0 && x.doc_type !== 'TRF').reduce((s, x) => s + Number(x.qty), 0);
        const outR = m.filter((x) => x.doc_date >= from && x.qty < 0 && x.doc_type !== 'TRF').reduce((s, x) => s - Number(x.qty), 0);
        const bal = open + inR - outR; const c = Number(p.cost);
        return cost() ? [i + 1, p.name, p.unit, p.code, open, inR, c, inR * c, outR, c, outR * c, bal, c, bal * c] : [i + 1, p.name, p.unit, p.code, open, inR, outR, bal];
      });
      const head = cost() ? ['ลำดับ', 'ชื่อเครื่องมือและอุปกรณ์', 'หน่วย', 'รหัส', 'ยกมา', 'รับ (หน่วย)', 'ราคา/หน่วย', 'จำนวนเงิน', 'เบิก (หน่วย)', 'ราคา/หน่วย', 'จำนวนเงิน', 'คงเหลือ (หน่วย)', 'ราคา/หน่วย', 'จำนวนเงิน']
        : ['ลำดับ', 'ชื่อเครื่องมือและอุปกรณ์', 'หน่วย', 'รหัส', 'ยกมา', 'รับ', 'เบิก', 'คงเหลือ'];
      const total = cost() ? ['', 'รวม', '', '', '', '', '', sumCol(rows, 7), '', '', sumCol(rows, 10), '', '', sumCol(rows, 13)] : null;
      return { head, rows, total, top: [[state.settings?.name || ''], ['สรุปรายการสินค้าใน Stock'], [`วันที่ ${dTH(from)} ถึง ${dTH(to)}`], []] };
    } },
  { k: 'stockcards', t: 'ทะเบียนคุมเครื่องมือเครื่องใช้ (ทุกสินค้า)', tag: 'แบบ อย.', d: 'ไฟล์ Excel 1 ชีตต่อ 1 สินค้า มี ว.ด.ป. เลขที่เอกสาร รับ จ่าย คงเหลือ Lot วันหมดอายุ', range: false,
    async run({ to }) {
      const [ps, ms] = await Promise.all([prods(), movsUntil(to)]);
      const sheets = ps.filter((p) => ms.some((m) => m.product_id === p.id)).map((p) => stockCardSheet(p, ms.filter((m) => m.product_id === p.id), state.settings));
      return { sheets, head: ['รหัส', 'สินค้า', 'จำนวนรายการเคลื่อนไหว'], rows: sheets.map((s) => [s.name, ps.find((p) => p.code === s.name)?.name, s.rows.length - 6]) };
    } },
  { k: 'movements', t: 'ความเคลื่อนไหวสินค้า', tag: '', d: 'ทุกรายการรับ-จ่าย-ปรับยอด-โอน ในช่วงวันที่', range: true,
    async run({ from, to }) {
      const ms = await fetchAll(() => sb.from('v_movements').select('*').gte('doc_date', from).lte('doc_date', to).order('doc_date').order('id'));
      return { head: ['วันที่', 'เลขที่', 'ประเภท', 'รายการ', 'รหัส', 'สินค้า', 'Lot', 'วันหมดอายุ', 'คลัง', 'จำนวน', ...(cost() ? ['ราคา/หน่วย', 'จำนวนเงิน'] : []), 'ผู้ทำ'],
        rows: ms.map((m) => [dTH(m.doc_date), m.doc_no, DOC[m.doc_type].label, describe(m), m.code, m.name, m.lot_no, m.expiry_date ? dTH(m.expiry_date) : '', m.warehouse_name, Number(m.qty), ...(cost() ? [Number(m.unit_cost), Number(m.amount)] : []), m.created_by_name || '']) };
    } },
  { k: 'valuation', t: 'มูลค่าสต็อก ณ วันที่', tag: 'บัญชี', d: 'คงเหลือและมูลค่าแยกสินค้า กลุ่ม และคลัง สำหรับปิดงบ', range: false, needCost: true,
    async run({ to }) {
      const [ps, ms] = await Promise.all([prods(), movsUntil(to)]);
      const rows = [];
      for (const p of ps) for (const w of state.warehouses) {
        const q2 = ms.filter((m) => m.product_id === p.id && m.warehouse_id === w.id).reduce((s, m) => s + Number(m.qty), 0);
        if (q2) rows.push([p.code, p.name, p.grp || '', w.name, q2, Number(p.cost), q2 * Number(p.cost)]);
      }
      return { head: ['รหัส', 'สินค้า', 'กลุ่ม', 'คลัง', 'คงเหลือ', 'ราคาทุน', 'มูลค่า'], rows, total: ['', 'รวม', '', '', sumCol(rows, 4), '', sumCol(rows, 6)], top: [[`มูลค่าสต็อก ณ ${dTH(to)}`], []] };
    } },
  { k: 'expiry', t: 'วันหมดอายุ', tag: '', d: 'Lot ที่หมดอายุแล้วและจะหมดอายุภายในจำนวนวันที่เลือก', range: false, days: true,
    async run({ days }) {
      const rows = (await fetchAll(() => sb.from('v_lot_stock').select('*').gt('qty', 0).lte('days_left', days).order('expiry_date')));
      return { head: ['รหัส', 'สินค้า', 'Lot', 'วันหมดอายุ', 'เหลือ (วัน)', 'คลัง', 'คงเหลือ', ...(cost() ? ['มูลค่า'] : [])],
        rows: rows.map((l) => [l.code, l.name, l.lot_no, dTH(l.expiry_date), l.days_left, l.warehouse_name, Number(l.qty), ...(cost() ? [Number(l.value)] : [])]) };
    } },
  { k: 'bycustomer', t: 'ยอดจ่ายตามโรงพยาบาล / ลูกค้า', tag: 'ฝ่ายขาย', d: 'จำนวนและมูลค่าที่จ่ายออก แยกลูกค้าและสินค้า', range: true,
    async run({ from, to }) {
      const ms = (await fetchAll(() => sb.from('v_movements').select('*').eq('doc_type', 'OUT').eq('doc_status', 'posted').gte('doc_date', from).lte('doc_date', to)));
      const map = new Map();
      for (const m of ms) { const k = (m.partner_name || 'ไม่ระบุลูกค้า') + '|' + m.code; const r = map.get(k) || { c: m.partner_name || 'ไม่ระบุลูกค้า', code: m.code, name: m.name, q: 0, v: 0 }; r.q -= Number(m.qty); r.v -= Number(m.amount); map.set(k, r); }
      const rows = [...map.values()].sort((a, b) => a.c.localeCompare(b.c) || a.code.localeCompare(b.code)).map((r) => [r.c, r.code, r.name, r.q, ...(cost() ? [r.v] : [])]);
      return { head: ['ลูกค้า', 'รหัส', 'สินค้า', 'จำนวนที่จ่าย', ...(cost() ? ['มูลค่า (ทุน)'] : [])], rows };
    } },
  { k: 'slow', t: 'สินค้าเคลื่อนไหวช้า', tag: '', d: 'สินค้าที่มีของแต่ไม่มีการจ่ายออกเกินจำนวนวันที่เลือก', range: false, days: true,
    async run({ days }) {
      const [ps, outs] = await Promise.all([fetchAll(() => sb.from('v_product_stock').select('*').gt('qty', 0)), fetchAll(() => sb.from('v_movements').select('product_id, doc_date').eq('doc_type', 'OUT').eq('doc_status', 'posted'))]);
      const since = addDays(today(), -days);
      const rows = ps.map((p) => { const last = outs.filter((o) => o.product_id === p.id).map((o) => o.doc_date).sort().pop(); return { p, last }; })
        .filter((x) => !x.last || x.last < since).map(({ p, last }) => [p.code, p.name, Number(p.qty), ...(cost() ? [Number(p.value)] : []), last ? dTH(last) : 'ยังไม่เคยจ่าย']);
      return { head: ['รหัส', 'สินค้า', 'คงเหลือ', ...(cost() ? ['มูลค่า'] : []), 'จ่ายครั้งล่าสุด'], rows };
    } },
  { k: 'counts', t: 'ผลตรวจนับและปรับยอด', tag: '', d: 'ผลต่างแต่ละรอบ เหตุผล และผู้อนุมัติ', range: true,
    async run({ from, to }) {
      const docs = await q(sb.from('documents').select('doc_no, doc_type, doc_date, status, approver:profiles!documents_approved_by_fkey(full_name), document_lines(qty, system_qty, reason, lot_no, product:products(code,name,cost))').in('doc_type', ['CNT', 'ADJ', 'DSP']).gte('doc_date', from).lte('doc_date', to).order('doc_date'));
      const rows = docs.flatMap((d) => d.document_lines.map((l) => { const diff = d.doc_type === 'CNT' ? (l.system_qty == null ? null : Number(l.qty) - Number(l.system_qty)) : (d.doc_type === 'DSP' ? -Number(l.qty) : Number(l.qty));
        return [dTH(d.doc_date), d.doc_no, DOC[d.doc_type].label, l.product.code, l.product.name, l.lot_no, d.doc_type === 'CNT' ? l.system_qty : '', d.doc_type === 'CNT' ? Number(l.qty) : '', diff ?? '', ...(cost() ? [diff == null ? '' : diff * Number(l.product.cost)] : []), l.reason || '', d.approver?.full_name || '', { draft: 'ร่าง', pending: 'รออนุมัติ', posted: 'ยืนยันแล้ว', cancelled: 'ยกเลิก' }[d.status]]; }));
      return { head: ['วันที่', 'เลขที่', 'ประเภท', 'รหัส', 'สินค้า', 'Lot', 'ยอดระบบ', 'นับได้', 'ผลต่าง', ...(cost() ? ['มูลค่าต่าง'] : []), 'เหตุผล', 'ผู้อนุมัติ', 'สถานะ'], rows };
    } },
  { k: 'audit', t: 'ประวัติการใช้งาน (Audit log)', tag: 'ผู้ดูแล', d: 'ใครทำอะไร เมื่อไร — ตรวจสอบย้อนหลัง', range: true, manager: true,
    async run({ from, to }) {
      const [logs, users] = await Promise.all([q(sb.from('audit_log').select('*').gte('at', from).lte('at', to + 'T23:59:59').order('at', { ascending: false }).limit(5000)), q(sb.from('profiles').select('id, full_name, email'))]);
      const name = (id) => { const u = users.find((x) => x.id === id); return u ? (u.full_name || u.email) : (id ? id.slice(0, 8) : 'ระบบ'); };
      const summary = (l) => l.detail?.doc_no ? `${l.detail.doc_no}${l.detail.reason ? ' — ' + l.detail.reason : ''}${l.detail.reasons ? ' — ' + l.detail.reasons.join('; ') : ''}` : (l.detail?.after?.code || l.detail?.code || l.detail?.after?.name || l.detail?.after?.email || '');
      return { head: ['เวลา', 'ผู้ใช้', 'การกระทำ', 'ตาราง', 'รายละเอียด'], rows: logs.map((l) => [dtTH(l.at), name(l.user_id), l.action, l.table_name, summary(l)]) };
    } },
];
const sumCol = (rows, i) => rows.reduce((s, r) => s + Number(r[i] || 0), 0);

export async function render(main) {
  const list = REPORTS.filter((r) => (!r.needCost || cost()) && (!r.manager || can.manage()));
  const p = { from: today().slice(0, 8) + '01', to: today(), days: 90 };
  let cur = list[0]; let result = null;

  main.innerHTML = `${pageHead('รายงาน / ส่งออก', 'เลือกรายงาน กำหนดช่วง แล้วดูหรือดาวน์โหลด Excel', '')}
    <section class="grid g3 noprint" data-cards>${list.map((r) => `<button type="button" class="card kpi" data-k="${r.k}" style="text-align:left;min-height:150px"><span class="row between" style="width:100%"><b style="font-size:16px">${r.t}</b>${r.tag ? `<span class="bd bl">${r.tag}</span>` : ''}</span><span class="sub">${r.d}</span></button>`).join('')}</section>
    <section class="card"><div class="row between noprint"><h2 data-title></h2>
      <div class="row" data-params></div></div>
      <div class="printonly"><h2 data-ptitle></h2></div>
      <div data-out><div class="empty">เลือกรายงานแล้วกด "แสดงรายงาน"</div></div></section>`;

  function drawParams() {
    $('[data-title]', main).textContent = cur.t; $('[data-ptitle]', main).textContent = `${state.settings?.name || ''} — ${cur.t}`;
    main.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('sel', b.dataset.k === cur.k));
    $('[data-params]', main).innerHTML = `${cur.range ? `<label class="f">ตั้งแต่<input class="i" type="date" data-pp="from" value="${p.from}"></label>` : ''}
      ${cur.days ? `<label class="f">ภายใน (วัน)<input class="i" type="number" min="1" data-pp="days" value="${p.days}" style="width:110px"></label>` : `<label class="f">${cur.range ? 'ถึง' : 'ณ วันที่'}<input class="i" type="date" data-pp="to" value="${p.to}"></label>`}
      <button class="b1" data-run style="align-self:end">แสดงรายงาน</button><button class="b2" data-xls style="align-self:end" disabled>Excel</button><button class="b2" data-print style="align-self:end" disabled>พิมพ์</button>`;
    main.querySelectorAll('[data-pp]').forEach((el) => el.onchange = () => { p[el.dataset.pp] = el.dataset.pp === 'days' ? Number(el.value) : el.value; });
    $('[data-run]', main).onclick = run;
    $('[data-xls]', main).onclick = xls;
    $('[data-print]', main).onclick = () => window.print();
  }
  async function run() {
    const out = $('[data-out]', main); out.innerHTML = '<div class="empty">กำลังประมวลผล…</div>';
    try {
      result = await cur.run(p);
      const numCols = new Set(result.head.map((_, i) => i).filter((i) => result.rows.some((r) => typeof r[i] === 'number')));
      const cell = (v, i) => `<td class="${numCols.has(i) ? 'num' : ''}">${typeof v === 'number' ? (Number.isInteger(v) ? n0(v) : n2(v)) : esc(v ?? '')}</td>`;
      out.innerHTML = `<div class="tw"><table class="t"><thead><tr>${result.head.map((h, i) => `<th class="${numCols.has(i) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${result.rows.slice(0, 1000).map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('') || `<tr><td colspan="${result.head.length}" class="empty">ไม่มีข้อมูล</td></tr>`}</tbody>
        ${result.total ? `<tfoot><tr>${result.total.map(cell).join('')}</tr></tfoot>` : ''}</table></div>
        <span class="sub">${result.rows.length} แถว${result.rows.length > 1000 ? ' (แสดง 1,000 แถวแรก — ดาวน์โหลด Excel เพื่อดูทั้งหมด)' : ''}</span>`;
      $('[data-xls]', main).disabled = false; $('[data-print]', main).disabled = false;
    } catch (e) { out.innerHTML = `<div class="alert bad">${esc(errMsg(e))}</div>`; }
  }
  async function xls() {
    if (!result) return;
    const name = `${cur.t}_${p.to || today()}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
    if (result.sheets) {
      if (!result.sheets.length) return toast('ไม่มีข้อมูล', 'err');
      await downloadXlsx(name, [{ name: 'สารบัญ', rows: [[cur.t], [state.settings?.name || ''], [], result.head, ...result.rows], cols: [14, 50, 12] }, ...result.sheets]);
    } else {
      await downloadXlsx(name, [{ name: cur.t, rows: [...(result.top || []), result.head, ...result.rows, ...(result.total ? [result.total] : [])], cols: result.head.map((h) => Math.max(10, Math.min(48, h.length + 6))) }]);
    }
  }
  $('[data-cards]', main).addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; cur = list.find((r) => r.k === b.dataset.k); result = null; $('[data-out]', main).innerHTML = '<div class="empty">กด "แสดงรายงาน"</div>'; drawParams(); });
  drawParams();
}
