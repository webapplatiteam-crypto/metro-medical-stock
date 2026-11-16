// แดชบอร์ดแจ้งเตือนวันหมดอายุ
import { sb, state, can, esc, opt, n0, n2, dTH, expiryBadge, $, pageHead, go, downloadXlsx, today, fetchAll } from '../core.js';

const B = [
  ['all', 'ทั้งหมด ≤ 180 วัน', ''], ['expired', 'หมดอายุแล้ว', 'bad'], ['d30', '≤ 30 วัน', 'warn'], ['d90', '31 – 90 วัน', 'amber'], ['d180', '91 – 180 วัน', 'info'],
];
const bucket = (d) => (d < 0 ? 'expired' : d <= 30 ? 'd30' : d <= 90 ? 'd90' : d <= 180 ? 'd180' : 'later');
const ACTION = { expired: 'ย้ายเข้ากักกัน แล้วตัดทำลาย / คืนซัพพลายเออร์', d30: 'เร่งจ่าย / แจ้งฝ่ายขาย', d90: 'จ่ายก่อน (FEFO) / ติดต่อซัพพลายเออร์', d180: 'เฝ้าระวัง' };

export async function render(main, { query }) {
  const lots = (await fetchAll(() => sb.from('v_lot_stock').select('*').gt('qty', 0))).filter((l) => l.expiry_date);
  const undated = await fetchAll(() => sb.from('v_lot_stock').select('lot_id').gt('qty', 0).is('expiry_date', null));
  const f = { b: query.get('b') || 'all', wh: '' };
  const showCost = can.seeCost();
  const inRange = lots.filter((l) => l.days_left <= 180);
  const sum = (arr) => ({ n: arr.length, q: arr.reduce((s, l) => s + Number(l.qty), 0), v: arr.reduce((s, l) => s + Number(l.value), 0) });

  // มูลค่าตามเดือน 6 เดือนข้างหน้า
  const months = []; const now = new Date();
  for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][d.getMonth()]} ${String(d.getFullYear() + 543).slice(2)}`, v: 0 }); }
  const expiredV = lots.filter((l) => l.days_left < 0).reduce((s, l) => s + Number(showCost ? l.value : l.qty), 0);
  for (const l of lots) { const m = months.find((x) => x.key === l.expiry_date.slice(0, 7)); if (m && l.days_left >= 0) m.v += Number(showCost ? l.value : l.qty); }
  const max = Math.max(expiredV, ...months.map((m) => m.v), 1);

  main.innerHTML = `${pageHead('แจ้งเตือนวันหมดอายุ', `ข้อมูล ณ ${dTH(today())} · ระบบตรวจทุกครั้งที่เปิดหน้า`,
    `<label class="f" style="min-width:200px">คลัง<select class="i" data-wh>${opt('', 'ทุกคลัง')}${state.warehouses.map((w) => opt(w.id, w.name)).join('')}</select></label><button class="b2" data-xls style="align-self:end">ส่งออก Excel</button>${can.admin() ? '<a class="b1" href="#/settings/alerts" style="align-self:end">ตั้งค่าการแจ้งเตือน</a>' : ''}`)}
    <section class="grid g5" data-tiles></section>
    ${undated.length ? `<div class="alert info"><b>${undated.length} Lot ยังไม่ระบุวันหมดอายุ</b> (เช่น ยอดยกมาจาก Excel) — ไม่ถูกนับในหน้านี้ ตรวจนับแล้วระบุ Lot/วันหมดอายุจริง</div>` : ''}
    <section class="card"><div class="row between"><h2>${showCost ? 'มูลค่า' : 'จำนวน'}ที่จะหมดอายุ รายเดือน</h2><span class="sub">${showCost ? 'บาท (ราคาทุน)' : 'หน่วย'}</span></div>
      <div role="img" aria-label="กราฟมูลค่าที่จะหมดอายุแต่ละเดือน" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:12px;align-items:end;height:200px;border-bottom:1px solid #C9D6EA">
        ${[{ label: 'หมดแล้ว', v: expiredV, c: '#A51D1D' }, ...months.map((m, i) => ({ ...m, c: i === 0 ? '#C2410C' : i < 3 ? '#D9A23A' : '#1A63D6' }))].map((m) => `<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%"><span style="font-size:12px;font-weight:600">${n0(Math.round(m.v))}</span><div style="width:70%;height:${Math.max(2, Math.round(m.v / max * 160))}px;background:${m.v ? m.c : '#C9D6EA'};border-radius:4px 4px 0 0"></div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:12px;text-align:center;font-size:13px;color:var(--muted)"><span style="color:#A51D1D;font-weight:600">หมดแล้ว</span>${months.map((m) => `<span>${m.label}</span>`).join('')}</div>
    </section>
    <section class="card"><div class="row between"><h2 data-title></h2><span class="sub">เรียงตามวันหมดอายุ</span></div>
      <div class="tw"><table class="t"><thead><tr><th>สินค้า</th><th>Lot / Serial</th><th>วันหมดอายุ</th><th>เหลือ</th><th>คลัง</th><th>ตำแหน่ง</th><th class="num">คงเหลือ</th>${showCost ? '<th class="num">มูลค่า</th>' : ''}<th>ควรทำ</th></tr></thead><tbody data-b></tbody></table></div></section>`;

  const view = () => inRange.filter((l) => !f.wh || l.warehouse_id === f.wh);
  function draw() {
    const base = view();
    $('[data-tiles]', main).innerHTML = B.map(([k, label, cls]) => { const s = sum(k === 'all' ? base : base.filter((l) => bucket(l.days_left) === k));
      return `<button type="button" class="card kpi ${cls} ${f.b === k ? 'sel' : ''}" data-b="${k}"><span class="sub" style="font-weight:600">${label}</span><span class="v">${s.n} Lot</span><span class="sub">${n0(s.q)} หน่วย${showCost ? ' · ฿' + n0(s.v) : ''}</span></button>`; }).join('');
    const rows = base.filter((l) => f.b === 'all' || bucket(l.days_left) === f.b);
    $('[data-title]', main).textContent = `รายการ Lot ที่ต้องเฝ้าระวัง · ${B.find((b) => b[0] === f.b)[1]} (${rows.length})`;
    $('[data-b]', main).innerHTML = rows.map((l) => `<tr class="click" data-p="${l.product_id}"><td><b>${esc(l.name)}</b><div class="sub mono">${esc(l.code)}</div></td><td>${esc(l.lot_no)}</td><td>${dTH(l.expiry_date)}</td><td>${expiryBadge(l.expiry_date)}</td><td>${esc(l.warehouse_name)}</td><td>${esc(l.location || '')}</td><td class="num">${n0(l.qty)}</td>${showCost ? `<td class="num">${n2(l.value)}</td>` : ''}<td>${ACTION[bucket(l.days_left)] || ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">ไม่มีรายการ</td></tr>';
  }
  main.addEventListener('click', (e) => {
    const t = e.target.closest('[data-b]'); if (t && t.tagName === 'BUTTON') { f.b = t.dataset.b; draw(); return; }
    const r = e.target.closest('tr[data-p]'); if (r) go('#/ledger/' + r.dataset.p);
  });
  $('[data-wh]', main).onchange = (e) => { f.wh = e.target.value; draw(); };
  $('[data-xls]', main).onclick = () => downloadXlsx(`วันหมดอายุ_${today()}.xlsx`, [{ name: 'วันหมดอายุ', cols: [12, 44, 14, 12, 10, 16, 10, 10, 12, 30],
    rows: [['รหัส', 'สินค้า', 'Lot', 'วันหมดอายุ', 'เหลือ (วัน)', 'คลัง', 'ตำแหน่ง', 'คงเหลือ', ...(showCost ? ['มูลค่า'] : []), 'ควรทำ'],
      ...view().map((l) => [l.code, l.name, l.lot_no, dTH(l.expiry_date), l.days_left, l.warehouse_name, l.location || '', Number(l.qty), ...(showCost ? [Number(l.value)] : []), ACTION[bucket(l.days_left)] || ''])] }]);
  draw();
}
