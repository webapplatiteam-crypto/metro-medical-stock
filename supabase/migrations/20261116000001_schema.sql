-- =====================================================================
-- Metro Medical Stock — โครงสร้างฐานข้อมูล (Supabase / PostgreSQL)
-- รันไฟล์นี้ครั้งเดียวใน Supabase SQL Editor (หรือ `supabase db push`)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- ชนิดข้อมูล ----------
do $$ begin
  create type public.user_role as enum ('admin','manager','staff','sales','viewer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.doc_type as enum ('IN','OUT','ADJ','TRF','CNT','DSP');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.doc_status as enum ('draft','pending','posted','cancelled');
exception when duplicate_object then null; end $$;

-- ---------- ผู้ใช้ ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text,
  employee_code text unique,
  role          public.user_role not null default 'staff',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ผู้ใช้คนแรกของระบบเป็น admin อัตโนมัติ; คนถัดไปใช้ role จาก app_metadata (ตั้งได้เฉพาะฝั่ง server) ไม่งั้นเป็น staff
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role public.user_role;
begin
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  else
    begin
      v_role := coalesce((new.raw_app_meta_data->>'role')::public.user_role, 'staff');
    exception when others then v_role := 'staff';
    end;
  end if;
  insert into public.profiles (id, email, full_name, employee_code, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          nullif(new.raw_user_meta_data->>'employee_code', ''),
          v_role)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles public.user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = any(roles) from public.profiles p where p.id = auth.uid() and p.active), false)
$$;

-- ---------- ตั้งค่าบริษัท ----------
create table if not exists public.company_settings (
  id               int primary key default 1 check (id = 1),
  name             text not null default 'บริษัท เมโทร เมดิคอล จำกัด (สำนักงานใหญ่)',
  name_en          text default 'Metro Medical Co., Ltd.',
  tax_id           text,
  license_no       text,
  address          text,
  min_shelf_days   int  not null default 180,          -- รับเข้าอายุคงเหลือน้อยกว่านี้ต้องอนุมัติ
  alert_days       int[] not null default '{180,90,30,7}',
  notify_emails    text[] not null default '{}',
  line_to          text,                                -- LINE userId / groupId สำหรับแจ้งเตือน
  updated_at       timestamptz not null default now()
);
insert into public.company_settings (id) values (1) on conflict do nothing;

-- ---------- คลัง / คู่ค้า ----------
create table if not exists public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  kind       text not null default 'main' check (kind in ('main','quarantine','consignment','demo')),
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.partners (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('supplier','customer','both')),
  name           text not null,
  contact        text,
  phone          text,
  email          text,
  tax_id         text,
  address        text,
  min_shelf_days int,          -- ลูกค้ารับเฉพาะสินค้าที่อายุเหลืออย่างน้อยกี่วัน
  note           text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ---------- สินค้า ----------
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  grp              text,
  size             text,
  unit             text not null default 'ชิ้น',
  gtin             text unique,
  fda_no           text,
  fda_expiry       date,
  manufacturer     text,
  tracking         text not null default 'lot' check (tracking in ('lot','serial','none')),
  min_qty          numeric(14,2) not null default 0,
  max_qty          numeric(14,2),
  cost             numeric(14,2) not null default 0,
  price            numeric(14,2),
  min_shelf_days   int,
  default_location text,
  supplier_id      uuid references public.partners(id),
  note             text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.product_barcodes (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  barcode    text not null unique,
  pack_qty   numeric(14,2) not null default 1,
  note       text
);

create table if not exists public.lots (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  lot_no      text not null,
  expiry_date date,
  created_at  timestamptz not null default now(),
  unique (product_id, lot_no)
);

-- ---------- เอกสาร ----------
create table if not exists public.documents (
  id               uuid primary key default gen_random_uuid(),
  doc_no           text unique,
  doc_type         public.doc_type not null,
  status           public.doc_status not null default 'draft',
  doc_date         date not null default current_date,
  warehouse_id     uuid references public.warehouses(id),
  to_warehouse_id  uuid references public.warehouses(id),
  partner_id       uuid references public.partners(id),
  purpose          text,       -- OUT: sale/consignment/demo/return_supplier/other · DSP: destroy/return_supplier · IN: purchase/return/opening
  ref_no           text,
  note             text,
  approval_reasons text[],
  created_by       uuid default auth.uid() references public.profiles(id),
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  posted_by        uuid references public.profiles(id),
  posted_at        timestamptz,
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  cancel_reason    text,
  cancelled_by     uuid references public.profiles(id),
  cancelled_at     timestamptz
);

create table if not exists public.document_lines (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents(id) on delete cascade,
  line_no         int,
  product_id      uuid not null references public.products(id),
  lot_no          text,
  expiry_date     date,
  lot_id          uuid references public.lots(id),
  qty             numeric(14,2) not null,   -- IN/OUT/TRF/DSP: จำนวนบวก · ADJ: +/- · CNT: จำนวนที่นับได้
  system_qty      numeric(14,2),            -- CNT: ยอดระบบตอนยืนยัน
  unit_cost       numeric(14,2),
  location        text,
  reason          text,
  override_reason text,                     -- เหตุผลข้าม FEFO / จ่ายของอายุสั้น
  created_at      timestamptz not null default now()
);
create index if not exists document_lines_doc_idx on public.document_lines(document_id);

create table if not exists public.stock_movements (
  id           bigserial primary key,
  document_id  uuid not null references public.documents(id),
  line_id      uuid references public.document_lines(id),
  product_id   uuid not null references public.products(id),
  lot_id       uuid not null references public.lots(id),
  warehouse_id uuid not null references public.warehouses(id),
  qty          numeric(14,2) not null,
  unit_cost    numeric(14,2) not null default 0,
  location     text,
  doc_date     date not null,
  moved_at     timestamptz not null default now(),
  created_by   uuid
);
create index if not exists stock_mv_lot_idx on public.stock_movements(product_id, lot_id, warehouse_id);
create index if not exists stock_mv_date_idx on public.stock_movements(doc_date);

create table if not exists public.doc_counters (
  doc_type public.doc_type not null,
  year     int not null,
  last_no  int not null default 0,
  primary key (doc_type, year)
);

create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  action     text not null,
  table_name text,
  record_id  text,
  detail     jsonb
);

-- ---------- เลขที่เอกสาร: IN-2569-0001 (ปี พ.ศ.) ----------
create or replace function public.next_doc_no(t public.doc_type, d date)
returns text language plpgsql security definer set search_path = public as $$
declare y int := extract(year from d)::int + 543; n int;
begin
  insert into public.doc_counters (doc_type, year, last_no) values (t, y, 1)
  on conflict (doc_type, year) do update set last_no = public.doc_counters.last_no + 1
  returning last_no into n;
  return t::text || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

create or replace function public.documents_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.doc_no is null then new.doc_no := public.next_doc_no(new.doc_type, coalesce(new.doc_date, current_date)); end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists documents_bi on public.documents;
create trigger documents_bi before insert on public.documents
  for each row execute function public.documents_before_insert();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();

-- ---------- ประวัติการใช้งาน ----------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_detail jsonb; v_id text;
begin
  if tg_op = 'DELETE' then v_detail := to_jsonb(old); v_id := old.id::text;
  elsif tg_op = 'UPDATE' then
    v_detail := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)); v_id := new.id::text;
  else v_detail := to_jsonb(new); v_id := new.id::text; end if;
  insert into public.audit_log (user_id, action, table_name, record_id, detail)
  values (auth.uid(), tg_op, tg_table_name, v_id, v_detail);
  return coalesce(new, old);
end $$;
drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update or delete on public.products for each row execute function public.audit_trigger();
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update or delete on public.profiles for each row execute function public.audit_trigger();
drop trigger if exists audit_lots on public.lots;
create trigger audit_lots after update or delete on public.lots for each row execute function public.audit_trigger();
drop trigger if exists audit_partners on public.partners;
create trigger audit_partners after insert or update or delete on public.partners for each row execute function public.audit_trigger();

create or replace function public.log_action(p_action text, p_table text, p_id text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (user_id, action, table_name, record_id, detail) values (auth.uid(), p_action, p_table, p_id, p_detail);
$$;

-- ---------- มุมมองสต็อก ----------
create or replace view public.v_lot_stock with (security_invoker = true) as
select m.product_id, m.lot_id, m.warehouse_id,
       sum(m.qty)                       as qty,
       l.lot_no, l.expiry_date,
       (l.expiry_date - current_date)   as days_left,
       p.code, p.name, p.grp, p.unit, p.cost, p.tracking,
       sum(m.qty) * p.cost              as value,
       w.code as warehouse_code, w.name as warehouse_name, w.kind as warehouse_kind,
       max(m.location)                  as location
from public.stock_movements m
join public.lots l       on l.id = m.lot_id
join public.products p   on p.id = m.product_id
join public.warehouses w on w.id = m.warehouse_id
group by m.product_id, m.lot_id, m.warehouse_id, l.lot_no, l.expiry_date, p.code, p.name, p.grp, p.unit, p.cost, p.tracking, w.code, w.name, w.kind
having sum(m.qty) <> 0;

create or replace view public.v_product_stock with (security_invoker = true) as
select p.*,
       coalesce(s.qty, 0)                as qty,
       coalesce(s.qty, 0) * p.cost       as value,
       s.next_expiry,
       s.lot_count
from public.products p
left join (
  select product_id, sum(qty) as qty,
         min(expiry_date) filter (where qty > 0) as next_expiry,
         count(*) filter (where qty > 0)        as lot_count
  from public.v_lot_stock group by product_id
) s on s.product_id = p.id;

create or replace view public.v_movements with (security_invoker = true) as
select m.id, m.doc_date, m.moved_at, m.qty, m.unit_cost, m.qty * m.unit_cost as amount, m.location,
       m.product_id, p.code, p.name, m.lot_id, l.lot_no, l.expiry_date,
       m.warehouse_id, w.name as warehouse_name,
       d.id as document_id, d.doc_no, d.doc_type, d.status as doc_status, d.purpose, d.ref_no, d.note,
       pa.name as partner_name, pr.full_name as created_by_name
from public.stock_movements m
join public.products p   on p.id = m.product_id
join public.lots l       on l.id = m.lot_id
join public.warehouses w on w.id = m.warehouse_id
join public.documents d  on d.id = m.document_id
left join public.partners pa on pa.id = d.partner_id
left join public.profiles pr on pr.id = m.created_by;

-- ---------- ยอดคงเหลือ Lot ในคลัง ----------
create or replace function public.lot_balance(p_lot uuid, p_wh uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0) from public.stock_movements where lot_id = p_lot and warehouse_id = p_wh
$$;

