// รายการสินค้าทั้งหมด
import { sb, can, TRACK, esc, opt, n0, n2, dTH, expiryBadge, $, pageHead, go, debounce, downloadXlsx, today, fetchAll } from '../core.js';
import { scanBoxHtml, bindScanInput, openCamera, lookupProduct, beep } from '../scan.js';

export async function render(main) {
  const all = await fetchAll(() => sb.from('v_product_stock').select('*').order('code'));
  const groups = [...new Set(all.map((p) => p.grp).filter(Boolean))].sort();
  const f = { st: 'all', grp: '', term: '', inactive: false };
  const status = (p) => {
    if (!p.active) return ['inactive', 'ปิดใช้งาน', 'n'];
    if (p.note && /#REF/.test(p.note)) return ['check', 'ตรวจสอบ', 'y'];
    if (Number(p.qty) <= 0) return ['out', 'หมด', 'r'];
    if (Number(p.qty) <= Number(p.min_qty)) return ['low', 'ใกล้หมด', 'o'];
    return ['ok', 'มีสินค้า', 'g'];
  };
  const showCost = can.seeCost();

  main.innerHTML = `${pageHead('สินค้าทั้งหมด', `${all.filter((p) => p.active).length} รายการที่ใช้งาน${showCost ? ' · มูลค่ารวม ฿' + n0(all.reduce((s, p) => s + Number(p.value), 0)) : ''}`,
    `<button class="b2" data-xls>ส่งออก Excel</button>${can.manage() ? '<a class="b2" href="#/settings/import">นำเข้าจาก Excel</a><a class="b1" href="#/product/new">+ เพิ่มสินค้า</a>' : ''}`)}
    ${scanBoxHtml('ยิงบาร์โค้ดเพื่อเปิดการ์ดสินค้า')}
    <section class="card noprint"><div class="grid g3">
      <label class="f">ค้นหา<input class="i" data-term placeholder="ชื่อ รหัส หรือ GTIN"></label>
      <label class="f">กลุ่มสินค้า<select class="i" data-grp>${opt('', 'ทุกกลุ่ม')}${groups.map((g) => opt(g, g)).join('')}</select></label>
      <label class="chk" style="align-self:end;min-height:44px"><input type="checkbox" data-inactive> แสดงสินค้าที่ปิดใช้งาน</label>
    </div><div class="tabs" data-tabs></div></section>
    <section class="card"><div class="tw"><table class="t"><thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>กลุ่ม / ขนาด</th><th>ติดตาม</th><th class="num">คงเหลือ</th>${showCost ? '<th class="num">ราคาทุน</th><th class="num">มูลค่า</th>' : ''}<th>หมดอายุเร็วสุด</th><th>สถานะ</th></tr></thead><tbody data-b></tbody></table></div></section>`;

  function draw() {
    const base = all.filter((p) => (f.inactive || p.active) && (!f.grp || p.grp === f.grp) && (!f.term || `${p.code} ${p.name} ${p.gtin || ''}`.toLowerCase().includes(f.term.toLowerCase())));
    const defs = [['all', 'ทั้งหมด'], ['ok', 'มีสินค้า'], ['low', 'ใกล้หมด'], ['out', 'หมด'], ['check', 'ต้องตรวจสอบ']];
    $('[data-tabs]', main).innerHTML = defs.map(([k, l]) => `<button class="tab ${f.st === k ? 'on' : ''}" data-st="${k}">${l} (${k === 'all' ? base.length : base.filter((p) => status(p)[0] === k).length})</button>`).join('');
    const rows = base.filter((p) => f.st === 'all' || status(p)[0] === f.st);
    $('[data-b]', main).innerHTML = rows.map((p) => { const [, sl, sc] = status(p); return `<tr class="click" data-id="${p.id}">
      <td class="mono">${esc(p.code)}</td><td><b>${esc(p.name)}</b>${p.gtin ? `<div class="sub mono">GTIN ${esc(p.gtin)}</div>` : ''}</td><td>${esc(p.grp || '')}${p.size ? `<div class="sub">${esc(p.size)}</div>` : ''}</td>
      <td><span class="bd n">${TRACK[p.tracking]}</span></td><td class="num"><b>${n0(p.qty)}</b> <span class="sub">${esc(p.unit)}</span></td>
      ${showCost ? `<td class="num">${n2(p.cost)}</td><td class="num">${n2(p.value)}</td>` : ''}
      <td>${p.next_expiry ? dTH(p.next_expiry) + '<br>' + expiryBadge(p.next_expiry) : (Number(p.qty) > 0 && p.tracking === 'lot' ? '<span class="bd y">ยังไม่ระบุ</span>' : '—')}</td>
      <td><span class="bd ${sc}">${sl}</span></td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">ไม่พบสินค้า</td></tr>';
  }
  $('[data-tabs]', main).addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) { f.st = b.dataset.st; draw(); } });
  $('[data-term]', main).addEventListener('input', debounce((e) => { f.term = e.target.value.trim(); draw(); }, 150));
  $('[data-grp]', main).onchange = (e) => { f.grp = e.target.value; draw(); };
  $('[data-inactive]', main).onchange = (e) => { f.inactive = e.target.checked; draw(); };
  $('[data-b]', main).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) go('#/ledger/' + tr.dataset.id); });
  const find = async (s) => { const p = await lookupProduct(s); if (!p) { beep(false); throw new Error('ไม่พบสินค้า: ' + (s.gtin || s.code)); } beep(true); go('#/ledger/' + p.id); };
  bindScanInput($('[data-scan]', main), find);
  $('[data-cam]', main).onclick = () => openCamera(find);
  $('[data-xls]', main).onclick = () => downloadXlsx(`สินค้า_${today()}.xlsx`, [{ name: 'สินค้า', cols: [12, 50, 14, 10, 8, 16, 10, 12, 14, 14, 12],
    rows: [['รหัส', 'ชื่อสินค้า', 'กลุ่ม', 'ขนาด', 'หน่วย', 'GTIN', 'ติดตาม', 'คงเหลือ', ...(showCost ? ['ราคาทุน', 'มูลค่า'] : []), 'หมดอายุเร็วสุด', 'สถานะ'],
      ...all.map((p) => [p.code, p.name, p.grp || '', p.size || '', p.unit, p.gtin || '', TRACK[p.tracking], Number(p.qty), ...(showCost ? [Number(p.cost), Number(p.value)] : []), p.next_expiry ? dTH(p.next_expiry) : '', status(p)[1]])] }]);
  draw();
}
