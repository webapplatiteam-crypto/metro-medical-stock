-- =====================================================================
-- ข้อมูลเริ่มต้น: คลัง + สินค้าจริง 21 รายการ + ยอดยกมา ณ 13/09/2569
-- ที่มา: ไฟล์ Excel ชีต "สรุป" ของบริษัท เมโทร เมดิคอล จำกัด
-- รันหลังจากรัน migrations ครบแล้ว (รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ)
-- =====================================================================

insert into public.warehouses (code, name, kind, note) values
  ('MAIN', 'คลังหลัก',      'main',       'คลังเริ่มต้น'),
  ('QUAR', 'พื้นที่กักกัน', 'quarantine', 'ของหมดอายุ / ชำรุด / รอตรวจ — ห้ามจ่ายขาย')
on conflict (code) do nothing;

insert into public.products (code, name, grp, size, tracking, cost) values
  ('LMM002',    'Medium/Large Polymer Ligating LocaClip',                'LocaClip',     'ML',     'lot',    700),
  ('LML003',    'Large Polymer Ligating LocaClip',                       'LocaClip',     'L',      'lot',    700),
  ('LMLXL004',  'Extra Large Polymer Ligating LocaClip',                 'LocaClip',     'XL',     'lot',    700),
  ('APPLIERML', 'Laparoscopic Applier Medium/Large Polymer LocaClip',    'Applier',      'ML',     'serial', 15000),
  ('APPLIERL',  'Laparoscopic Applier for Large Polymer LocaClip',       'Applier',      'L',      'serial', 15000),
  ('APPLIERXL', 'Laparoscopic Applier for Extra Large Polymer LocaClip', 'Applier',      'XL',     'serial', 15000),
  ('0028200',   'Drenofast 200ml base unit',                             'Drenofast',    '200 ml', 'lot',    105),
  ('0028400',   'Drenofast 400ml base unit',                             'Drenofast',    '400 ml', 'lot',    110),
  ('0028600',   'Drenofast 600ml base unit',                             'Drenofast',    '600 ml', 'lot',    115),
  ('0029017',   'Redon probe with radiopaque line, CH 8, 2.7 mm',        'Redon probe',  'CH 8',   'lot',    18),
  ('0029027',   'Redon probe with radiopaque line, CH 10, 3.3 mm',       'Redon probe',  'CH 10',  'lot',    18),
  ('0029037',   'Redon probe with radiopaque line, CH 12, 4.0 mm',       'Redon probe',  'CH 12',  'lot',    18),
  ('0029047',   'Redon probe with radiopaque line, CH 14, 4.7 mm',       'Redon probe',  'CH 14',  'lot',    18),
  ('0029057',   'Redon probe with radiopaque line, CH 16, 5.3 mm',       'Redon probe',  'CH 16',  'lot',    18),
  ('0029067',   'Redon probe with radiopaque line, CH 18, 6.0 mm',       'Redon probe',  'CH 18',  'lot',    18),
  ('0030017',   'Semi-curved redon needle, CH 8, 2.7 mm',                'Redon needle', 'CH 8',   'lot',    100),
  ('0030027',   'Semi-curved redon needle, CH 10, 3.3 mm',               'Redon needle', 'CH 10',  'lot',    100),
  ('0030037',   'Semi-curved redon needle, CH 12, 4.0 mm',               'Redon needle', 'CH 12',  'lot',    100),
  ('0030047',   'Semi-curved redon needle, CH 14, 4.7 mm',               'Redon needle', 'CH 14',  'lot',    100),
  ('0030057',   'Semi-curved redon needle, CH 16, 5.3 mm',               'Redon needle', 'CH 16',  'lot',    100),
  ('0030067',   'Semi-curved redon needle, CH 18, 6.0 mm',               'Redon needle', 'CH 18',  'lot',    100)
on conflict (code) do nothing;

update public.products set note = 'ไฟล์ Excel เดิมช่องคงเหลือเป็น #REF! — ใช้ยอดรับ 2,200 ไว้ก่อน ควรตรวจนับยืนยัน'
where code = '0029017' and note is null;

-- ยอดยกมา (ยังไม่แยก Lot — ไฟล์เดิมไม่มี Lot/วันหมดอายุ ให้ตรวจนับเพื่อแยกภายหลัง)
do $$
declare v_doc uuid; v_wh uuid; r record; v_lot uuid; n int := 0;
begin
  if exists (select 1 from public.documents where doc_no = 'OPEN-2569-0001') then return; end if;
  select id into v_wh from public.warehouses where code = 'MAIN';

  insert into public.documents (doc_no, doc_type, status, doc_date, warehouse_id, purpose, ref_no, note, posted_at, created_by)
  values ('OPEN-2569-0001', 'IN', 'posted', date '2026-09-13', v_wh, 'opening', 'ไฟล์ Excel ชีต "สรุป"',
          'ยอดยกมาจากไฟล์ Excel ณ 13/09/2569', now(), null)
  returning id into v_doc;

  for r in
    select p.id, p.code, p.cost, x.qty
    from (values ('LMM002',138),('LML003',301),('LMLXL004',127),('APPLIERML',14),('APPLIERL',2),('APPLIERXL',2),
                 ('0028200',50),('0028400',1000),('0028600',1080),('0029017',2200),('0029027',2900),('0029037',3100),
                 ('0029047',100),('0030017',400),('0030027',90),('0030037',320),('0030047',80)) as x(code, qty)
    join public.products p on p.code = x.code
  loop
    n := n + 1;
    insert into public.lots (product_id, lot_no, expiry_date) values (r.id, 'ยอดยกมา', null)
    on conflict (product_id, lot_no) do update set lot_no = excluded.lot_no
    returning id into v_lot;
    with l as (
      insert into public.document_lines (document_id, line_no, product_id, lot_no, lot_id, qty, unit_cost)
      values (v_doc, n, r.id, 'ยอดยกมา', v_lot, r.qty, r.cost) returning id
    )
    insert into public.stock_movements (document_id, line_id, product_id, lot_id, warehouse_id, qty, unit_cost, doc_date)
    select v_doc, l.id, r.id, v_lot, v_wh, r.qty, r.cost, date '2026-09-13' from l;
  end loop;
end $$;
