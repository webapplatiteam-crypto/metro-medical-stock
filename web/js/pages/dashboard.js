// แดชบอร์ด
import { sb, q, state, can, esc, n0, n2, dTH, dtTH, expiryBadge, statusBadge, typeBadge, pageHead, $, go, fetchAll } from '../core.js';
import { scanBoxHtml, bindScanInput, openCamera, lookupProduct, beep } from '../scan.js';

export async function render(main) {
  const [products, lots, docs] = await Promise.all([
    fetchAll(() => sb.from('v_product_stock').select('id, code, name, qty, value, min_qty, cost, active, note').eq('active', true).order('code')),
    fetchAll(() => sb.from('v_lot_stock').select('product_id, code, name, lot_no, expiry_date, days_left, qty, value, warehouse_name, warehouse_kind').gt('qty', 0)),
    q(sb.from('documents').select('id, doc_no, doc_type, status, doc_date, created_at, partner:partners(name), creator:profiles!documents_created_by_fkey(full_name)').order('created_at', { ascending: false }).limit(8)),
  ]);
  const { count: pendingCount } = can.manage() ? await sb.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'pending') : { count: 0 };

  const totalValue = products.reduce((s, p) => s + Number(p.value), 0);
  const inStock = products.filter((p) => Number(p.qty) > 0).length;
  const out = products.filter((p) => Number(p.qty) <= 0);
  const low = products.filter((p) => Number(p.qty) > 0 && Number(p.qty) <= Number(p.min_qty));
  const dated = lots.filter((l) => l.expiry_date);
  const expired = dated.filter((l) => l.days_left < 0);
  const near90 = dated.filter((l) => l.days_left >= 0 && l.days_left <= 90);
  const noExp = lots.filter((l) => !l.expiry_date && l.warehouse_kind !== 'quarantine');
  const top = [...products].sort((a, b) => b.value - a.value).slice(0, 5);
  const alerts = dated.filter((l) => l.days_left <= 180).sort((a, b) => a.days_left - b.days_left).slice(0, 8);

  main.innerHTML = `
    ${pageHead('แดชบอร์ดคลังสินค้า', `${esc(state.settings?.name || '')} · ${dTH(new Date().toISOString())}`,
      can.operate() ? '<a class="b1" href="#/receive">+ รับเข้า</a><a class="b2" href="#/issue">− จ่ายออก</a>' : '')}
    ${scanBoxHtml('ค้นหาสินค้า: ยิงบาร์โค้ด หรือพิมพ์รหัสแล้วกด Enter')}
    ${pendingCount ? `<a class="alert warn" href="#/approvals" style="text-decoration:none"><b>มี ${pendingCount} เอกสารรออนุมัติ</b> — กดเพื่อตรวจและอนุมัติ</a>` : ''}
    <section class="grid g4">
      ${can.seeCost() ? `<div class="card kpi"><span class="sub">มูลค่าสินค้าคงเหลือ</span><span class="v">฿${n0(totalValue)}</span><span class="sub">${products.length} รายการสินค้า</span></div>` : `<div class="card kpi"><span class="sub">สินค้าทั้งหมด</span><span class="v">${products.length}</span><span class="sub">รายการ</span></div>`}
      <a class="card kpi" href="#/products" style="text-decoration:none;color:inherit"><span class="sub">มีสต็อก / หมด</span><span class="v">${inStock} <span style="font-size:17px;color:var(--muted);font-weight:500">/ ${out.length} หมด</span></span><span class="sub">${low.length ? `ต่ำกว่าจุดสั่งซื้อ ${low.length} รายการ` : 'ไม่มีรายการต่ำกว่าจุดสั่งซื้อ'}</span></a>
      <a class="card kpi warn" href="#/expiry" style="text-decoration:none;color:inherit"><span class="sub">ใกล้หมดอายุ (≤ 90 วัน)</span><span class="v">${near90.length} Lot</span><span class="sub">ควรจ่ายออกก่อน (FEFO)</span></a>
      <a class="card kpi bad" href="#/expiry?b=expired" style="text-decoration:none;color:inherit"><span class="sub">หมดอายุแล้ว</span><span class="v">${expired.length} Lot</span><span class="sub">ระบบล็อกไม่ให้จ่ายออก</span></a>
    </section>
    ${noExp.length ? `<div class="alert info">มี <b>${noExp.length} Lot</b> ที่ยังไม่ระบุวันหมดอายุ (เช่นยอดยกมาจาก Excel) — <a href="#/count">ตรวจนับ</a> แล้วสแกนกล่องจริงเพื่อแยก Lot และวันหมดอายุ</div>` : ''}
    <div class="grid split">
      <section class="card"><div class="row between"><h2>แจ้งเตือนวันหมดอายุ (≤ 180 วัน)</h2><a href="#/expiry">ดูทั้งหมด</a></div>
        <div class="tw"><table class="t"><thead><tr><th>สินค้า</th><th>Lot</th><th>หมดอายุ</th><th>เหลือ</th><th class="num">คงเหลือ</th><th>คลัง</th></tr></thead><tbody>
        ${alerts.map((l) => `<tr class="click" data-p="${l.product_id}"><td>${esc(l.name)}<div class="sub mono">${esc(l.code)}</div></td><td>${esc(l.lot_no)}</td><td>${dTH(l.expiry_date)}</td><td>${expiryBadge(l.expiry_date)}</td><td class="num">${n0(l.qty)}</td><td>${esc(l.warehouse_name)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ไม่มี Lot ที่จะหมดอายุภายใน 180 วัน</td></tr>'}
        </tbody></table></div></section>
      <section class="card"><h2>สินค้าหมด / ใกล้หมด</h2>
        ${[...out.map((p) => [p, 'r']), ...low.map((p) => [p, 'o'])].slice(0, 10).map(([p, c]) => `<div class="row between" style="border-bottom:1px solid var(--line2);padding:8px 0"><a href="#/ledger/${p.id}">${esc(p.name)}</a><span class="bd ${c}">${n0(p.qty)}</span></div>`).join('') || '<div class="empty">ทุกรายการมีสต็อก</div>'}
        <span class="sub">ตั้งจุดสั่งซื้อ (Min) ได้ที่หน้าแก้ไขสินค้า</span></section>
    </div>
    <div class="grid g2">
      <section class="card"><div class="row between"><h2>เอกสารล่าสุด</h2><a href="#/documents">ดูทั้งหมด</a></div>
        <div class="tw"><table class="t"><tbody>${docs.map((d) => `<tr class="click" data-d="${d.id}"><td class="mono">${esc(d.doc_no)}</td><td>${typeBadge(d.doc_type)}</td><td>${esc(d.partner?.name || '')}</td><td class="sub">${dtTH(d.created_at)}<br>${esc(d.creator?.full_name || '')}</td><td>${statusBadge(d.status)}</td></tr>`).join('') || '<tr><td class="empty">ยังไม่มีเอกสาร</td></tr>'}</tbody></table></div></section>
      ${can.seeCost() ? `<section class="card"><h2>มูลค่าคงเหลือสูงสุด 5 อันดับ</h2><div class="tw"><table class="t"><tbody>${top.map((p, i) => `<tr class="click" data-p="${p.id}"><td>${i + 1}</td><td>${esc(p.name)}<div class="sub mono">${esc(p.code)}</div></td><td class="num">${n0(p.qty)}</td><td class="num"><b>${n2(p.value)}</b></td><td class="num sub">${totalValue ? (p.value / totalValue * 100).toFixed(1) : 0}%</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    </div>`;

  main.addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]'); if (p) return go('#/ledger/' + p.dataset.p);
    const d = e.target.closest('[data-d]'); if (d) go('#/doc/' + d.dataset.d);
  });
  const find = async (s) => { const prod = await lookupProduct(s); if (!prod) { beep(false); throw new Error('ไม่พบสินค้า: ' + (s.gtin || s.code)); } beep(true); go('#/ledger/' + prod.id); };
  bindScanInput($('[data-scan]', main), find);
  $('[data-cam]', main).onclick = () => openCamera(find);
}
