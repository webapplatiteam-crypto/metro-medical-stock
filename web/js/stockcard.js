// ทะเบียนคุมเครื่องมือเครื่องใช้ (รูปแบบเดียวกับไฟล์ Excel เดิม)
import { DOC, PURPOSE, dTH } from './core.js';

export function describe(m) {
  if (m.purpose === 'opening') return 'ยอดยกมา';
  const base = { IN: 'รับ', OUT: 'จ่าย', ADJ: 'ปรับยอด', TRF: 'โอน', CNT: 'ปรับตามผลตรวจนับ', DSP: PURPOSE[m.purpose] || 'ทำลาย' }[m.doc_type] || DOC[m.doc_type]?.label;
  const who = m.partner_name ? ' ' + m.partner_name : '';
  const tr = m.doc_type === 'TRF' ? (m.qty > 0 ? ' เข้า ' : ' ออกจาก ') + m.warehouse_name : '';
  return base + who + tr + (m.doc_status === 'cancelled' ? ' (เอกสารยกเลิก)' : '');
}

// คืน rows ของ ledger พร้อมยอดคงเหลือสะสม (รวมทุกคลัง; โอนย้ายระหว่างคลังหักกันเป็นศูนย์)
export function ledgerRows(movs, cost) {
  let bal = 0;
  return movs.map((m) => {
    const q = Number(m.qty); bal += q;
    const price = Number(m.unit_cost || cost || 0);
    return { ...m, inQ: q > 0 ? q : 0, outQ: q < 0 ? -q : 0, price, bal, balPrice: Number(cost || 0) };
  });
}

export function stockCardSheet(product, movs, settings) {
  const rows = ledgerRows(movs, product.cost);
  const aoa = [
    ['ทะเบียนคุมเครื่องมือเครื่องใช้'],
    [`ชื่อผู้ประกอบการ : ${settings?.name || ''}`, '', '', '', '', '', '', 'เลขประจำตัวผู้เสียภาษี', settings?.tax_id || ''],
    [`ชื่อสถานประกอบการ : ${settings?.address || ''}`],
    ['รายการเครื่องมือเครื่องใช้', '', product.name, '', 'รหัส', product.code, '', 'ชนิด/ขนาด', product.size || '', 'ปริมาณนับเป็น', product.unit || ''],
    ['ว.ด.ป.', 'เลขที่เอกสาร', 'รายการ', 'รับ', '', '', 'จ่าย', '', '', 'คงเหลือ', '', '', 'Lot / Serial', 'วันหมดอายุ', 'คลัง'],
    ['', '', '', 'จำนวนหน่วย', 'ราคา/หน่วย', 'จำนวนเงิน', 'จำนวนหน่วย', 'ราคา/หน่วย', 'จำนวนเงิน', 'จำนวนหน่วย', 'ราคา/หน่วย', 'จำนวนเงิน', '', '', ''],
    ...rows.map((r) => [dTH(r.doc_date), r.doc_no, describe(r),
      r.inQ || '', r.inQ ? r.price : '', r.inQ ? r.inQ * r.price : '',
      r.outQ || '', r.outQ ? r.price : '', r.outQ ? r.outQ * r.price : '',
      r.bal, r.balPrice, r.bal * r.balPrice, r.lot_no, r.expiry_date ? dTH(r.expiry_date) : '', r.warehouse_name]),
  ];
  return {
    name: product.code, rows: aoa, cols: [11, 16, 30, 10, 10, 12, 10, 10, 12, 10, 10, 12, 14, 12, 14],
    merges: [{ s: { r: 4, c: 3 }, e: { r: 4, c: 5 } }, { s: { r: 4, c: 6 }, e: { r: 4, c: 8 } }, { s: { r: 4, c: 9 }, e: { r: 4, c: 11 } }],
  };
}
