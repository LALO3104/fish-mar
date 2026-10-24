-- =====================================================================
-- FishMar: seguridad de pedidos
--  1. Número de pedido y total se calculan en la base de datos
--     (función crear_pedido_domicilio), sin choques de folio.
--  2. Los visitantes anónimos ya no pueden leer ni escribir pedidos
--     directamente; solo pueden llamar a la función.
--  3. Políticas RLS por rol: admin, mesero, repartidor.
--
-- Cómo aplicarla: Supabase → SQL Editor → pegar todo → Run.
-- Si algo falla, nada se aplica (todo va en una transacción).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Comprobaciones previas: detenerse si el esquema no es el esperado
-- ---------------------------------------------------------------------
do $$
declare
  faltantes text;
begin
  select string_agg(t || '.' || c, ', ') into faltantes
  from (values
    ('pedidos','numero_pedido'), ('pedidos','nombre'), ('pedidos','telefono'),
    ('pedidos','direccion'), ('pedidos','metodo_pago'), ('pedidos','total'),
    ('pedidos','estado'), ('pedidos','ubicacion'), ('pedidos','notas'),
    ('pedidos','items'), ('pedidos','fecha'), ('pedidos','tipo_pedido'),
    ('pedidos','repartidor_id'), ('pedidos','repartidor_nombre'), ('pedidos','mesero_id'),
    ('productos','id'), ('productos','nombre'), ('productos','precio'), ('productos','tipo_venta'),
    ('user_roles','user_id'), ('user_roles','role'), ('user_roles','is_superadmin'),
    ('repartidor_cortes','repartidor_id'), ('comandas','pedido_id')
  ) as esperadas(t, c)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = esperadas.t and column_name = esperadas.c
  );
  if faltantes is not null then
    raise exception 'Faltan columnas esperadas: %. No se aplicó ningún cambio.', faltantes;
  end if;

  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'pedidos' and column_name = 'numero_pedido')
     not in ('text', 'character varying') then
    raise exception 'pedidos.numero_pedido no es de tipo texto. No se aplicó ningún cambio.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Funciones auxiliares de rol (security definer para evitar
--    recursión de RLS al consultar user_roles)
-- ---------------------------------------------------------------------
create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and (role::text in ('admin', 'superadmin') or is_superadmin = true)
  );
$$;

create or replace function public.tiene_rol(p_rol text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role::text = p_rol
  );
$$;

revoke all on function public.es_admin() from public, anon;
revoke all on function public.tiene_rol(text) from public, anon;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.tiene_rol(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Folios diarios sin choques
-- ---------------------------------------------------------------------
create table if not exists public.pedido_folios (
  dia    date primary key,
  ultimo integer not null
);
alter table public.pedido_folios enable row level security;
-- Sin políticas: solo la función (security definer) la toca.

-- ---------------------------------------------------------------------
-- 3. Crear pedido a domicilio (lo llama la página pública)
--    p_items: [{"id": 12, "qty": 1.5}, ...]  — el precio se toma de
--    la tabla productos, nunca del navegador.
-- ---------------------------------------------------------------------
create or replace function public.crear_pedido_domicilio(
  p_nombre      text,
  p_telefono    text,
  p_direccion   text,
  p_metodo_pago text,
  p_ubicacion   text,
  p_notas       text,
  p_items       jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia       date := (now() at time zone 'America/Mexico_City')::date;
  v_prefijo   text := to_char(v_dia, 'YYMMDD');
  v_folio     integer;
  v_numero    text;
  v_item      jsonb;
  v_prod      record;
  v_qty       numeric;
  v_items     jsonb := '[]'::jsonb;
  v_subtotal  numeric := 0;
  v_total     numeric;
  v_pedido    record;
begin
  -- Validaciones (las mismas que el formulario, pero ahora obligatorias)
  p_nombre    := btrim(coalesce(p_nombre, ''));
  p_telefono  := btrim(coalesce(p_telefono, ''));
  p_direccion := btrim(coalesce(p_direccion, ''));
  p_notas     := nullif(btrim(coalesce(p_notas, '')), '');

  if char_length(p_nombre) < 3 or char_length(p_nombre) > 100 then
    raise exception 'Nombre inválido';
  end if;
  if p_telefono !~ '^[0-9]{10,15}$' then
    raise exception 'Teléfono inválido';
  end if;
  if char_length(p_direccion) < 8 or char_length(p_direccion) > 300 then
    raise exception 'Dirección inválida';
  end if;
  if p_metodo_pago not in ('Efectivo', 'Transferencia') then
    raise exception 'Método de pago inválido';
  end if;
  if p_ubicacion !~ '^https://www\.google\.com/maps\?q=-?[0-9.]+,-?[0-9.]+$' then
    raise exception 'Ubicación inválida';
  end if;
  if p_notas is not null and char_length(p_notas) > 500 then
    raise exception 'Las notas son demasiado largas';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'El carrito está vacío o es inválido';
  end if;

  -- Reconstruir los productos con precios reales
  for v_item in select * from jsonb_array_elements(p_items) loop
    select id, nombre, precio, coalesce(tipo_venta, 'pieza') as tipo_venta
      into v_prod
      from public.productos
     where id = (v_item->>'id')::bigint;
    if not found then
      raise exception 'Producto no disponible (id %)', v_item->>'id';
    end if;

    v_qty := (v_item->>'qty')::numeric;
    if v_prod.tipo_venta = 'granel' then
      v_qty := round(v_qty, 3);
    else
      v_qty := round(v_qty);
    end if;
    if v_qty is null or v_qty <= 0 or v_qty > 100 then
      raise exception 'Cantidad inválida para %', v_prod.nombre;
    end if;

    v_subtotal := v_subtotal + v_prod.precio * v_qty;
    v_items := v_items || jsonb_build_object(
      'id', v_prod.id,
      'nombre', v_prod.nombre,
      'precio', v_prod.precio,
      'qty', v_qty,
      'tipo_venta', v_prod.tipo_venta
    );
  end loop;

  -- Mismo redondeo que antes: hacia arriba al $0.50 más cercano
  v_total := ceil(v_subtotal * 2) / 2;

  -- Folio atómico del día. La primera vez del día continúa desde el
  -- último folio ya existente para no repetir números viejos.
  insert into public.pedido_folios as f (dia, ultimo)
  values (
    v_dia,
    coalesce((
      select max(right(numero_pedido, 3)::integer)
        from public.pedidos
       where numero_pedido ~ ('^' || v_prefijo || '[0-9]{3}$')
    ), 0) + 1
  )
  on conflict (dia) do update set ultimo = f.ultimo + 1
  returning ultimo into v_folio;

  if v_folio > 999 then
    raise exception 'Límite de pedidos diarios alcanzado (999)';
  end if;
  v_numero := v_prefijo || lpad(v_folio::text, 3, '0');

  -- jsonb_populate_record convierte cada valor al tipo real de su
  -- columna (enum, date, numeric, json/jsonb), sea cual sea.
  insert into public.pedidos (
    numero_pedido, nombre, telefono, direccion, metodo_pago, total,
    estado, repartidor_id, repartidor_nombre, ubicacion, notas, items,
    fecha, tipo_pedido
  )
  select
    r.numero_pedido, r.nombre, r.telefono, r.direccion, r.metodo_pago, r.total,
    r.estado, r.repartidor_id, r.repartidor_nombre, r.ubicacion, r.notas, r.items,
    r.fecha, r.tipo_pedido
  from jsonb_populate_record(null::public.pedidos, jsonb_build_object(
    'numero_pedido', v_numero,
    'nombre', p_nombre,
    'telefono', p_telefono,
    'direccion', p_direccion,
    'metodo_pago', p_metodo_pago,
    'total', v_total,
    'estado', 'Recibido',
    'repartidor_id', null,
    'repartidor_nombre', '',
    'ubicacion', p_ubicacion,
    'notas', p_notas,
    'items', v_items,
    'fecha', v_dia,
    'tipo_pedido', 'domicilio'
  )) as r
  returning id into v_pedido;

  return json_build_object(
    'id', v_pedido.id,
    'numero_pedido', v_numero,
    'subtotal', v_subtotal,
    'total', v_total,
    'items', v_items
  );
end;
$$;

revoke all on function public.crear_pedido_domicilio(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.crear_pedido_domicilio(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS: borrar las políticas actuales de estas tablas y crear
--    unas conocidas. (Otras tablas no se tocan.)
-- ---------------------------------------------------------------------
alter table public.pedidos           enable row level security;
alter table public.productos         enable row level security;
alter table public.user_roles        enable row level security;
alter table public.repartidor_cortes enable row level security;
alter table public.comandas          enable row level security;

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('pedidos', 'productos', 'user_roles', 'repartidor_cortes', 'comandas')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- pedidos -------------------------------------------------------------
-- Admin: todo
create policy pedidos_admin_todo on public.pedidos
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Repartidor: ver y actualizar solo sus pedidos asignados
create policy pedidos_repartidor_ver on public.pedidos
  for select to authenticated
  using (public.tiene_rol('repartidor') and repartidor_id = auth.uid());
create policy pedidos_repartidor_actualizar on public.pedidos
  for update to authenticated
  using (public.tiene_rol('repartidor') and repartidor_id = auth.uid())
  with check (public.tiene_rol('repartidor') and repartidor_id = auth.uid());

-- Mesero: pedidos locales (ver, crear, actualizar; no borrar)
create policy pedidos_mesero_ver on public.pedidos
  for select to authenticated
  using (public.tiene_rol('mesero') and tipo_pedido = 'local');
create policy pedidos_mesero_crear on public.pedidos
  for insert to authenticated
  with check (public.tiene_rol('mesero') and tipo_pedido = 'local' and mesero_id = auth.uid());
create policy pedidos_mesero_actualizar on public.pedidos
  for update to authenticated
  using (public.tiene_rol('mesero') and tipo_pedido = 'local')
  with check (public.tiene_rol('mesero') and tipo_pedido = 'local');

-- (anon no tiene políticas: solo puede usar crear_pedido_domicilio)

-- productos -----------------------------------------------------------
create policy productos_ver_todos on public.productos
  for select to anon, authenticated
  using (true);
create policy productos_admin_crear on public.productos
  for insert to authenticated with check (public.es_admin());
create policy productos_admin_actualizar on public.productos
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy productos_admin_borrar on public.productos
  for delete to authenticated using (public.es_admin());

-- user_roles ----------------------------------------------------------
-- Cada quien ve su propio rol; el admin ve a todos.
-- Nadie escribe desde el navegador: altas y bajas van por la Edge Function.
create policy user_roles_ver on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.es_admin());

-- repartidor_cortes ---------------------------------------------------
create policy cortes_admin_todo on public.repartidor_cortes
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy cortes_repartidor_ver on public.repartidor_cortes
  for select to authenticated
  using (repartidor_id = auth.uid());
create policy cortes_repartidor_crear on public.repartidor_cortes
  for insert to authenticated
  with check (public.tiene_rol('repartidor') and repartidor_id = auth.uid());
create policy cortes_repartidor_borrar on public.repartidor_cortes
  for delete to authenticated
  using (repartidor_id = auth.uid());

-- comandas ------------------------------------------------------------
create policy comandas_personal_ver on public.comandas
  for select to authenticated
  using (public.es_admin() or public.tiene_rol('mesero'));
create policy comandas_personal_crear on public.comandas
  for insert to authenticated
  with check (public.es_admin() or public.tiene_rol('mesero'));

commit;
