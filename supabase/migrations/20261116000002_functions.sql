-- =====================================================================
-- ฟังก์ชันหลัก: ยืนยันเอกสาร / ยกเลิก / นำเข้า Excel / ค้นหาบาร์โค้ด
-- =====================================================================

-- ---------- ค้นหาสินค้าจากรหัส / GTIN / บาร์โค้ดเพิ่มเติม ----------
create or replace function public.find_product(p_code text)
returns setof public.products language sql stable security definer set search_path = public as $$
  with c as (select upper(trim(p_code)) as v)
  select p.* from public.products p, c
  where p.active and (
        upper(p.code) = c.v
     or p.gtin = c.v
     or ('0' || p.gtin) = c.v or p.gtin = ('0' || c.v)
     or ltrim(p.gtin, '0') = ltrim(c.v, '0')
     or exists (select 1 from public.product_barcodes b where b.product_id = p.id
                and (b.barcode = c.v or ltrim(b.barcode, '0') = ltrim(c.v, '0'))))
  limit 1
$$;

-- ---------- ยืนยันเอกสาร (ตัดสต็อก) ----------
-- คืนค่า 'posted' = ตัดสต็อกแล้ว · 'pending' = ส่งให้หัวหน้าคลังอนุมัติ
create or replace function public.post_document(p_id uuid)
returns public.doc_status language plpgsql security definer set search_path = public as $$
declare
  d         public.documents%rowtype;
  st        public.company_settings%rowtype;
  v_role    public.user_role := public.my_role();
  v_mgr     boolean;
  v_reasons text[] := '{}';
  r         record;
  v_early   record;
  v_lot_no  text;
  v_lot_id  uuid;
  v_exp     date;
  v_avail   numeric;
  v_min     int;
  v_cmin    int;
  v_wh_kind text;
  v_to_kind text;
  v_n       int;
  v_opening boolean;
begin
  if v_role is null or v_role in ('sales','viewer') then
    raise exception 'ไม่มีสิทธิ์ทำรายการนี้';
  end if;
  v_mgr := v_role in ('admin','manager');

  select * into d from public.documents where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.status not in ('draft','pending') then
    raise exception 'เอกสาร % อยู่ในสถานะ % แล้ว', d.doc_no, d.status;
  end if;
  if d.status = 'pending' and not v_mgr then raise exception 'เอกสารนี้รอหัวหน้าคลังอนุมัติ'; end if;
  if d.warehouse_id is null then raise exception 'ยังไม่ได้ระบุคลัง'; end if;
  if d.doc_type = 'TRF' and (d.to_warehouse_id is null or d.to_warehouse_id = d.warehouse_id) then
    raise exception 'ระบุคลังปลายทางให้ถูกต้อง';
  end if;
  select count(*) into v_n from public.document_lines where document_id = p_id;
  if v_n = 0 then raise exception 'ยังไม่มีรายการสินค้า'; end if;

  v_opening := d.doc_type = 'IN' and coalesce(d.purpose, '') = 'opening';
  select * into st from public.company_settings where id = 1;
  select kind into v_wh_kind from public.warehouses where id = d.warehouse_id;
  select kind into v_to_kind from public.warehouses where id = d.to_warehouse_id;
  select min_shelf_days into v_cmin from public.partners where id = d.partner_id;

  -- ล็อกตามสินค้า กันตัดสต็อกพร้อมกันจากหลายเครื่อง
  perform pg_advisory_xact_lock(hashtext(x.product_id::text))
  from (select distinct product_id from public.document_lines where document_id = p_id order by 1) x;

  -- 1) ผูก Lot / Serial ให้ทุกบรรทัด
  for r in
    select dl.id, dl.product_id, dl.lot_no, dl.expiry_date, dl.lot_id, dl.qty, p.tracking, p.code
    from public.document_lines dl join public.products p on p.id = dl.product_id
    where dl.document_id = p_id
  loop
    if r.lot_id is null then
      if r.tracking = 'none' then
        v_lot_no := coalesce(nullif(trim(r.lot_no), ''), '-');
      else
        v_lot_no := nullif(trim(r.lot_no), '');
        if v_lot_no is null then
          raise exception 'สินค้า % ยังไม่ได้ระบุ %', r.code, case when r.tracking = 'serial' then 'Serial' else 'Lot' end;
        end if;
      end if;

      if d.doc_type = 'IN' or (d.doc_type in ('ADJ','CNT') and r.qty > 0) then
        insert into public.lots (product_id, lot_no, expiry_date)
        values (r.product_id, v_lot_no, r.expiry_date)
        on conflict (product_id, lot_no)
          do update set expiry_date = coalesce(public.lots.expiry_date, excluded.expiry_date)
        returning id, expiry_date into v_lot_id, v_exp;
        if r.expiry_date is not null and v_exp is not null and v_exp <> r.expiry_date then
          raise exception 'Lot % ของ % ในระบบหมดอายุ % ไม่ตรงกับที่กรอก (%)',
            v_lot_no, r.code, to_char(v_exp, 'DD/MM/YYYY'), to_char(r.expiry_date, 'DD/MM/YYYY');
        end if;
      else
        select id into v_lot_id from public.lots where product_id = r.product_id and lot_no = v_lot_no;
        if v_lot_id is null then raise exception 'ไม่พบ Lot % ของสินค้า %', v_lot_no, r.code; end if;
      end if;
      update public.document_lines set lot_id = v_lot_id, lot_no = v_lot_no where id = r.id;
    end if;

    if r.tracking = 'serial' and not v_opening and d.doc_type in ('IN','OUT','TRF','DSP') and r.qty <> 1 then
      raise exception 'สินค้า % ติดตาม Serial — ใส่ 1 บรรทัดต่อ 1 ชิ้น', r.code;
    end if;
  end loop;

  if d.doc_type = 'CNT' and exists (
       select 1 from public.document_lines where document_id = p_id group by lot_id having count(*) > 1) then
    raise exception 'ใบตรวจนับมี Lot ซ้ำ — รวมเป็นบรรทัดเดียว';
  end if;

  -- 2) ตรวจกฎรายการตาม Lot
  for r in
    select dl.lot_id, dl.product_id, sum(dl.qty) as qty, bool_or(dl.override_reason is not null) as has_override,
           l.lot_no, l.expiry_date, p.code, p.min_shelf_days, p.tracking
    from public.document_lines dl
    join public.lots l on l.id = dl.lot_id
    join public.products p on p.id = dl.product_id
    where dl.document_id = p_id
    group by dl.lot_id, dl.product_id, l.lot_no, l.expiry_date, p.code, p.min_shelf_days, p.tracking
  loop
    v_avail := public.lot_balance(r.lot_id, d.warehouse_id);

    if d.doc_type in ('IN','OUT','TRF','DSP') and r.qty <= 0 then
      raise exception 'จำนวนของ % ต้องมากกว่า 0', r.code;
    end if;

    if d.doc_type = 'IN' then
      if r.expiry_date is not null and not v_opening then
        if r.expiry_date < d.doc_date then
          raise exception 'สินค้า % Lot % หมดอายุแล้ว (%) — รับเข้าไม่ได้', r.code, r.lot_no, to_char(r.expiry_date, 'DD/MM/YYYY');
        end if;
        v_min := coalesce(r.min_shelf_days, st.min_shelf_days);
        if r.expiry_date - d.doc_date < v_min then
          v_reasons := v_reasons || format('รับสินค้าอายุสั้น: %s Lot %s เหลือ %s วัน', r.code, r.lot_no, r.expiry_date - d.doc_date);
        end if;
      end if;
      if r.tracking = 'serial' and not v_opening
         and (select coalesce(sum(qty), 0) from public.stock_movements where lot_id = r.lot_id) > 0 then
        raise exception 'Serial % ของ % มีอยู่ในคลังแล้ว', r.lot_no, r.code;
      end if;

    elsif d.doc_type in ('OUT','TRF','DSP') then
      if v_avail < r.qty then
        raise exception 'คงเหลือไม่พอ: % Lot % มี % ต้องการ %', r.code, r.lot_no, v_avail, r.qty;
      end if;

      if d.doc_type = 'OUT' then
        if v_wh_kind = 'quarantine' then
          raise exception 'จ่ายออกจากพื้นที่กักกันไม่ได้ — ใช้ใบทำลาย/คืนซัพพลายเออร์';
        end if;
        if r.expiry_date is not null and r.expiry_date < d.doc_date then
          raise exception 'ห้ามจ่าย: % Lot % หมดอายุแล้ว (%)', r.code, r.lot_no, to_char(r.expiry_date, 'DD/MM/YYYY');
        end if;
        -- FEFO: มี Lot อื่นที่หมดอายุก่อนและยังมีของหรือไม่
        select l2.lot_no, l2.expiry_date into v_early
        from public.lots l2
        where l2.product_id = r.product_id and l2.id <> r.lot_id
          and l2.expiry_date is not null and l2.expiry_date >= d.doc_date
          and r.expiry_date is not null and l2.expiry_date < r.expiry_date
          and l2.id not in (select lot_id from public.document_lines where document_id = p_id)
          and public.lot_balance(l2.id, d.warehouse_id) > 0
        order by l2.expiry_date
        limit 1;
        if found then
          if not r.has_override then
            raise exception 'FEFO: % ควรจ่าย Lot % (หมดอายุ %) ก่อน Lot % — ใส่เหตุผลหากต้องการข้าม',
              r.code, v_early.lot_no, to_char(v_early.expiry_date, 'DD/MM/YYYY'), r.lot_no;
          end if;
          v_reasons := v_reasons || format('ข้าม FEFO: %s จ่าย Lot %s แทน %s', r.code, r.lot_no, v_early.lot_no);
        end if;
        if v_cmin is not null and r.expiry_date is not null and r.expiry_date - d.doc_date < v_cmin then
          v_reasons := v_reasons || format('อายุเหลือน้อยกว่าที่ลูกค้ากำหนด: %s Lot %s เหลือ %s วัน (ลูกค้ากำหนด %s)',
                                           r.code, r.lot_no, r.expiry_date - d.doc_date, v_cmin);
        end if;
      elsif d.doc_type = 'TRF' then
        if r.expiry_date is not null and r.expiry_date < d.doc_date and coalesce(v_to_kind, '') <> 'quarantine' then
          raise exception '% Lot % หมดอายุแล้ว โอนได้เฉพาะไปพื้นที่กักกัน', r.code, r.lot_no;
        end if;
      else
        v_reasons := v_reasons || format('%s: %s Lot %s จำนวน %s',
                                         case when d.purpose = 'return_supplier' then 'คืนซัพพลายเออร์' else 'ตัดทำลาย' end,
                                         r.code, r.lot_no, r.qty);
      end if;

    elsif d.doc_type = 'ADJ' then
      if r.qty = 0 then raise exception 'จำนวนปรับของ % ต้องไม่เป็น 0', r.code; end if;
      if v_avail + r.qty < 0 then
        raise exception 'ปรับแล้วยอดติดลบ: % Lot % มี % ปรับ %', r.code, r.lot_no, v_avail, r.qty;
      end if;
      v_reasons := v_reasons || format('ปรับยอด %s Lot %s: %s', r.code, r.lot_no, r.qty);

    elsif d.doc_type = 'CNT' then
      if r.qty < 0 then raise exception 'จำนวนนับของ % ต้องไม่ติดลบ', r.code; end if;
      if v_avail <> r.qty then
        v_reasons := v_reasons || format('ผลนับต่าง %s Lot %s: ระบบ %s นับได้ %s', r.code, r.lot_no, v_avail, r.qty);
      end if;
    end if;
  end loop;

  -- 3) ต้องอนุมัติหรือไม่
  if coalesce(array_length(v_reasons, 1), 0) > 0 and not v_mgr then
    update public.documents
       set status = 'pending', approval_reasons = v_reasons, submitted_at = now()
     where id = p_id;
    perform public.log_action('SUBMIT', 'documents', p_id::text, jsonb_build_object('doc_no', d.doc_no, 'reasons', v_reasons));
    return 'pending';
  end if;

  -- 4) บันทึกความเคลื่อนไหว
  for r in
    select dl.*, p.cost from public.document_lines dl join public.products p on p.id = dl.product_id
    where dl.document_id = p_id order by dl.line_no nulls last, dl.created_at
  loop
    if d.doc_type = 'IN' then
      insert into public.stock_movements (document_id, line_id, product_id, lot_id, warehouse_id, qty, unit_cost, location, doc_date, created_by)
      values (p_id, r.id, r.product_id, r.lot_id, d.warehouse_id, r.qty, coalesce(r.unit_cost, r.cost), r.location, d.doc_date, auth.uid());
      if coalesce(r.unit_cost, 0) > 0 then
        update public.products set cost = r.unit_cost where id = r.product_id and cost = 0;
      end if;
    elsif d.doc_type in ('OUT','DSP') then
      insert into public.stock_movements (document_id, line_id, product_id, lot_id, warehouse_id, qty, unit_cost, location, doc_date, created_by)
      values (p_id, r.id, r.product_id, r.lot_id, d.warehouse_id, -r.qty, r.cost, r.location, d.doc_date, auth.uid());
    elsif d.doc_type = 'TRF' then
      insert into public.stock_movements (document_id, line_id, product_id, lot_id, warehouse_id, qty, unit_cost, location, doc_date, created_by)
      values (p_id, r.id, r.product_id, r.lot_id, d.warehouse_id, -r.qty, r.cost, r.location, d.doc_date, auth.uid()),
             (p_id, r.id, r.product_id, r.lot_id, d.to_warehouse_id, r.qty, r.cost, r.location, d.doc_date, auth.uid());
    elsif d.doc_type = 'ADJ' then
      insert into public.stock_movements (document_id, line_id, product_id, lot_id, warehouse_id, qty, unit_cost, location, doc_date, created_by)
      values (p_id, r.id, r.product_id, r.lot_id, d.warehouse_id, r.qty, r.cost, r.location, d.doc_date, auth.uid());
    elsif d.doc_type = 'CNT' then
      v_avail := public.lot_balance(r.lot_id, d.warehouse_id);
      update public.document_lines set system_qty = v_avail where id = r.id;
      if r.qty - v_avail <> 0 then
        insert into public.stock_movements (document_id, line_id, product_id, lot_id, warehouse_id, qty, unit_cost, location, doc_date, created_by)
        values (p_id, r.id, r.product_id, r.lot_id, d.warehouse_id, r.qty - v_avail, r.cost, r.location, d.doc_date, auth.uid());
      end if;
    end if;
  end loop;

  update public.documents
     set status = 'posted', posted_by = auth.uid(), posted_at = now(),
         approval_reasons = case when coalesce(array_length(v_reasons, 1), 0) > 0 then v_reasons else approval_reasons end,
         approved_by = case when coalesce(array_length(v_reasons, 1), 0) > 0 or d.status = 'pending' then auth.uid() end,
         approved_at = case when coalesce(array_length(v_reasons, 1), 0) > 0 or d.status = 'pending' then now() end
   where id = p_id;
  perform public.log_action('POST', 'documents', p_id::text, jsonb_build_object('doc_no', d.doc_no));
  return 'posted';
end $$;

-- ---------- ยกเลิกเอกสาร (ไม่ลบประวัติ — สร้างรายการกลับยอด) ----------
create or replace function public.cancel_document(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.documents%rowtype; r record; v_mgr boolean := public.has_role('admin','manager');
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'กรุณาระบุเหตุผลการยกเลิก'; end if;
  select * into d from public.documents where id = p_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if d.status = 'cancelled' then raise exception 'เอกสารถูกยกเลิกไปแล้ว'; end if;
  if not v_mgr and not (d.status in ('draft','pending') and d.created_by = auth.uid()
                        and public.has_role('staff')) then
    raise exception 'การยกเลิกเอกสารต้องเป็นหัวหน้าคลังหรือผู้ดูแลระบบ';
  end if;

  if d.status = 'posted' then
    perform pg_advisory_xact_lock(hashtext(x.product_id::text))
    from (select distinct product_id from public.stock_movements where document_id = p_id order by 1) x;
    for r in
      select m.lot_id, m.warehouse_id, sum(m.qty) as q, p.code, l.lot_no
      from public.stock_movements m join public.products p on p.id = m.product_id join public.lots l on l.id = m.lot_id
      where m.document_id = p_id group by m.lot_id, m.warehouse_id, p.code, l.lot_no
    loop
      if public.lot_balance(r.lot_id, r.warehouse_id) - r.q < 0 then
        raise exception 'ยกเลิกไม่ได้: % Lot % ถูกจ่ายต่อไปแล้ว ยอดจะติดลบ', r.code, r.lot_no;
      end if;
    end loop;
    insert into public.stock_movements (document_id, line_id, product_id, lot_id, warehouse_id, qty, unit_cost, location, doc_date, created_by)
    select document_id, line_id, product_id, lot_id, warehouse_id, -qty, unit_cost, location, current_date, auth.uid()
    from public.stock_movements where document_id = p_id;
  end if;

  update public.documents
     set status = 'cancelled', cancel_reason = p_reason, cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_id;
  perform public.log_action('CANCEL', 'documents', p_id::text, jsonb_build_object('doc_no', d.doc_no, 'reason', p_reason));
end $$;

-- ---------- นำเข้าสินค้า + ยอดยกมาจาก Excel ----------
-- p_rows: [{code,name,grp,size,unit,cost,qty,lot_no,expiry_date,location,gtin,tracking}]
create or replace function public.import_stock(p_rows jsonb, p_doc_date date, p_warehouse uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_pid uuid; v_doc uuid; n int := 0; v_products int := 0; v_status public.doc_status;
begin
  if not public.has_role('admin','manager') then raise exception 'นำเข้าได้เฉพาะผู้ดูแลระบบ/หัวหน้าคลัง'; end if;
  if p_warehouse is null then raise exception 'เลือกคลังที่จะนำเข้า'; end if;

  for r in
    select * from jsonb_to_recordset(p_rows) as x(code text, name text, grp text, size text, unit text, cost numeric,
                                                  qty numeric, lot_no text, expiry_date date, location text, gtin text, tracking text)
  loop
    continue when nullif(trim(coalesce(r.code, '')), '') is null;
    insert into public.products (code, name, grp, size, unit, cost, gtin, tracking)
    values (trim(r.code), coalesce(nullif(trim(r.name), ''), trim(r.code)), nullif(trim(r.grp), ''), nullif(trim(r.size), ''),
            coalesce(nullif(trim(r.unit), ''), 'ชิ้น'), coalesce(r.cost, 0), nullif(trim(r.gtin), ''),
            case when r.tracking in ('lot','serial','none') then r.tracking else 'lot' end)
    on conflict (code) do update set
      name = coalesce(nullif(trim(excluded.name), ''), public.products.name),
      grp  = coalesce(excluded.grp,  public.products.grp),
      size = coalesce(excluded.size, public.products.size),
      cost = case when excluded.cost > 0 then excluded.cost else public.products.cost end,
      gtin = coalesce(excluded.gtin, public.products.gtin)
    returning id into v_pid;
    v_products := v_products + 1;

    if coalesce(r.qty, 0) > 0 then
      if v_doc is null then
        insert into public.documents (doc_type, doc_date, warehouse_id, purpose, ref_no, note)
        values ('IN', coalesce(p_doc_date, current_date), p_warehouse, 'opening', 'นำเข้า Excel', p_note)
        returning id into v_doc;
      end if;
      n := n + 1;
      insert into public.document_lines (document_id, line_no, product_id, lot_no, expiry_date, qty, unit_cost, location)
      values (v_doc, n, v_pid, coalesce(nullif(trim(r.lot_no), ''), 'ยอดยกมา'), r.expiry_date, r.qty, r.cost, nullif(trim(r.location), ''));
    end if;
  end loop;

  if v_doc is not null then v_status := public.post_document(v_doc); end if;
  return jsonb_build_object('products', v_products, 'lines', n, 'document_id', v_doc, 'status', v_status);
end $$;

-- ---------- สรุปสำหรับแจ้งเตือนวันหมดอายุ (ใช้โดย Edge Function) ----------
create or replace function public.expiry_summary(p_days int default 180)
returns table (bucket text, code text, name text, lot_no text, expiry_date date, days_left int,
               warehouse_name text, qty numeric, value numeric)
language sql stable security definer set search_path = public as $$
  select case when days_left < 0 then 'expired' when days_left <= 30 then 'd30'
              when days_left <= 90 then 'd90' else 'd180' end,
         code, name, lot_no, expiry_date, days_left, warehouse_name, qty, value
  from public.v_lot_stock
  where qty > 0 and expiry_date is not null and days_left <= p_days
  order by expiry_date
$$;
