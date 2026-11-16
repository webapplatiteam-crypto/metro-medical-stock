-- =====================================================================
-- สิทธิ์การเข้าถึง (Row Level Security)
-- admin = ผู้ดูแลระบบ · manager = หัวหน้าคลัง · staff = เจ้าหน้าที่คลัง
-- sales = ฝ่ายขาย (ดูอย่างเดียว) · viewer = บัญชี/ผู้บริหาร (ดูอย่างเดียว)
-- =====================================================================

alter table public.profiles          enable row level security;
alter table public.company_settings  enable row level security;
alter table public.warehouses        enable row level security;
alter table public.partners          enable row level security;
alter table public.products          enable row level security;
alter table public.product_barcodes  enable row level security;
alter table public.lots              enable row level security;
alter table public.documents         enable row level security;
alter table public.document_lines    enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.doc_counters      enable row level security;
alter table public.audit_log         enable row level security;

-- ผู้ใช้ที่ active ทุกบทบาทอ่านข้อมูลหลักได้
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

-- profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.is_active_user() or id = auth.uid());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role() and active);

-- company_settings
drop policy if exists settings_read on public.company_settings;
create policy settings_read on public.company_settings for select to authenticated using (public.is_active_user());
drop policy if exists settings_write on public.company_settings;
create policy settings_write on public.company_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- ข้อมูลหลัก: อ่านได้ทุกคน · แก้ได้ admin/manager
do $$
declare t text;
begin
  foreach t in array array['warehouses','partners','products','product_barcodes','lots'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (public.is_active_user())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($p$create policy %I_write on public.%I for all to authenticated
                    using (public.has_role('admin','manager')) with check (public.has_role('admin','manager'))$p$, t, t);
  end loop;
end $$;

-- documents: สร้างได้ admin/manager/staff · แก้/ลบได้เฉพาะร่างของตัวเอง (หัวหน้าแก้ได้ทุกใบที่เป็นร่าง)
-- การเปลี่ยนสถานะเป็น pending/posted/cancelled ทำผ่านฟังก์ชัน post_document / cancel_document เท่านั้น
drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated using (public.is_active_user());
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.has_role('admin','manager','staff') and status = 'draft' and created_by = auth.uid());
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (status = 'draft' and (created_by = auth.uid() or public.has_role('admin','manager')))
  with check (status = 'draft');
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (status = 'draft' and (created_by = auth.uid() or public.has_role('admin','manager')));

-- document_lines: ตามเอกสารแม่
create or replace function public.can_edit_document(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.documents d
                 where d.id = p_doc and d.status = 'draft'
                   and public.has_role('admin','manager','staff')
                   and (d.created_by = auth.uid() or public.has_role('admin','manager')))
$$;
drop policy if exists lines_read on public.document_lines;
create policy lines_read on public.document_lines for select to authenticated using (public.is_active_user());
drop policy if exists lines_write on public.document_lines;
create policy lines_write on public.document_lines for all to authenticated
  using (public.can_edit_document(document_id)) with check (public.can_edit_document(document_id));

-- stock_movements: อ่านอย่างเดียว (เขียนผ่าน post_document เท่านั้น)
drop policy if exists movements_read on public.stock_movements;
create policy movements_read on public.stock_movements for select to authenticated using (public.is_active_user());

-- audit_log: เฉพาะ admin/manager
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.has_role('admin','manager'));

-- สิทธิ์ระดับตาราง (Supabase ให้ไว้แล้ว ใส่ซ้ำเพื่อความชัดเจน)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke insert, update, delete on public.stock_movements, public.doc_counters, public.audit_log from authenticated;
revoke all on all tables in schema public from anon;

-- ฟังก์ชัน: เรียกได้เฉพาะผู้ที่ล็อกอิน
revoke execute on all functions in schema public from public, anon;
grant execute on function public.post_document(uuid)              to authenticated;
grant execute on function public.cancel_document(uuid, text)      to authenticated;
grant execute on function public.import_stock(jsonb, date, uuid, text) to authenticated;
grant execute on function public.find_product(text)               to authenticated;
grant execute on function public.lot_balance(uuid, uuid)          to authenticated;
grant execute on function public.my_role()                        to authenticated;
grant execute on function public.has_role(public.user_role[])     to authenticated;
grant execute on function public.is_active_user()                 to authenticated;
grant execute on function public.can_edit_document(uuid)          to authenticated;
grant execute on function public.expiry_summary(int)              to authenticated;
