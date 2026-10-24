// js/mesero.js — toma de pedidos en el restaurante
// Dependencias: supabaseClient (supabase.js), utils.js

let productos = [];
let subcategoriaActual = "";
let pedidosActivos = [];
let pedidoSeleccionadoId = null;
let carritoActual = [];
let meseroId = null;
let textoBusqueda = "";

// Descuento y comisión del cobro
let descuentoValor = 0;
let descuentoTipo = "monto";
let descuentoMonto = 0;
let comisionTarjeta = 0;       // 4.5% sobre el total después del descuento

// Guardado automático
let guardadoPendiente = null;  // { id, items }
let timerGuardado = null;

const MESAS_RAPIDAS = [
  "Mesa 1", "Mesa 2", "Mesa 3", "Mesa 4", "Mesa 5", "Mesa 6",
  "Mesa 7", "Mesa 8", "Mesa 9", "Mesa 10", "Barra", "Para llevar"
];

const $ = (id) => document.getElementById(id);

// ======================
// SESIÓN
// ======================
async function verificarSesionMesero() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data?.user) {
    window.location.href = "admin.html";
    return false;
  }
  const { data: rolData, error: rolError } = await supabaseClient
    .from("user_roles")
    .select("role, full_name")
    .eq("user_id", data.user.id)
    .single();
  if (rolError || !rolData || rolData.role !== "mesero") {
    showToast("Esta pantalla es solo para meseros.");
    window.location.href = "admin.html";
    return false;
  }
  meseroId = data.user.id;
  $("saludoMesero").textContent = `Hola, ${rolData.full_name || "mesero"}`;
  return true;
}

async function logout() {
  await guardarPendiente();
  await supabaseClient.auth.signOut();
  window.location.href = "admin.html";
}

// ======================
// UTILIDADES
// ======================
function calcularTotalPedido(items) {
  if (!items) return 0;
  return items.reduce((sum, i) => sum + Number(i.precio) * Number(i.qty), 0);
}

function contarPiezas(items) {
  return (items || []).reduce((n, i) => n + (i.tipo_venta === "granel" ? 1 : Number(i.qty)), 0);
}

function formatoCantidad(item) {
  return item.tipo_venta === "granel"
    ? `${Number(item.qty).toFixed(2)} kg`
    : `${Number(item.qty)}`;
}

function hace(fechaIso) {
  const min = Math.floor((Date.now() - new Date(fechaIso).getTime()) / 60000);
  if (isNaN(min)) return "";
  if (min < 1) return "recién abierta";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h ${min % 60} min`;
}

function abrirHoja(id) {
  $(id).style.display = "block";
  document.body.classList.add("no-scroll");
}

function cerrarHoja(id) {
  $(id).style.display = "none";
  if (![...document.querySelectorAll(".modal")].some(m => m.style.display === "block")) {
    document.body.classList.remove("no-scroll");
  }
}

// ======================
// PRODUCTOS (solo Marisquería)
// ======================
async function cargarProductosMesero() {
  const { data, error } = await supabaseClient
    .from("productos")
    .select("*")
    .eq("categoria", "Marisquería")
    .order("id");
  if (error) {
    handleError(error, "No se pudieron cargar los productos. Revisa tu internet.");
    return;
  }
  productos = data || [];
  renderSubcategorias();
  renderProductosMesero();
}

function renderSubcategorias() {
  const subcats = [...new Set(productos.map(p => p.subcategoria).filter(Boolean))];
  const bar = $("subcategoriaBarMesero");
  bar.innerHTML = [""].concat(subcats).map(s => `
    <button class="chip ${s === subcategoriaActual ? "is-active" : ""}" data-sub="${escapeHtml(s)}">
      ${s ? escapeHtml(s) : "Todo"}
    </button>`).join("");
  bar.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      subcategoriaActual = btn.dataset.sub;
      renderSubcategorias();
      renderProductosMesero();
    });
  });
}

function renderProductosMesero() {
  const cont = $("productosMesero");
  let filtrados = productos;
  if (subcategoriaActual) filtrados = filtrados.filter(p => p.subcategoria === subcategoriaActual);
  const busq = textoBusqueda.trim().toLowerCase();
  if (busq) filtrados = filtrados.filter(p => p.nombre.toLowerCase().includes(busq));

  if (!filtrados.length) {
    cont.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔎</div>
        <div class="empty-title">No encontramos ese producto</div>
        <p class="mt-8">Prueba con otra palabra o elige "Todo".</p>
      </div>`;
    return;
  }

  cont.innerHTML = filtrados.map(p => {
    const esGranel = p.tipo_venta === "granel";
    const img = p.imagen_url
      ? `<img class="thumb" src="${safeUrl(p.imagen_url)}" alt="" loading="lazy">`
      : `<div class="thumb thumb-empty">🦐</div>`;
    const kgHtml = esGranel ? `
      <div class="kg-row">
        <div class="stepper">
          <button type="button" onclick="ajustarKgMesero(${p.id}, -0.25)" aria-label="Menos">−</button>
          <input type="number" id="kg-${p.id}" value="0.5" step="0.05" min="0.05" inputmode="decimal" aria-label="Kilos">
          <button type="button" onclick="ajustarKgMesero(${p.id}, 0.25)" aria-label="Más">+</button>
        </div>
        <span class="small muted">kg</span>
      </div>` : "";
    return `
      <div class="menu-item">
        ${img}
        <div class="grow">
          <div class="mi-name">${escapeHtml(p.nombre)}</div>
          <div class="mi-price">$${Number(p.precio).toFixed(2)} ${esGranel ? "por kg" : ""}</div>
          ${kgHtml}
        </div>
        <button class="add-btn" id="add-${p.id}" onclick="agregarAlPedidoActual(${p.id})" aria-label="Agregar ${escapeHtml(p.nombre)}">
          <i class="fa-solid fa-plus"></i>
        </button>
      </div>`;
  }).join("");
}

function ajustarKgMesero(id, delta) {
  const input = $(`kg-${id}`);
  if (!input) return;
  let kg = (parseFloat(input.value) || 0) + delta;
  if (kg < 0.25) kg = 0.25;
  input.value = Math.round(kg * 100) / 100;
}

// ======================
// MESAS ABIERTAS
// ======================
async function cargarPedidosActivos() {
  const { data, error } = await supabaseClient
    .from("pedidos")
    .select("*")
    .eq("tipo_pedido", "local")
    .eq("estado_local", "abierto")
    .order("created_at", { ascending: true });

  if (error) {
    handleError(error, "No se pudieron cargar las mesas. Revisa tu internet.");
    return;
  }
  pedidosActivos = data || [];

  // Si la mesa elegida ya no está abierta (la cerraron en otro celular)
  if (pedidoSeleccionadoId && !pedidosActivos.some(p => p.id === pedidoSeleccionadoId)) {
    showToast("Esta mesa ya se cerró en otro celular.");
    deseleccionarPedido();
  }

  // Mantener lo que aún no se termina de guardar
  if (guardadoPendiente) {
    const p = pedidosActivos.find(x => x.id === guardadoPendiente.id);
    if (p) p.items = guardadoPendiente.items;
  }
  renderListaPedidos();
}

function renderListaPedidos() {
  const cont = $("listaPedidosActivos");
  const n = pedidosActivos.length;
  $("resumenMesas").textContent = n
    ? `${n} ${n === 1 ? "mesa abierta" : "mesas abiertas"} · toca una para agregarle productos`
    : "No hay mesas abiertas. Abre una para empezar.";

  const nueva = `
    <button class="table-tile is-new" onclick="abrirModalNuevaMesa()">
      <i class="fa-solid fa-plus"></i>
      Abrir mesa
    </button>`;

  cont.innerHTML = nueva + pedidosActivos.map(ped => {
    const items = ped.id === pedidoSeleccionadoId ? carritoActual : (ped.items || []);
    const total = calcularTotalPedido(items);
    const piezas = contarPiezas(items);
    return `
      <button class="table-tile ${ped.id === pedidoSeleccionadoId ? "is-active" : ""}" onclick="seleccionarPedido(${ped.id})">
        <div>
          <div class="t-name">${escapeHtml(ped.mesa || "Sin nombre")}</div>
          <div class="t-meta">${piezas} ${piezas === 1 ? "producto" : "productos"} · ${hace(ped.created_at)}</div>
        </div>
        <div class="t-total">$${total.toFixed(2)}</div>
      </button>`;
  }).join("");
}

async function seleccionarPedido(id) {
  const pedido = pedidosActivos.find(p => p.id === id);
  if (!pedido) return;
  await guardarPendiente();               // no perder cambios de la mesa anterior
  pedidoSeleccionadoId = id;
  carritoActual = pedido.items ? JSON.parse(JSON.stringify(pedido.items)) : [];
  $("mesaActual").textContent = pedido.mesa || "Sin nombre";
  $("barraMesa").textContent = pedido.mesa || "Sin nombre";
  $("carritoMesa").textContent = pedido.mesa || "Sin nombre";
  $("seccionProductos").hidden = false;
  $("ayudaSinMesa").hidden = true;
  $("barraPedido").hidden = false;
  setEstadoGuardado("listo");
  renderCarritoActual();
  renderListaPedidos();
  $("seccionProductos").scrollIntoView({ behavior: "smooth", block: "start" });
}

function deseleccionarPedido() {
  pedidoSeleccionadoId = null;
  carritoActual = [];
  $("seccionProductos").hidden = true;
  $("ayudaSinMesa").hidden = false;
  $("barraPedido").hidden = true;
  cerrarHoja("modalCarrito");
  cerrarHoja("modalCerrarPedido");
  renderListaPedidos();
}

function irAMesas() {
  $("seccionMesas").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Abrir mesa nueva ----------
function abrirModalNuevaMesa() {
  const ocupadas = new Set(pedidosActivos.map(p => (p.mesa || "").toLowerCase()));
  $("mesasRapidas").innerHTML = MESAS_RAPIDAS.map(m => {
    const ocupada = ocupadas.has(m.toLowerCase());
    return `
      <button class="btn ${ocupada ? "btn-outline is-disabled" : "btn-soft"}" ${ocupada ? "disabled" : ""}
              onclick="crearNuevoPedido('${m}')">
        <span>${m}${ocupada ? "<small>ocupada</small>" : ""}</span>
      </button>`;
  }).join("");
  $("nombreMesaLibre").value = "";
  abrirHoja("modalNuevaMesa");
}

function cerrarModalNuevaMesa() {
  cerrarHoja("modalNuevaMesa");
}

function crearMesaDesdeTexto() {
  const nombre = $("nombreMesaLibre").value.trim();
  if (!nombre) {
    showToast("Toca una mesa o escribe un nombre.");
    return;
  }
  crearNuevoPedido(nombre);
}

async function crearNuevoPedido(mesa) {
  if (pedidosActivos.some(p => (p.mesa || "").toLowerCase() === mesa.toLowerCase())) {
    showToast(`${mesa} ya está abierta.`);
    return;
  }
  const nuevoPedido = {
    tipo_pedido: "local",
    mesa,
    mesero_id: meseroId,
    estado_local: "abierto",
    items: [],
    total: 0,
    nombre: "Cliente local",
    telefono: "0000000000",
    direccion: "Local",
    metodo_pago: null
  };
  const { data, error } = await supabaseClient.from("pedidos").insert([nuevoPedido]).select();
  if (error) {
    handleError(error, "No se pudo abrir la mesa. Inténtalo de nuevo.");
    return;
  }
  cerrarModalNuevaMesa();
  showToast(`${mesa} abierta`, "success");
  await cargarPedidosActivos();
  seleccionarPedido(data[0].id);
}

// ======================
// PEDIDO DE LA MESA
// ======================
function agregarAlPedidoActual(productoId) {
  if (!pedidoSeleccionadoId) {
    showToast("Primero elige o abre una mesa.");
    irAMesas();
    return;
  }
  const producto = productos.find(p => p.id === productoId);
  if (!producto) return;

  let cantidad = 1;
  if (producto.tipo_venta === "granel") {
    cantidad = parseFloat($(`kg-${productoId}`)?.value) || 0.5;
    if (cantidad <= 0) cantidad = 0.5;
  }
  const existente = carritoActual.find(item => item.id === productoId);
  if (existente) {
    existente.qty = Math.round((Number(existente.qty) + cantidad) * 100) / 100;
  } else {
    carritoActual.push({
      id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      tipo_venta: producto.tipo_venta,
      qty: cantidad
    });
  }

  // Confirmación visual en el botón y en la barra
  const btn = $(`add-${productoId}`);
  if (btn) {
    btn.classList.add("added");
    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => {
      btn.classList.remove("added");
      btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    }, 700);
  }
  const bar = $("barBtn");
  bar.classList.remove("bump");
  void bar.offsetWidth;
  bar.classList.add("bump");

  cambioEnCarrito();
}

function cambiarCantidad(id, delta) {
  const item = carritoActual.find(i => i.id === id);
  if (!item) return;
  let nueva = Number(item.qty) + delta;
  if (nueva <= 0.001) {
    carritoActual = carritoActual.filter(i => i.id !== id);
  } else {
    item.qty = item.tipo_venta === "granel" ? Math.round(nueva * 100) / 100 : Math.round(nueva);
  }
  cambioEnCarrito();
}

function eliminarItem(id) {
  carritoActual = carritoActual.filter(i => i.id !== id);
  cambioEnCarrito();
}

function cambioEnCarrito() {
  renderCarritoActual();
  renderListaPedidos();
  programarGuardado();
}

function renderCarritoActual() {
  const cont = $("carritoActual");
  const total = calcularTotalPedido(carritoActual);
  const piezas = contarPiezas(carritoActual);

  $("totalActual").textContent = total.toFixed(2);
  $("totalCarritoSheet").textContent = total.toFixed(2);
  $("barraCantidad").textContent = piezas;

  if (!carritoActual.length) {
    cont.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🧾</div>
        <div class="empty-title">Esta mesa no tiene productos</div>
        <p class="mt-8">Agrégalos con el botón <strong>+</strong> de cada platillo.</p>
      </div>`;
    return;
  }

  cont.innerHTML = carritoActual.map(item => {
    const esGranel = item.tipo_venta === "granel";
    const paso = esGranel ? 0.25 : 1;
    const lineTotal = Number(item.precio) * Number(item.qty);
    return `
      <div class="cart-line">
        <div class="cl-top">
          <div>
            <div class="cl-name">${escapeHtml(item.nombre)}</div>
            <div class="cl-unit">$${Number(item.precio).toFixed(2)} ${esGranel ? "por kg" : "c/u"}</div>
          </div>
          <div class="cl-total">$${lineTotal.toFixed(2)}</div>
        </div>
        <div class="cl-bottom">
          <div class="stepper">
            <button type="button" onclick="cambiarCantidad(${item.id}, -${paso})" aria-label="Quitar uno">−</button>
            <span class="stepper-value">${formatoCantidad(item)}</span>
            <button type="button" onclick="cambiarCantidad(${item.id}, ${paso})" aria-label="Agregar uno">+</button>
          </div>
          <button class="btn btn-text danger" onclick="eliminarItem(${item.id})"><i class="fa-solid fa-trash-can"></i> Quitar</button>
        </div>
      </div>`;
  }).join("");
}

function abrirCarritoMesero() {
  renderCarritoActual();
  abrirHoja("modalCarrito");
}

function cerrarCarritoMesero() {
  cerrarHoja("modalCarrito");
}

// ---------- Guardado automático ----------
function setEstadoGuardado(estado) {
  const textos = {
    listo: "Se guarda automáticamente",
    guardando: "Guardando…",
    guardado: "✓ Guardado",
    error: "⚠ No se guardó. Revisa tu internet."
  };
  $("estadoGuardado").textContent = textos[estado];
  $("estadoGuardadoSheet").textContent = textos[estado];
}

function programarGuardado() {
  if (!pedidoSeleccionadoId) return;
  guardadoPendiente = { id: pedidoSeleccionadoId, items: JSON.parse(JSON.stringify(carritoActual)) };
  setEstadoGuardado("guardando");
  clearTimeout(timerGuardado);
  timerGuardado = setTimeout(guardarPendiente, 700);
}

async function guardarPendiente() {
  clearTimeout(timerGuardado);
  if (!guardadoPendiente) return true;
  const { id, items } = guardadoPendiente;
  guardadoPendiente = null;
  const total = calcularTotalPedido(items);

  const { error } = await supabaseClient
    .from("pedidos")
    .update({ items, total })
    .eq("id", id);

  if (error) {
    // Volver a dejarlo pendiente para reintentar con el siguiente cambio
    if (!guardadoPendiente) guardadoPendiente = { id, items };
    setEstadoGuardado("error");
    handleError(error, "No se pudo guardar el pedido. Revisa tu internet.");
    return false;
  }
  const p = pedidosActivos.find(x => x.id === id);
  if (p) { p.items = items; p.total = total; }
  if (!guardadoPendiente && id === pedidoSeleccionadoId) setEstadoGuardado("guardado");
  return true;
}

// Al salir de la app o bloquear el celular, guardar lo pendiente
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") guardarPendiente();
});

// ======================
// COMANDA PARA COCINA
// ======================
async function imprimirComanda() {
  if (!pedidoSeleccionadoId || carritoActual.length === 0) {
    showToast("La mesa no tiene productos para la comanda.");
    return;
  }
  await guardarPendiente();
  const pedido = pedidosActivos.find(p => p.id === pedidoSeleccionadoId);
  const mesa = pedido?.mesa || "Sin nombre";
  const filas = carritoActual.map(item => `
      <tr><td class="q">${escapeHtml(formatoCantidad(item))}</td><td>${escapeHtml(item.nombre)}</td></tr>`).join("");

  abrirVentanaImpresion(`Comanda ${mesa}`, `
    <h1>COMANDA</h1>
    <p class="big">${escapeHtml(mesa)}</p>
    <p>Pedido #${pedidoSeleccionadoId} · ${new Date().toLocaleString("es-MX", { timeZone: ZONA_MX, hour12: true })}</p>
    <hr>
    <table>${filas}</table>
    <hr>`);

  await supabaseClient.from("comandas").insert([{
    pedido_id: pedidoSeleccionadoId,
    productos: carritoActual
  }]);
}

function abrirVentanaImpresion(titulo, cuerpo) {
  const ventana = window.open("", "_blank");
  if (!ventana) {
    showToast("Tu navegador bloqueó la ventana de impresión. Permite las ventanas emergentes.");
    return;
  }
  ventana.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(titulo)}</title>
    <style>
      body { font-family: "Courier New", monospace; width: 72mm; margin: 0 auto; padding: 8px; color: #000; }
      h1 { font-size: 18px; text-align: center; margin: 4px 0; }
      .big { font-size: 22px; font-weight: bold; text-align: center; margin: 4px 0; }
      p { margin: 2px 0; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      td { padding: 3px 0; vertical-align: top; }
      td.q { width: 30%; font-weight: bold; }
      td.r { text-align: right; white-space: nowrap; }
      hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
      .tot td { font-weight: bold; font-size: 16px; }
      .center { text-align: center; }
    </style></head><body>${cuerpo}
    <script>window.onload = function () { window.print(); };<\/script>
    </body></html>`);
  ventana.document.close();
}

// ======================
// COBRAR (descuento y comisión por tarjeta)
// ======================
function getMetodoCierre() {
  return document.querySelector('input[name="metodoPagoCierre"]:checked')?.value || "Efectivo";
}

async function abrirModalCierre() {
  if (!pedidoSeleccionadoId) return;
  if (!carritoActual.length) {
    showToast("La mesa no tiene productos. Si no consumieron nada, usa \"Cancelar mesa\".");
    return;
  }
  await guardarPendiente();
  const pedido = pedidosActivos.find(p => p.id === pedidoSeleccionadoId);
  const subtotal = calcularTotalPedido(carritoActual);
  $("cerrarMesa").textContent = pedido?.mesa || "Sin nombre";
  $("cerrarSubtotal").textContent = subtotal.toFixed(2);

  descuentoValor = 0;
  descuentoTipo = "monto";
  descuentoMonto = 0;
  comisionTarjeta = 0;
  $("descuentoValor").value = "";
  $("descuentoTipo").value = "monto";
  document.querySelector('input[name="metodoPagoCierre"][value="Efectivo"]').checked = true;
  actualizarInfoDescuentoCierre();
  cerrarHoja("modalCarrito");
  abrirHoja("modalCerrarPedido");
}

// Calcula descuento, comisión y total final; devuelve los montos
function calcularCobro() {
  const subtotal = calcularTotalPedido(carritoActual);
  let descuento = 0;
  if (descuentoValor > 0) {
    descuento = descuentoTipo === "porcentaje" ? subtotal * (descuentoValor / 100) : descuentoValor;
    if (descuento > subtotal) descuento = subtotal;
  }
  const conDescuento = subtotal - descuento;
  const comision = getMetodoCierre() === "Tarjeta" ? conDescuento * 0.045 : 0;
  const total = roundUpToHalf(conDescuento + comision);
  return { subtotal, descuento, comision, total };
}

function actualizarInfoDescuentoCierre() {
  const { descuento, comision, total } = calcularCobro();
  descuentoMonto = descuento;
  comisionTarjeta = comision;
  $("montoDescuento").textContent = descuento.toFixed(2);
  $("montoComision").textContent = comision.toFixed(2);
  $("infoComision").hidden = comision <= 0;
  $("totalConDescuento").textContent = total.toFixed(2);
}

function aplicarDescuentoCierre() {
  const valor = parseFloat($("descuentoValor").value);
  if (isNaN(valor) || valor <= 0) {
    showToast("Escribe una cantidad válida para el descuento.");
    return;
  }
  descuentoValor = valor;
  descuentoTipo = $("descuentoTipo").value;
  actualizarInfoDescuentoCierre();
}

function quitarDescuentoCierre() {
  descuentoValor = 0;
  $("descuentoValor").value = "";
  actualizarInfoDescuentoCierre();
}

function cerrarModalCierre() {
  cerrarHoja("modalCerrarPedido");
}

async function confirmarCierre() {
  const btn = $("btnConfirmarCierre");
  btn.disabled = true;
  try {
    clearTimeout(timerGuardado);
    guardadoPendiente = null;   // el cierre guarda los productos finales
    const metodo = getMetodoCierre();
    const { subtotal, descuento, comision, total } = calcularCobro();
    const pedido = pedidosActivos.find(p => p.id === pedidoSeleccionadoId);

    const payload = {
      estado_local: "cerrado",
      fecha_cierre: new Date().toISOString(),
      metodo_pago_local: metodo,
      total,
      items: carritoActual,
      descuento_valor: descuentoValor,
      descuento_tipo: descuentoTipo,
      descuento_monto: descuento,
      comision_tarjeta: comision
    };

    const { error } = await supabaseClient.from("pedidos").update(payload).eq("id", pedidoSeleccionadoId);
    if (error) {
      handleError(error, "No se pudo cerrar la mesa. Inténtalo de nuevo.");
      return;
    }

    showToast(`${pedido?.mesa || "Mesa"} cobrada: $${total.toFixed(2)}`, "success");
    imprimirTicketCliente(pedido?.mesa, carritoActual, subtotal, descuento, comision, total, metodo);
    deseleccionarPedido();
    await cargarPedidosActivos();
    irAMesas();
  } finally {
    btn.disabled = false;
  }
}

function imprimirTicketCliente(mesa, items, subtotal, descuento, comision, total, metodo) {
  const filas = items.map(i => `
      <tr>
        <td class="q">${escapeHtml(formatoCantidad(i))}</td>
        <td>${escapeHtml(i.nombre)}</td>
        <td class="r">$${(Number(i.precio) * Number(i.qty)).toFixed(2)}</td>
      </tr>`).join("");
  abrirVentanaImpresion("Ticket", `
    <h1>🐟 FISH-MAR</h1>
    <p class="center">Pescados y Mariscos</p>
    <p class="center">${escapeHtml(mesa || "")} · ${new Date().toLocaleString("es-MX", { timeZone: ZONA_MX, hour12: true })}</p>
    <hr>
    <table>${filas}</table>
    <hr>
    <table>
      <tr><td>Subtotal</td><td class="r">$${subtotal.toFixed(2)}</td></tr>
      ${descuento > 0 ? `<tr><td>Descuento</td><td class="r">-$${descuento.toFixed(2)}</td></tr>` : ""}
      ${comision > 0 ? `<tr><td>Comisión tarjeta 4.5%</td><td class="r">+$${comision.toFixed(2)}</td></tr>` : ""}
      <tr class="tot"><td>TOTAL</td><td class="r">$${total.toFixed(2)}</td></tr>
    </table>
    <p>Pago: ${escapeHtml(metodo)}</p>
    <hr>
    <p class="center">¡Gracias por su visita!</p>`);
}

// ======================
// CANCELAR MESA
// ======================
async function anularPedido() {
  if (!pedidoSeleccionadoId) return;
  const pedido = pedidosActivos.find(p => p.id === pedidoSeleccionadoId);
  if (!confirm(`¿Cancelar ${pedido?.mesa || "esta mesa"}? Se borrarán sus productos y no se cobrará.`)) return;
  clearTimeout(timerGuardado);
  guardadoPendiente = null;
  const { error } = await supabaseClient
    .from("pedidos")
    .update({ estado_local: "anulado" })
    .eq("id", pedidoSeleccionadoId);
  if (error) {
    handleError(error, "No se pudo cancelar la mesa.");
    return;
  }
  showToast("Mesa cancelada", "success");
  deseleccionarPedido();
  await cargarPedidosActivos();
  irAMesas();
}

// ======================
// EVENTOS
// ======================
$("buscadorProductos").addEventListener("input", (e) => {
  textoBusqueda = e.target.value;
  renderProductosMesero();
});

document.querySelectorAll('input[name="metodoPagoCierre"]').forEach(r =>
  r.addEventListener("change", actualizarInfoDescuentoCierre)
);

// ======================
// INICIO
// ======================
(async function init() {
  const ok = await verificarSesionMesero();
  if (!ok) return;
  renderListaPedidos();
  await Promise.all([cargarProductosMesero(), cargarPedidosActivos()]);

  // Tiempo real: si otro mesero abre o cierra mesas
  supabaseClient.channel("pedidos-local")
    .on("postgres_changes", { event: "*", schema: "public", table: "pedidos", filter: "tipo_pedido=eq.local" }, () => {
      cargarPedidosActivos();
    })
    .subscribe();

  // Actualizar los "hace X min" de las mesas
  setInterval(renderListaPedidos, 60000);
})();
