-- =====================================================================
-- FishMar: reglas del negocio en los pedidos a domicilio
--  - Pedido mínimo de $140 en productos.
--  - Solo se entrega a 5 km de la tienda (19.2992749, -98.9061094).
--  (El horario no se bloquea: los pedidos fuera de horario se aceptan
--   y el personal decide cuándo atenderlos.)
--
-- Cómo aplicarla: Supabase → SQL Editor → pegar todo → Run.
-- Reemplaza la función crear_pedido_domicilio; no toca tablas ni datos.
-- =====================================================================

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
  -- Reglas del negocio (si cambian, actualizar también NEGOCIO en js/utils.js)
  c_tienda_lat  constant float8  := 19.2992749;
  c_tienda_lng  constant float8  := -98.9061094;
  c_radio_km    constant float8  := 5;
  c_minimo      constant numeric := 140;

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
  v_lat       float8;
  v_lng       float8;
  v_dist_km   float8;
begin
  -- Validaciones de los datos del cliente
  p_nombre    := btrim(coalesce(p_nombre, ''));
  p_telefono  := btrim(coalesce(p_telefono, ''));
  p_direccion := btrim(coalesce(p_direccion, ''));
  p_notas     := nullif(btrim(coalesce(p_notas, '')), '');

  if char_length(p_nombre) < 3 or char_length(p_nombre) > 100 then
    raise exception 'Escribe tu nombre.';
  end if;
  if p_telefono !~ '^[0-9]{10,15}$' then
    raise exception 'Escribe tu teléfono de 10 dígitos.';
  end if;
  if char_length(p_direccion) < 8 or char_length(p_direccion) > 300 then
    raise exception 'Escribe tu dirección completa.';
  end if;
  if p_metodo_pago not in ('Efectivo', 'Transferencia') then
    raise exception 'Elige cómo vas a pagar.';
  end if;
  if p_ubicacion !~ '^https://www\.google\.com/maps\?q=-?[0-9.]+,-?[0-9.]+$' then
    raise exception 'Marca tu ubicación en el mapa.';
  end if;
  if p_notas is not null and char_length(p_notas) > 500 then
    raise exception 'Las notas son demasiado largas.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'Tu pedido está vacío.';
  end if;

  -- Zona de entrega: máximo 5 km de la tienda (fórmula de Haversine)
  v_lat := substring(p_ubicacion from 'q=(-?[0-9.]+),')::float8;
  v_lng := substring(p_ubicacion from ',(-?[0-9.]+)$')::float8;
  v_dist_km := 2 * 6371 * asin(sqrt(
      power(sin(radians(v_lat - c_tienda_lat) / 2), 2) +
      cos(radians(c_tienda_lat)) * cos(radians(v_lat)) *
      power(sin(radians(v_lng - c_tienda_lng) / 2), 2)));
  if v_dist_km > c_radio_km then
    raise exception 'Tu ubicación está a % km. Solo entregamos a % km de la tienda.',
      round(v_dist_km::numeric, 1), c_radio_km;
  end if;

  -- Reconstruir los productos con precios reales
  for v_item in select * from jsonb_array_elements(p_items) loop
    select id, nombre, precio, coalesce(tipo_venta, 'pieza') as tipo_venta
      into v_prod
      from public.productos
     where id = (v_item->>'id')::bigint;
    if not found then
      raise exception 'Un producto de tu pedido ya no está disponible. Quítalo e inténtalo de nuevo.';
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

  -- Pedido mínimo
  if v_subtotal < c_minimo then
    raise exception 'El pedido mínimo es de $%. Te faltan $%.',
      c_minimo, to_char(c_minimo - v_subtotal, 'FM999990.00');
  end if;

  -- Mismo redondeo de siempre: hacia arriba al $0.50 más cercano
  v_total := ceil(v_subtotal * 2) / 2;

  -- Folio atómico del día
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
    raise exception 'Límite de pedidos diarios alcanzado (999).';
  end if;
  v_numero := v_prefijo || lpad(v_folio::text, 3, '0');

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
    'items', v_items,
    'distancia_km', round(v_dist_km::numeric, 1)
  );
end;
$$;

revoke all on function public.crear_pedido_domicilio(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.crear_pedido_domicilio(text, text, text, text, text, text, jsonb) to anon, authenticated;
