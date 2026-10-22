-- WGB hotel CRM MVP — run in Supabase SQL Editor
create extension if not exists pgcrypto;

create table if not exists public.services (
  id text primary key,
  title text not null,
  description text not null default '',
  price_from numeric(12,2),
  price_unit text not null default 'по запросу',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null check (type in ('group','individual')),
  contact_name text not null check (char_length(contact_name) between 2 and 150),
  contact_email text not null check (char_length(contact_email) between 5 and 254),
  contact_phone text not null check (char_length(contact_phone) between 5 and 40),
  company text,
  arrival date not null,
  departure date not null,
  guests integer not null check (guests between 1 and 300),
  occupancy integer not null check (occupancy in (1,2)),
  meal_key text not null check (meal_key in ('none','breakfast','half','full')),
  payment text,
  transfer_requested boolean not null default false,
  selected_services text[] not null default '{}',
  wishes text,
  estimated_total numeric(12,2),
  status text not null default 'new' check (status in ('new','in_progress','quoted','confirmed','closed')),
  constraint valid_dates check (departure > arrival)
);
create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);
alter table public.services enable row level security;
alter table public.leads enable row level security;
revoke all on public.services from anon, authenticated;
revoke all on public.leads from anon, authenticated;
grant select on public.services to anon, authenticated;
grant insert (type,contact_name,contact_email,contact_phone,company,arrival,departure,guests,occupancy,meal_key,payment,transfer_requested,selected_services,wishes,estimated_total) on public.leads to anon,authenticated;
drop policy if exists "public active services" on public.services;
create policy "public active services" on public.services for select to anon,authenticated using (active = true);
drop policy if exists "public insert lead" on public.leads;
create policy "public insert lead" on public.leads for insert to anon,authenticated with check (status = 'new' and arrival >= current_date and departure > arrival);

insert into public.services(id,title,description,price_unit,sort_order) values
('airport_transfer','Трансфер из аэропорта','Встреча участников и доставка до отеля.','по запросу',10),
('meeting_room','Конференц-зал','Зал для встреч, презентаций и переговоров.','по запросу',20),
('coffee_break','Кофе-брейк','Напитки и закуски между деловыми сессиями.','по запросу',30),
('banquet','Банкет или корпоративный ужин','Организация совместного ужина или мероприятия.','по запросу',40),
('early_checkin','Ранний заезд / поздний выезд','Гибкий график проживания по согласованию.','по запросу',50),
('laundry','Прачечная и глажка','Услуги по уходу за одеждой для длительных поездок.','по запросу',60),
('workspace','Рабочее место','Место для индивидуальной работы с доступом в интернет.','по запросу',70),
('city_transport','Групповой транспорт','Перевозка участников между деловыми площадками.','по запросу',80)
on conflict (id) do nothing;

-- Leads deliberately have NO public SELECT / UPDATE / DELETE.
-- View and manage leads only in Supabase dashboard or via a trusted server using service_role.
-- Before production: enable CAPTCHA/rate limits using an Edge Function or API gateway.
