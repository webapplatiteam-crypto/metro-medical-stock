// เพิ่ม / แก้ไขสินค้า
import { sb, q, state, can, TRACK, esc, toast, errMsg, $, $$, pageHead, go, partnerOptions, confirmBox } from '../core.js';
import { openCamera, parseScan } from '../scan.js';

export async function render(main, { args }) {
  if (!can.manage()) { main.innerHTML = '<div class="alert bad">เฉพาะหัวหน้าคลัง/ผู้ดูแลระบบ</div>'; return; }
  const isNew = !args[0] || args[0] === 'new';
  const p = isNew ? { code: '', name: '', grp: '', size: '', unit: 'ชิ้น', gtin: '', tracking: 'lot', min_qty: 0, max_qty: null, cost: 0, price: null, min_shelf_days: null, default_location: '', fda_no: '', fda_expiry: null, manufacturer: '', supplier_id: '', note: '', active: true }
    : await q(sb.from('products').select('*').eq('id', args[0]).single());
  let barcodes = isNew ? [] : await q(sb.from('product_barcodes').select('*').eq('product_id', p.id));
  const groups = (await q(sb.from('products').select('grp'))).map((r) => r.grp).filter(Boolean);
  const v = (k) => esc(p[k] ?? '');

  main.innerHTML = `${pageHead(isNew ? 'เพิ่มสินค้า' : esc(p.name), isNew ? '' : 'รหัส ' + esc(p.code),
    `${!isNew ? `<a class="b2" href="#/ledger/${p.id}">การ์ดสินค้า</a><button class="b2" data-toggle>${p.active ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}</button>` : ''}<a class="b2" href="#/products">ยกเลิก</a><button class="b1" data-save>บันทึก</button>`,
    '<a href="#/products">สินค้าทั้งหมด</a> › ' + (isNew ? 'เพิ่มสินค้า' : 'แก้ไขสินค้า'))}
    <datalist id="grps">${[...new Set(groups)].map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
    <div class="grid g2">
      <section class="card"><h2>ข้อมูลหลัก</h2><div class="grid g2">
        <label class="f">รหัสสินค้า *<input class="i" data-k="code" value="${v('code')}" required></label>
        <label class="f">กลุ่มสินค้า<input class="i" data-k="grp" list="grps" value="${v('grp')}"></label>
        <label class="f span2">ชื่อสินค้า *<input class="i" data-k="name" value="${v('name')}" required></label>
        <label class="f">ชนิด / ขนาด<input class="i" data-k="size" value="${v('size')}"></label>
        <label class="f">หน่วยนับ<input class="i" data-k="unit" value="${v('unit')}"></label>
        <label class="f span2">ผู้ผลิต / ประเทศ<input class="i" data-k="manufacturer" value="${v('manufacturer')}"></label>
      </div></section>
      <section class="card"><h2>บาร์โค้ด</h2>
        <label class="f">GTIN หลัก (จากผู้ผลิต)<div class="row"><input class="i grow" style="width:auto" data-k="gtin" value="${v('gtin')}" placeholder="13–14 หลัก"><button class="b2" type="button" data-scan-gtin>สแกน</button></div></label>
        <div><div class="sub" style="font-weight:600">บาร์โค้ดเพิ่มเติม (เช่น ระดับกล่อง)</div><div data-bc></div>
        <div class="row" style="margin-top:8px"><input class="i grow" style="width:auto" data-newbc placeholder="บาร์โค้ด"><input class="i" style="width:110px" type="number" min="1" data-newpack placeholder="1 = ชิ้น"><button class="b2" type="button" data-addbc>+ เพิ่ม</button></div></div>
        <span class="sub">ถ้าสินค้าไม่มีบาร์โค้ดจากผู้ผลิต ใช้รหัสสินค้าและพิมพ์ฉลากจากเมนู "พิมพ์ฉลากบาร์โค้ด"</span>
      </section>
      <section class="card"><h2>การติดตาม Lot / Serial / วันหมดอายุ</h2>
        <div class="grid">${Object.entries(TRACK).map(([k, l]) => `<label class="chk" style="padding:10px;border:1px solid var(--line);border-radius:10px"><input type="radio" name="trk" value="${k}" ${p.tracking === k ? 'checked' : ''}> ${l}${k === 'lot' ? ' (แนะนำสำหรับของใช้ครั้งเดียว)' : k === 'serial' ? ' (เช่น Applier — 1 ชิ้น 1 หมายเลข)' : ''}</label>`).join('')}</div>
        <label class="f">อายุคงเหลือขั้นต่ำตอนรับเข้า (วัน) — ว่าง = ใช้ค่าบริษัท ${state.settings?.min_shelf_days ?? 180} วัน<input class="i" type="number" min="0" data-k="min_shelf_days" value="${v('min_shelf_days')}"></label>
      </section>
      <section class="card"><h2>ทะเบียน อย.</h2><div class="grid g2">
        <label class="f">เลขที่ใบอนุญาต / ทะเบียน<input class="i" data-k="fda_no" value="${v('fda_no')}"></label>
        <label class="f">วันหมดอายุใบอนุญาต<input class="i" type="date" data-k="fda_expiry" value="${v('fda_expiry')}"></label>
      </div></section>
      <section class="card"><h2>สต็อก</h2><div class="grid g3">
        <label class="f">จุดสั่งซื้อ (Min)<input class="i" type="number" min="0" data-k="min_qty" value="${v('min_qty')}"></label>
        <label class="f">ขั้นสูง (Max)<input class="i" type="number" min="0" data-k="max_qty" value="${v('max_qty')}"></label>
        <label class="f">ตำแหน่งเริ่มต้น<input class="i" data-k="default_location" value="${v('default_location')}" placeholder="เช่น A-03"></label>
      </div></section>
      <section class="card"><h2>ราคาและคู่ค้า</h2><div class="grid g2">
        <label class="f">ราคาทุน / หน่วย<input class="i" type="number" step="any" min="0" data-k="cost" value="${v('cost')}"></label>
        <label class="f">ราคาขาย / หน่วย<input class="i" type="number" step="any" min="0" data-k="price" value="${v('price')}"></label>
        <label class="f span2">ซัพพลายเออร์หลัก<select class="i" data-k="supplier_id">${partnerOptions(p.supplier_id, ['supplier'])}</select></label>
        <label class="f span2">หมายเหตุ<input class="i" data-k="note" value="${v('note')}"></label>
      </div></section>
    </div>`;

  const drawBc = () => { $('[data-bc]', main).innerHTML = barcodes.map((b, i) => `<div class="row between" style="padding:8px 10px;background:var(--bg);border-radius:8px;margin-top:6px"><span class="mono">${esc(b.barcode)}</span><span class="sub">${b.pack_qty > 1 ? '1 กล่อง = ' + b.pack_qty : 'ต่อชิ้น'}</span><button class="b3" data-delbc="${i}">ลบ</button></div>`).join('') || '<div class="sub">ไม่มี</div>'; };
  drawBc();
  $('[data-addbc]', main).onclick = () => {
    const bc = $('[data-newbc]', main).value.trim(); if (!bc) return;
    barcodes.push({ barcode: parseScan(bc).gtin || bc, pack_qty: Number($('[data-newpack]', main).value) || 1, _new: true });
    $('[data-newbc]', main).value = ''; drawBc();
  };
  $('[data-bc]', main).addEventListener('click', (e) => { const b = e.target.closest('[data-delbc]'); if (b) { const x = barcodes.splice(Number(b.dataset.delbc), 1)[0]; if (x.id) (x._del = true, barcodes._deleted = [...(barcodes._deleted || []), x.id]); drawBc(); } });
  $('[data-scan-gtin]', main).onclick = () => openCamera(async (s) => { $('[data-k=gtin]', main).value = s.gtin || s.code || ''; });

  $('[data-toggle]', main)?.addEventListener('click', async () => {
    if (!(await confirmBox(p.active ? 'ปิดการใช้งานสินค้า' : 'เปิดใช้งานสินค้า', p.active ? 'สินค้าจะไม่ขึ้นตอนสแกน/เลือก แต่ประวัติยังอยู่ครบ' : 'เปิดใช้งานสินค้านี้อีกครั้ง?'))) return;
    try { await q(sb.from('products').update({ active: !p.active }).eq('id', p.id)); toast('บันทึกแล้ว', 'ok'); go('#/product/' + p.id); } catch (e) { toast(errMsg(e), 'err'); }
  });

  $('[data-save]', main).onclick = async (e) => {
    const rec = {};
    $$('[data-k]', main).forEach((el) => { const k = el.dataset.k; let val = el.value.trim(); rec[k] = val === '' ? null : val; });
    rec.tracking = $('input[name=trk]:checked', main).value;
    for (const k of ['min_qty', 'max_qty', 'cost', 'price', 'min_shelf_days']) if (rec[k] !== null) rec[k] = Number(rec[k]);
    rec.min_qty ??= 0; rec.cost ??= 0; rec.unit ||= 'ชิ้น';
    if (!rec.code || !rec.name) return toast('กรอกรหัสและชื่อสินค้า', 'err');
    if (rec.gtin) rec.gtin = rec.gtin.replace(/\D/g, '');
    e.target.disabled = true;
    try {
      const saved = isNew ? await q(sb.from('products').insert(rec).select('id').single()) : await q(sb.from('products').update(rec).eq('id', p.id).select('id').single());
      if (barcodes._deleted?.length) await q(sb.from('product_barcodes').delete().in('id', barcodes._deleted));
      const add = barcodes.filter((b) => b._new).map((b) => ({ product_id: saved.id, barcode: b.barcode, pack_qty: b.pack_qty }));
      if (add.length) await q(sb.from('product_barcodes').insert(add));
      toast('บันทึกสินค้าแล้ว', 'ok');
      go('#/ledger/' + saved.id);
    } catch (err) {
      toast(/duplicate key/.test(err.message) ? 'รหัสสินค้า / GTIN / บาร์โค้ดซ้ำกับสินค้าอื่น' : errMsg(err), 'err');
      e.target.disabled = false;
    }
  };
}
