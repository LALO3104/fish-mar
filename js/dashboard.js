// js/dashboard.js — panel de administración
// Dependencias: supabaseClient (supabase.js), utils.js, Chart.js

let pedidosCache = [];           // Pedidos a domicilio (para la lista)
let todosPedidosCache = [];      // Domicilio + mesas cobradas (para ventas)
let productosCache = [];
let repartidoresCache = [];
let ventasLocalCache = [];
let pedidoLocalAEliminar = null;
let productoEditandoId = null;

// Filtros
let filtroEstadoActual = "Pendientes";
let categoriaProductoFilter = "all";
let periodoActual = "hoy";
let fechaInicioPersonalizado = null;
let fechaFinPersonalizado = null;

// Para no redibujar si nada cambió (y no cerrar listas abiertas)
let firmaPedidos = "";
let idsConocidos = null;

// Descuento en edición de pedido
let pedidoEditando = null;
let productosEditables = [];
let descuentoValorActual = 0;
let descuentoTipoActual = "monto";

// Gráficas
let chartIngresos = null;
let chartVentasDia = null;

// Super admin
let esSuperAdmin = false;
let listaUsuarios = [];

let pedidoWhatsApp = null;

const audio = new Audio("assets/notification.mp3");
const $ = (id) => document.getElementById(id);

// ======================
// UTILIDADES
// ======================
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

function reproducirNotificacion() {
  audio.play().catch(() => {});
  const alerta = document.createElement("div");
  alerta.className = "alerta-pedido";
  alerta.innerHTML = '<i class="fa-solid fa-bell"></i> ¡Llegó un pedido nuevo!';
  document.body.appendChild(alerta);
  setTimeout(() => alerta.remove(), 4000);
}

function getRepartidorTextoPedido(p) {
  if (p.repartidor_nombre && p.repartidor_nombre.trim()) return p.repartidor_nombre;
  if (p.repartidor_id) {
    const rep = repartidoresCache.find(r => r.user_id === p.repartidor_id);
    if (rep?.full_name) return rep.full_name;
  }
  return "Sin asignar";
}

function cantidadTexto(item) {
  return item.tipo_venta === "granel" ? `${Number(item.qty).toFixed(2)} kg` : `${Number(item.qty)}×`;
}

// ======================
// SESIÓN
// ======================
async function verificarSesionAdmin() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data?.user) {
    window.location.href = "admin.html";
    return false;
  }
  const { data: rolData, error: rolError } = await supabaseClient
    .from("user_roles")
    .select("role, is_superadmin")
    .eq("user_id", data.user.id)
    .single();
  if (rolError || !rolData || (rolData.role !== "admin" && rolData.role !== "superadmin" && !rolData.is_superadmin)) {
    showToast("Esta pantalla es solo para administradores.");
    window.location.href = "admin.html";
    return false;
  }
  esSuperAdmin = rolData.is_superadmin === true;
  return true;
}

function logout() {
  supabaseClient.auth.signOut();
  window.location.href = "admin.html";
}

// ======================
// PEDIDOS A DOMICILIO
// ======================
async function cargarRepartidores() {
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("user_id, full_name, role")
    .eq("role", "repartidor")
    .order("full_name", { ascending: true });
  if (error) {
    handleError(error, "No se pudieron cargar los repartidores.");
    return;
  }
  repartidoresCache = data || [];
}

async function cargarPedidos({ forzar = false } = {}) {
  const [online, local] = await Promise.all([
    supabaseClient.from("pedidos").select("*").neq("tipo_pedido", "local").order("created_at", { ascending: false }),
    supabaseClient.from("pedidos").select("*").eq("tipo_pedido", "local").eq("estado_local", "cerrado")
  ]);
  if (online.error || local.error) {
    handleError(online.error || local.error, "No se pudieron cargar los pedidos. Revisa tu internet.");
    return;
  }

  pedidosCache = online.data || [];
  todosPedidosCache = [...pedidosCache, ...(local.data || [])];

  // Aviso de pedido nuevo
  const ids = new Set(pedidosCache.map(p => p.id));
  if (idsConocidos && pedidosCache.some(p => !idsConocidos.has(p.id))) reproducirNotificacion();
  idsConocidos = ids;

  // Redibujar solo si algo cambió
  const firma = JSON.stringify(todosPedidosCache.map(p =>
    [p.id, p.estado, p.repartidor_id, p.total, p.descuento_monto, (p.items || []).length, p.notas]));
  if (!forzar && firma === firmaPedidos) return;
  firmaPedidos = firma;

  renderPedidosFiltrados();
  actualizarMetricasPeriodo();
}

function pedidosDelDia() {
  const fecha = $("filtroFecha").value;
  return fecha ? pedidosCache.filter(p => getFechaPedidoFiltro(p) === fecha) : pedidosCache;
}

function renderPedidosFiltrados() {
  const base = pedidosDelDia();

  // Conteos en los filtros
  const conteos = { Pendientes: base.filter(p => p.estado !== "Entregado").length };
  ESTADOS_PEDIDO.forEach(e => { conteos[e.valor] = base.filter(p => p.estado === e.valor).length; });
  document.querySelectorAll("[data-count]").forEach(el => { el.textContent = conteos[el.dataset.count] ?? 0; });

  let lista = base;
  if (filtroEstadoActual === "Pendientes") lista = base.filter(p => p.estado !== "Entregado");
  else if (filtroEstadoActual !== "Todos") lista = base.filter(p => p.estado === filtroEstadoActual);

  const fecha = $("filtroFecha").value;
  $("resumenPedidos").textContent = `${lista.length} ${lista.length === 1 ? "pedido" : "pedidos"}` +
    (fecha ? (fecha === getHoy() ? " · hoy" : ` · ${fecha}`) : " · todos los días");

  renderPedidos(lista);
  renderRepartidores(base);
}

function renderPedidos(lista) {
  const cont = $("pedidos");
  if (!lista.length) {
    const vacio = filtroEstadoActual === "Pendientes"
      ? `<div class="empty-icon">🎉</div><div class="empty-title">No hay pedidos pendientes</div>
         <p class="mt-8">Cuando llegue uno nuevo sonará un aviso.</p>`
      : `<div class="empty-icon">📭</div><div class="empty-title">No hay pedidos con este filtro</div>`;
    cont.innerHTML = `<div class="empty">${vacio}</div>`;
    return;
  }

  cont.innerHTML = lista.map(p => {
    const info = estadoInfo(p.estado);
    const clases = getEstadoClass(p.estado, p.created_at || p.fecha);
    const numero = escapeHtml(p.numero_pedido || `#${p.id}`);
    const items = Array.isArray(p.items) ? p.items : [];
    const actual = ESTADOS_PEDIDO.findIndex(e => e.valor === p.estado);

    const pasos = ESTADOS_PEDIDO.map((e, i) => `
      <button class="step ${i < actual ? "is-done" : ""} ${i === actual ? `is-current ${e.clase}` : ""}"
              onclick="cambiarEstado(${p.id}, '${e.valor}')" ${i === actual ? 'aria-current="step"' : ""}>
        <i class="fa-solid ${i < actual ? "fa-check" : e.icono}"></i>${e.etiqueta}
      </button>`).join("");

    const opcionesRep = `<option value="">Sin asignar</option>` + repartidoresCache.map(r => `
      <option value="${escapeHtml(r.user_id)}" ${r.user_id === p.repartidor_id ? "selected" : ""}>${escapeHtml(r.full_name || "Sin nombre")}</option>`).join("");

    const itemsHtml = items.length
      ? items.map(item => `<li><span><span class="qty">${escapeHtml(cantidadTexto(item))}</span>${escapeHtml(item.nombre)}</span>
          <span>$${(Number(item.precio) * Number(item.qty)).toFixed(2)}</span></li>`).join("")
      : "<li>Sin detalle de productos</li>";

    const descuentoHtml = Number(p.descuento_monto) > 0
      ? `<div class="row-between small mt-8"><span class="muted">Descuento ${p.descuento_tipo === "porcentaje" ? `(${Number(p.descuento_valor)}%)` : ""}</span>
         <span>−$${Number(p.descuento_monto).toFixed(2)}</span></div>` : "";

    return `
      <article class="order ${clases}">
        <div class="order-head">
          <div class="grow">
            <div class="order-name">${escapeHtml(p.nombre)}</div>
            <div class="order-meta">Pedido ${numero} · ${escapeHtml(fechaHoraCortaMX(p.created_at))}</div>
            ${p.estado !== "Entregado" ? `<div class="order-wait"><i class="fa-regular fa-clock"></i> ${escapeHtml(calcularTiempoPedido(p))}</div>` : ""}
            ${llegoFueraDeHorario(p) ? `<div class="mt-8"><span class="badge off-hours no-dot"><i class="fa-solid fa-moon"></i> Llegó fuera de horario</span></div>` : ""}
          </div>
          <span class="badge ${info.clase}">${info.etiqueta}</span>
        </div>
        <div class="order-body">
          <div class="info-list">
            <div class="info"><i class="fa-solid fa-phone"></i><a href="tel:${escapeHtml(p.telefono)}">${escapeHtml(p.telefono)}</a></div>
            <div class="info"><i class="fa-solid fa-location-dot"></i><span>${escapeHtml(p.direccion)}</span></div>
            <div class="info"><i class="fa-solid fa-wallet"></i><span>${escapeHtml(p.metodo_pago || "—")}</span></div>
          </div>
          ${p.notas ? `<div class="note"><i class="fa-solid fa-note-sticky"></i><span>${escapeHtml(p.notas)}</span></div>` : ""}
          <details class="more">
            <summary>Productos (${items.length})</summary>
            <ul class="items">${itemsHtml}</ul>
            ${descuentoHtml}
          </details>
          <div class="total-line"><span class="muted strong">Total</span><span class="amount">${formatoDinero(p.total)}</span></div>

          <div class="steps">${pasos}</div>

          <div class="assign">
            <label for="rep-${p.id}"><i class="fa-solid fa-motorcycle"></i> Repartidor</label>
            <select id="rep-${p.id}" class="select" onchange="asignarRepartidor(${p.id}, this.value)">${opcionesRep}</select>
          </div>

          <div class="btn-grid">
            <a class="btn btn-outline" href="${safeUrl(p.ubicacion)}" target="_blank" rel="noopener"><i class="fa-solid fa-map-location-dot"></i> Mapa</a>
            <button class="btn btn-outline" onclick="abrirModalWhatsApp(${p.id})"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
            <button class="btn btn-outline" onclick="imprimirPedido(${p.id})"><i class="fa-solid fa-print"></i> Ticket</button>
            <button class="btn btn-outline" onclick="abrirModalEditarPedido(${p.id})"><i class="fa-solid fa-pen"></i> Editar</button>
          </div>
          <button class="btn btn-text danger" onclick="eliminarPedido(${p.id})"><i class="fa-solid fa-trash-can"></i> Borrar pedido</button>
        </div>
      </article>`;
  }).join("");
}

async function eliminarPedido(id) {
  const p = pedidosCache.find(x => x.id === id);
  if (!confirm(`¿Borrar el pedido de ${p?.nombre || "este cliente"}? No se puede deshacer.`)) return;
  const { error } = await supabaseClient.from("pedidos").delete().eq("id", id);
  if (error) {
    handleError(error, "No se pudo borrar el pedido.");
    return;
  }
  showToast("Pedido borrado", "success");
  cargarPedidos({ forzar: true });
}

async function cambiarEstado(id, nuevoEstado) {
  const { error } = await supabaseClient.from("pedidos").update({ estado: nuevoEstado }).eq("id", id);
  if (error) {
    handleError(error, "No se pudo cambiar el estado.");
    return;
  }
  showToast(`Estado: ${estadoInfo(nuevoEstado).etiqueta}`, "success");
  cargarPedidos({ forzar: true });
}

async function asignarRepartidor(id, repartidorId) {
  const repartidor = repartidoresCache.find(r => r.user_id === repartidorId);
  const payload = {
    repartidor_id: repartidorId || null,
    repartidor_nombre: repartidor ? (repartidor.full_name || "") : ""
  };
  const { error } = await supabaseClient.from("pedidos").update(payload).eq("id", id);
  if (error) {
    handleError(error, "No se pudo asignar el repartidor.");
    return;
  }
  showToast(repartidor ? `Asignado a ${repartidor.full_name}` : "Repartidor quitado", "success");
  cargarPedidos({ forzar: true });
}

function renderRepartidores(lista) {
  const cont = $("resumenRepartidores");
  const resumen = {};
  lista.filter(p => p.metodo_pago === "Efectivo" && p.estado === "Entregado").forEach(p => {
    const nombre = getRepartidorTextoPedido(p);
    if (nombre === "Sin asignar") return;
    resumen[nombre] = (resumen[nombre] || 0) + Number(p.total);
  });
  const entradas = Object.entries(resumen);
  if (!entradas.length) {
    cont.innerHTML = `<div class="empty-cart">Todavía no hay cobros en efectivo entregados.</div>`;
    return;
  }
  cont.innerHTML = entradas.map(([nombre, total]) => `
    <div class="list-item">
      <i class="fa-solid fa-motorcycle muted"></i>
      <div class="grow title">${escapeHtml(nombre)}</div>
      <div class="amount">${formatoDinero(total)}</div>
    </div>`).join("");
}

function ponerHoy() {
  $("filtroFecha").value = getHoy();
  renderPedidosFiltrados();
}

function limpiarFecha() {
  $("filtroFecha").value = "";
  renderPedidosFiltrados();
}

// ======================
// EDITAR PRODUCTOS DE UN PEDIDO
// ======================
function abrirModalEditarPedido(pedidoId) {
  const pedido = pedidosCache.find(p => p.id === pedidoId);
  if (!pedido) {
    showToast("No se encontró el pedido.");
    return;
  }
  pedidoEditando = { ...pedido };
  productosEditables = (pedido.items || []).map(item => ({ ...item }));

  descuentoValorActual = Number(pedido.descuento_valor) || 0;
  descuentoTipoActual = pedido.descuento_tipo || "monto";
  $("descuentoValor").value = descuentoValorActual || "";
  $("descuentoTipo").value = descuentoTipoActual;

  const select = $("nuevoProductoSelect");
  select.innerHTML = '<option value="">Elige un producto</option>' + productosCache.map(prod => `
    <option value="${prod.id}">${escapeHtml(prod.nombre)} — $${Number(prod.precio).toFixed(2)} ${prod.tipo_venta === "granel" ? "por kg" : "c/u"}</option>`).join("");
  $("nuevoProductoCantidadContainer").hidden = true;

  $("modalPedidoNumero").textContent = pedido.numero_pedido || `#${pedido.id}`;
  renderizarProductosEditables();
  actualizarInfoDescuento();
  abrirHoja("modalEditarPedido");
}

function renderizarProductosEditables() {
  const cont = $("editarProductosLista");
  if (!productosEditables.length) {
    cont.innerHTML = `<div class="empty-cart">Este pedido no tiene productos.</div>`;
    return;
  }
  cont.innerHTML = productosEditables.map((item, index) => {
    const esGranel = item.tipo_venta === "granel";
    const paso = esGranel ? 0.25 : 1;
    return `
      <div class="cart-line">
        <div class="cl-top">
          <div>
            <div class="cl-name">${escapeHtml(item.nombre)}</div>
            <div class="cl-unit">$${Number(item.precio).toFixed(2)} ${esGranel ? "por kg" : "c/u"}</div>
          </div>
          <div class="cl-total">$${(Number(item.precio) * Number(item.qty)).toFixed(2)}</div>
        </div>
        <div class="cl-bottom">
          <div class="stepper">
            <button type="button" onclick="cambiarCantidadProductoEditable(${index}, -${paso})">−</button>
            <span class="stepper-value">${escapeHtml(esGranel ? `${Number(item.qty).toFixed(2)} kg` : Number(item.qty))}</span>
            <button type="button" onclick="cambiarCantidadProductoEditable(${index}, ${paso})">+</button>
          </div>
          <button class="btn btn-text danger" onclick="eliminarProductoEditable(${index})"><i class="fa-solid fa-trash-can"></i> Quitar</button>
        </div>
      </div>`;
  }).join("");
}

function cambiarCantidadProductoEditable(index, delta) {
  const item = productosEditables[index];
  if (!item) return;
  const nueva = Number(item.qty) + delta;
  if (nueva <= 0.001) {
    productosEditables.splice(index, 1);
  } else {
    item.qty = item.tipo_venta === "granel" ? Math.round(nueva * 100) / 100 : Math.round(nueva);
  }
  renderizarProductosEditables();
  actualizarInfoDescuento();
}

function eliminarProductoEditable(index) {
  productosEditables.splice(index, 1);
  renderizarProductosEditables();
  actualizarInfoDescuento();
}

function agregarProductoAPedido() {
  const select = $("nuevoProductoSelect");
  const cantidadInput = $("nuevoProductoCantidad");
  const productoId = parseInt(select.value, 10);
  const prod = productosCache.find(p => p.id === productoId);
  if (!prod) {
    showToast("Elige un producto.");
    return;
  }
  const cantidad = parseFloat(cantidadInput.value);
  if (isNaN(cantidad) || cantidad <= 0) {
    showToast("Escribe una cantidad válida.");
    return;
  }

  const existente = productosEditables.find(p => p.id === productoId);
  if (existente) {
    const suma = Number(existente.qty) + cantidad;
    existente.qty = existente.tipo_venta === "granel" ? Math.round(suma * 100) / 100 : Math.round(suma);
  } else {
    productosEditables.push({
      id: prod.id,
      nombre: prod.nombre,
      precio: Number(prod.precio),
      tipo_venta: prod.tipo_venta,
      qty: prod.tipo_venta === "granel" ? cantidad : Math.round(cantidad)
    });
  }

  select.value = "";
  cantidadInput.value = "";
  $("nuevoProductoCantidadContainer").hidden = true;
  renderizarProductosEditables();
  actualizarInfoDescuento();
}

function calcularEdicion() {
  const subtotal = productosEditables.reduce((s, i) => s + Number(i.precio) * Number(i.qty), 0);
  let descuento = 0;
  if (descuentoValorActual > 0) {
    descuento = descuentoTipoActual === "porcentaje" ? subtotal * (descuentoValorActual / 100) : descuentoValorActual;
    if (descuento > subtotal) descuento = subtotal;
  }
  return { subtotal, descuento, total: roundUpToHalf(subtotal - descuento) };
}

function actualizarInfoDescuento() {
  const { subtotal, descuento, total } = calcularEdicion();
  $("subtotalSinDescuento").textContent = subtotal.toFixed(2);
  $("montoDescuento").textContent = descuento.toFixed(2);
  $("totalConDescuento").textContent = total.toFixed(2);
  $("modalEditarTotal").textContent = total.toFixed(2);
}

function aplicarDescuento() {
  const valor = parseFloat($("descuentoValor").value);
  if (isNaN(valor) || valor <= 0) {
    showToast("Escribe una cantidad válida para el descuento.");
    return;
  }
  descuentoValorActual = valor;
  descuentoTipoActual = $("descuentoTipo").value;
  actualizarInfoDescuento();
}

function quitarDescuento() {
  descuentoValorActual = 0;
  descuentoTipoActual = "monto";
  $("descuentoValor").value = "";
  actualizarInfoDescuento();
}

async function guardarEdicionPedido() {
  if (!pedidoEditando) return;
  const { descuento, total } = calcularEdicion();
  const payload = {
    items: productosEditables,
    total,
    descuento_valor: descuentoValorActual,
    descuento_tipo: descuentoTipoActual,
    descuento_monto: descuento
  };
  const { error } = await supabaseClient.from("pedidos").update(payload).eq("id", pedidoEditando.id);
  if (error) {
    handleError(error, "No se pudieron guardar los cambios.");
    return;
  }
  showToast("Pedido actualizado", "success");
  cerrarModalEditarPedido();
  cargarPedidos({ forzar: true });
}

function cerrarModalEditarPedido() {
  cerrarHoja("modalEditarPedido");
  pedidoEditando = null;
  productosEditables = [];
  descuentoValorActual = 0;
  descuentoTipoActual = "monto";
}

// ======================
// WHATSAPP AL CLIENTE
// ======================
function abrirModalWhatsApp(pedidoId) {
  const pedido = pedidosCache.find(p => p.id === pedidoId);
  if (!pedido) return;
  pedidoWhatsApp = pedido;

  $("whatsappPedidoInfo").innerHTML = `
    <span><strong>${escapeHtml(pedido.nombre)}</strong><br><span class="small muted">Pedido ${escapeHtml(pedido.numero_pedido || "#" + pedido.id)} · ${estadoInfo(pedido.estado).etiqueta}</span></span>
    <span class="amount">${formatoDinero(pedido.total)}</span>`;

  let numero = String(pedido.telefono || "").replace(/\D/g, "");
  if (numero.length === 10) numero = "52" + numero;
  $("whatsappNumero").value = `+${numero}`;

  let mensaje = `Hola ${pedido.nombre}, te escribimos de FishMar sobre tu pedido:\n\n`;
  mensaje += `📦 *Pedido #${pedido.numero_pedido || pedido.id}*\n`;
  (pedido.items || []).forEach(item => {
    const unidad = item.tipo_venta === "granel" ? "kg" : "pz";
    mensaje += `• ${item.nombre} x${item.qty} ${unidad} - $${(Number(item.precio) * Number(item.qty)).toFixed(2)}\n`;
  });
  mensaje += `\n💰 *Total:* $${Number(pedido.total).toFixed(2)}\n`;
  mensaje += `🚚 *Estado:* ${estadoInfo(pedido.estado).etiqueta}\n\n`;
  mensaje += `¡Gracias por tu compra!`;
  $("whatsappMensaje").value = mensaje;

  abrirHoja("modalWhatsApp");
}

function cerrarModalWhatsApp() {
  cerrarHoja("modalWhatsApp");
  pedidoWhatsApp = null;
}

function enviarWhatsApp() {
  const numero = $("whatsappNumero").value.replace(/\D/g, "");
  const mensaje = $("whatsappMensaje").value.trim();
  if (!numero) {
    showToast("El pedido no tiene un teléfono válido.");
    return;
  }
  if (!mensaje) {
    showToast("Escribe un mensaje.");
    return;
  }
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, "_blank");
  cerrarModalWhatsApp();
}

// ======================
// TICKET
// ======================
function imprimirPedido(pedidoId) {
  const pedido = pedidosCache.find(p => p.id === pedidoId);
  if (!pedido) return;

  const items = pedido.items || [];
  const subtotal = items.reduce((s, i) => s + Number(i.precio) * Number(i.qty), 0);
  const descuento = Number(pedido.descuento_monto) || 0;
  const filas = items.map(item => `
    <tr><td class="q">${escapeHtml(cantidadTexto(item))}</td><td>${escapeHtml(item.nombre)}</td>
    <td class="r">$${(Number(item.precio) * Number(item.qty)).toFixed(2)}</td></tr>`).join("");

  const ventana = window.open("", "_blank", "width=420,height=700");
  if (!ventana) {
    showToast("Tu navegador bloqueó la ventana del ticket. Permite las ventanas emergentes.");
    return;
  }
  ventana.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Ticket ${escapeHtml(pedido.numero_pedido || pedido.id)}</title>
    <style>
      body { font-family: "Courier New", monospace; width: 58mm; margin: 0 auto; padding: 3mm 2mm; color: #000; font-size: 10pt; line-height: 1.3; }
      h2 { font-size: 14pt; margin: 0; text-align: center; }
      .c { text-align: center; } p { margin: 2px 0; }
      .box { border: 1px solid #000; padding: 4px; text-align: center; font-weight: bold; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 2px 0; vertical-align: top; } td.q { width: 22%; } td.r { text-align: right; white-space: nowrap; }
      hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
      .tot td { font-weight: bold; font-size: 12pt; }
      .no-print { text-align: center; margin-top: 16px; }
      .no-print button { font-size: 16px; padding: 10px 16px; margin: 4px; }
      @media print { .no-print { display: none; } }
    </style></head><body>
    <h2>🐟 FISH-MAR</h2>
    <p class="c">Pescados y Mariscos frescos</p>
    <p class="c">Pirules Mz 004, Alfredo del Mazo<br>Ixtapaluca, Méx. C.P. 56577<br>Tel. (55) 6908 0488</p>
    <div class="box">PEDIDO ${escapeHtml(pedido.numero_pedido || "#" + pedido.id)}<br>${escapeHtml(formatearFechaPedido(pedido))}</div>
    <p><b>CLIENTE:</b> ${escapeHtml(pedido.nombre)}</p>
    <p><b>TEL:</b> ${escapeHtml(pedido.telefono)}</p>
    <p><b>DIRECCIÓN:</b> ${escapeHtml(pedido.direccion)}</p>
    <p><b>PAGO:</b> ${escapeHtml((pedido.metodo_pago || "").toUpperCase())}</p>
    <hr><table>${filas}</table><hr>
    <table>
      <tr><td>SUBTOTAL</td><td class="r">$${subtotal.toFixed(2)}</td></tr>
      ${descuento > 0 ? `<tr><td>DESCUENTO</td><td class="r">-$${descuento.toFixed(2)}</td></tr>` : ""}
      <tr class="tot"><td>TOTAL</td><td class="r">$${Number(pedido.total).toFixed(2)}</td></tr>
    </table>
    ${pedido.notas ? `<p><i>NOTAS: ${escapeHtml(pedido.notas)}</i></p>` : ""}
    <hr><p class="c">¡Gracias por su compra!</p>
    <div class="no-print"><button onclick="window.print()">🖨️ Imprimir</button><button onclick="window.close()">Cerrar</button></div>
    </body></html>`);
  ventana.document.close();
}

// ======================
// PRODUCTOS
// ======================
async function cargarProductosAdmin() {
  const { data, error } = await supabaseClient.from("productos").select("*").order("nombre", { ascending: true });
  if (error) {
    handleError(error, "No se pudieron cargar los productos.");
    return;
  }
  productosCache = data || [];
  filtrarProductos();
}

function filtrarProductos() {
  const busq = ($("searchProducto").value || "").toLowerCase().trim();
  const filtrados = productosCache.filter(p =>
    p.nombre.toLowerCase().includes(busq) &&
    (categoriaProductoFilter === "all" || p.categoria === categoriaProductoFilter));
  $("resumenProductos").textContent = `${filtrados.length} de ${productosCache.length} productos`;
  renderProductosAdmin(filtrados);
}

function renderProductosAdmin(lista) {
  const cont = $("productosAdmin");
  if (!lista.length) {
    cont.innerHTML = `<div class="empty"><div class="empty-icon">🔎</div><div class="empty-title">No hay productos que coincidan</div></div>`;
    return;
  }
  cont.innerHTML = lista.map(p => {
    const img = p.imagen_url && p.imagen_url.trim()
      ? `<img class="thumb" src="${safeUrl(p.imagen_url)}" alt="" loading="lazy">`
      : `<div class="thumb thumb-empty">${p.categoria === "Pescadería" ? "🐟" : "🦐"}</div>`;
    return `
      <div class="list-item product-row">
        ${img}
        <div class="grow">
          <div class="title">${escapeHtml(p.nombre)}</div>
          <div class="price">$${Number(p.precio).toFixed(2)} <span class="small muted">${p.tipo_venta === "granel" ? "por kg" : "c/u"}</span></div>
          <div class="tag">${escapeHtml(p.categoria)}${p.subcategoria ? " · " + escapeHtml(p.subcategoria) : ""}</div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" onclick="editarProducto(${p.id})" aria-label="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn" style="color:var(--danger)" onclick="eliminarProducto(${p.id})" aria-label="Borrar"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>`;
  }).join("");
}

function abrirModalProducto() {
  limpiarFormulario();
  $("tituloModalProducto").textContent = "Nuevo producto";
  abrirHoja("modalProducto");
}

function cerrarModalProducto() {
  cerrarHoja("modalProducto");
  limpiarFormulario();
}

async function crearProducto() {
  const nombre = $("nombre").value.trim();
  const precio = parseFloat($("precio").value);
  const categoria = $("categoria").value;
  const imagen_url = $("imagen_url").value.trim();
  const descripcion = $("descripcion").value.trim();
  const tipoVenta = $("tipoVenta").value;
  let subcategoria = null;

  if (!nombre) { showToast("Escribe el nombre del producto."); return; }
  if (isNaN(precio) || precio < 0) { showToast("Escribe un precio válido."); return; }
  if (categoria === "Marisquería") {
    subcategoria = $("subcategoria").value;
    if (!subcategoria) { showToast("Elige la sección del menú."); return; }
  }

  const producto = {
    nombre, precio, categoria, subcategoria,
    imagen_url: imagen_url || null,
    descripcion: descripcion || null,
    tipo_venta: tipoVenta
  };

  const btn = $("btnGuardarProducto");
  btn.disabled = true;
  try {
    const { error } = productoEditandoId
      ? await supabaseClient.from("productos").update(producto).eq("id", productoEditandoId)
      : await supabaseClient.from("productos").insert([producto]);
    if (error) {
      handleError(error, "No se pudo guardar el producto.");
      return;
    }
    showToast(productoEditandoId ? "Producto actualizado" : "Producto agregado", "success");
    cerrarModalProducto();
    await cargarProductosAdmin();
  } finally {
    btn.disabled = false;
  }
}

function editarProducto(id) {
  const p = productosCache.find(x => x.id === id);
  if (!p) return;
  $("nombre").value = p.nombre || "";
  $("precio").value = p.precio ?? "";
  $("categoria").value = p.categoria || "Pescadería";
  $("imagen_url").value = p.imagen_url || "";
  $("descripcion").value = p.descripcion || "";
  $("tipoVenta").value = p.tipo_venta || "pieza";
  toggleSubcategoria();
  $("subcategoria").value = p.categoria === "Marisquería" ? (p.subcategoria || "") : "";
  actualizarPreview();
  productoEditandoId = id;
  $("tituloModalProducto").textContent = "Editar producto";
  abrirHoja("modalProducto");
}

async function eliminarProducto(id) {
  const p = productosCache.find(x => x.id === id);
  if (!confirm(`¿Borrar "${p?.nombre || "este producto"}" del menú? No se puede deshacer.`)) return;
  const { error } = await supabaseClient.from("productos").delete().eq("id", id);
  if (error) {
    handleError(error, "No se pudo borrar el producto.");
    return;
  }
  showToast("Producto borrado", "success");
  cargarProductosAdmin();
}

function limpiarFormulario() {
  ["nombre", "precio", "imagen_url", "descripcion"].forEach(id => { $(id).value = ""; });
  $("tipoVenta").value = "pieza";
  $("categoria").value = "Pescadería";
  $("subcategoria").value = "";
  toggleSubcategoria();
  actualizarPreview();
  productoEditandoId = null;
}

function toggleSubcategoria() {
  $("subcategoriaDiv").hidden = $("categoria").value !== "Marisquería";
}

function actualizarPreview() {
  const url = $("imagen_url").value.trim();
  const img = $("previewImg");
  const segura = url ? safeUrl(url) : "#";
  img.hidden = segura === "#";
  if (!img.hidden) img.src = url;
}

// ======================
// VENTAS (MÉTRICAS)
// ======================
function getDiaPedidoMetricas(p) {
  if (p.tipo_pedido === "local" && p.fecha_cierre) return fechaMX(p.fecha_cierre);
  if (p.created_at) return fechaMX(p.created_at);
  return p.fecha || "";
}

function seleccionarPeriodo(periodo) {
  periodoActual = periodo;
  document.querySelectorAll("#filtrosPeriodo .chip").forEach(c => c.classList.toggle("is-active", c.dataset.periodo === periodo));
  $("fechasPersonalizadas").hidden = periodo !== "personalizado";
  if (periodo === "personalizado") {
    if (!$("fechaInicio").value) $("fechaInicio").value = sumarDias(getHoy(), -6);
    if (!$("fechaFin").value) $("fechaFin").value = getHoy();
    return;
  }
  actualizarMetricasPeriodo();
}

function aplicarPersonalizado() {
  fechaInicioPersonalizado = $("fechaInicio").value;
  fechaFinPersonalizado = $("fechaFin").value;
  if (!fechaInicioPersonalizado || !fechaFinPersonalizado) {
    showToast("Elige las dos fechas.");
    return;
  }
  actualizarMetricasPeriodo();
}

function actualizarMetricasPeriodo() {
  const hoy = getHoy();
  let fechaInicio, fechaFin = hoy;

  switch (periodoActual) {
    case "hoy":
      fechaInicio = hoy;
      break;
    case "semana":
      fechaInicio = sumarDias(hoy, -diaSemana(hoy)); // desde el domingo
      break;
    case "mes":
      fechaInicio = hoy.slice(0, 8) + "01";
      break;
    case "personalizado":
      if (!fechaInicioPersonalizado || !fechaFinPersonalizado) return;
      fechaInicio = fechaInicioPersonalizado;
      fechaFin = fechaFinPersonalizado;
      if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
      break;
  }

  const pedidos = todosPedidosCache.filter(p => {
    const dia = getDiaPedidoMetricas(p);
    return dia && dia >= fechaInicio && dia <= fechaFin;
  });

  const ingresos = pedidos.reduce((acc, p) => acc + Number(p.total), 0);
  const online = pedidos.filter(p => p.tipo_pedido !== "local");
  $("statIngresos").textContent = formatoDinero(ingresos);
  $("statPedidos").textContent = pedidos.length;
  $("statProceso").textContent = online.filter(p => p.estado === "En proceso").length;
  $("statEntregados").textContent = online.filter(p => p.estado === "Entregado").length;

  if (typeof Chart === "undefined") return;
  generarDatosIngresosDiarios(pedidos, fechaInicio, fechaFin);
  generarVentasPorDiaSemana(pedidos);
}

const opcionesGrafica = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => formatoDinero(ctx.raw) } }
  },
  scales: {
    y: { beginAtZero: true, ticks: { callback: (v) => "$" + v }, grid: { color: "#eee8de" } },
    x: { grid: { display: false } }
  }
};

function generarDatosIngresosDiarios(pedidos, fechaInicio, fechaFin) {
  // Como máximo los últimos 31 días del período
  const dias = [];
  let dia = fechaFin;
  while (dia >= fechaInicio && dias.length < 31) {
    dias.unshift(dia);
    dia = sumarDias(dia, -1);
  }
  const totales = {};
  pedidos.forEach(p => {
    const d = getDiaPedidoMetricas(p);
    totales[d] = (totales[d] || 0) + Number(p.total);
  });

  if (chartIngresos) chartIngresos.destroy();
  chartIngresos = new Chart($("graficaIngresosDiarios"), {
    type: dias.length > 1 ? "line" : "bar",
    data: {
      labels: dias.map(d => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`),
      datasets: [{
        data: dias.map(d => totales[d] || 0),
        borderColor: "#0b7a75",
        backgroundColor: dias.length > 1 ? "rgba(11,122,117,.12)" : "#0b7a75",
        tension: .3,
        fill: true,
        borderRadius: 8,
        pointRadius: 3
      }]
    },
    options: opcionesGrafica
  });
}

function generarVentasPorDiaSemana(pedidos) {
  const ventas = [0, 0, 0, 0, 0, 0, 0];
  pedidos.forEach(p => {
    const d = getDiaPedidoMetricas(p);
    if (d) ventas[diaSemana(d)] += Number(p.total);
  });

  if (chartVentasDia) chartVentasDia.destroy();
  chartVentasDia = new Chart($("graficaVentasPorDia"), {
    type: "bar",
    data: {
      labels: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
      datasets: [{ data: ventas, backgroundColor: "#0d2a38", borderRadius: 8 }]
    },
    options: opcionesGrafica
  });
}

// ======================
// VENTAS EN EL RESTAURANTE
// ======================
async function cargarVentasLocal() {
  const fecha = $("filtroFechaLocal").value || getHoy();
  $("filtroFechaLocal").value = fecha;
  const rango = rangoDiaMX(fecha);
  const { data, error } = await supabaseClient
    .from("pedidos")
    .select("*")
    .eq("tipo_pedido", "local")
    .eq("estado_local", "cerrado")
    .gte("fecha_cierre", rango.desde)
    .lt("fecha_cierre", rango.hasta)
    .order("fecha_cierre", { ascending: false });
  if (error) {
    handleError(error, "No se pudieron cargar las ventas del restaurante.");
    return;
  }
  ventasLocalCache = data || [];
  $("totalLocalDia").textContent = formatoDinero(ventasLocalCache.reduce((s, p) => s + Number(p.total), 0));
  $("totalPedidosLocal").textContent = ventasLocalCache.length;

  const cont = $("listaVentasLocal");
  if (!ventasLocalCache.length) {
    cont.innerHTML = `<div class="empty"><div class="empty-icon">🍽️</div><div class="empty-title">No hay mesas cobradas este día</div></div>`;
    return;
  }
  cont.innerHTML = ventasLocalCache.map(p => `
    <div class="list-item clickable" onclick="verDetallePedidoLocalModal(${p.id})">
      <div class="thumb thumb-empty" style="width:48px;height:48px;font-size:1.3rem;">🍽️</div>
      <div class="grow">
        <div class="title">${escapeHtml(p.mesa || "Sin nombre")}</div>
        <div class="small muted">${escapeHtml(horaMX(p.fecha_cierre))} · ${escapeHtml(p.metodo_pago_local || "—")}</div>
      </div>
      <div class="amount">${formatoDinero(p.total)}</div>
      <button class="icon-btn" style="color:var(--danger)" onclick="event.stopPropagation(); confirmarEliminarPedidoLocal(${p.id})" aria-label="Borrar">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>`).join("");
}

function verDetallePedidoLocalModal(pedidoId) {
  const pedido = ventasLocalCache.find(p => p.id === pedidoId);
  if (!pedido) return;
  const items = pedido.items || [];
  const subtotal = items.reduce((s, i) => s + Number(i.precio) * Number(i.qty), 0);
  const descuento = Number(pedido.descuento_monto) || 0;
  const comision = Number(pedido.comision_tarjeta) || 0;

  $("detallePedidoLocalContent").innerHTML = `
    <div class="total-line">
      <span><strong>${escapeHtml(pedido.mesa || "Sin nombre")}</strong><br>
      <span class="small muted">${escapeHtml(fechaHoraCortaMX(pedido.fecha_cierre))} · ${escapeHtml(pedido.metodo_pago_local || "—")}</span></span>
      <span class="amount">${formatoDinero(pedido.total)}</span>
    </div>
    <ul class="items">
      ${items.map(i => `<li><span><span class="qty">${escapeHtml(cantidadTexto(i))}</span>${escapeHtml(i.nombre)}</span>
        <span>$${(Number(i.precio) * Number(i.qty)).toFixed(2)}</span></li>`).join("")}
    </ul>
    <div class="stack-sm small">
      <div class="row-between"><span class="muted">Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
      ${descuento > 0 ? `<div class="row-between"><span class="muted">Descuento</span><span>−$${descuento.toFixed(2)}</span></div>` : ""}
      ${comision > 0 ? `<div class="row-between"><span class="muted">Comisión tarjeta</span><span>+$${comision.toFixed(2)}</span></div>` : ""}
    </div>`;
  abrirHoja("modalDetallePedidoLocal");
}

function cerrarModalDetallePedidoLocal() {
  cerrarHoja("modalDetallePedidoLocal");
}

function confirmarEliminarPedidoLocal(pedidoId) {
  pedidoLocalAEliminar = pedidoId;
  abrirHoja("modalConfirmarEliminarLocal");
}

function cerrarModalConfirmarEliminarLocal() {
  cerrarHoja("modalConfirmarEliminarLocal");
  pedidoLocalAEliminar = null;
}

async function eliminarPedidoLocalConfirmado() {
  if (!pedidoLocalAEliminar) return;
  const { error } = await supabaseClient
    .from("pedidos")
    .delete()
    .eq("id", pedidoLocalAEliminar)
    .eq("tipo_pedido", "local");
  cerrarModalConfirmarEliminarLocal();
  if (error) {
    handleError(error, "No se pudo borrar la venta.");
    return;
  }
  showToast("Venta borrada", "success");
  cargarVentasLocal();
  cargarPedidos({ forzar: true });
}

function limpiarFiltroLocal() {
  $("filtroFechaLocal").value = getHoy();
  cargarVentasLocal();
}

// ======================
// USUARIOS (SUPER ADMIN)
// ======================
const NOMBRES_ROL = { admin: "Administrador", repartidor: "Repartidor", mesero: "Mesero", superadmin: "Super admin" };

async function cargarListaUsuarios() {
  if (!esSuperAdmin) return;
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("user_id, full_name, role, is_superadmin")
    .order("full_name", { ascending: true });
  if (error) {
    handleError(error, "No se pudo cargar la lista de usuarios.");
    return;
  }
  listaUsuarios = data || [];
  renderListaUsuarios();
}

function renderListaUsuarios() {
  const cont = $("listaUsuarios");
  if (!listaUsuarios.length) {
    cont.innerHTML = `<div class="empty"><div class="empty-title">No hay usuarios</div></div>`;
    return;
  }
  cont.innerHTML = listaUsuarios.map(u => {
    const iniciales = (u.full_name || "?").split(" ").map(x => x[0]).slice(0, 2).join("").toUpperCase();
    return `
      <div class="list-item">
        <div class="thumb thumb-empty" style="width:48px;height:48px;font-size:1rem;font-weight:800;border-radius:50%;">${escapeHtml(iniciales)}</div>
        <div class="grow">
          <div class="title">${escapeHtml(u.full_name || "Sin nombre")}</div>
          <span class="role-badge ${escapeHtml(u.role)}">${escapeHtml(NOMBRES_ROL[u.role] || u.role)}${u.is_superadmin ? " · Super admin" : ""}</span>
        </div>
        ${u.is_superadmin ? "" : `
        <button class="icon-btn" style="color:var(--danger)" onclick="eliminarUsuario('${escapeHtml(u.user_id)}')" aria-label="Borrar usuario">
          <i class="fa-solid fa-user-xmark"></i>
        </button>`}
      </div>`;
  }).join("");
}

async function eliminarUsuario(userId) {
  const u = listaUsuarios.find(x => x.user_id === userId);
  if (!confirm(`¿Quitar el acceso a ${u?.full_name || "este usuario"}? Ya no podrá entrar al sistema.`)) return;

  try {
    let { error } = await supabaseClient.functions.invoke("manage-user", { body: { action: "delete", userId } });
    if (error && (error.status === 401 || String(error.message).includes("401"))) {
      const { error: refreshError } = await supabaseClient.auth.refreshSession();
      if (refreshError) {
        showToast("Tu sesión expiró. Vuelve a entrar.");
        window.location.href = "admin.html";
        return;
      }
      ({ error } = await supabaseClient.functions.invoke("manage-user", { body: { action: "delete", userId } }));
    }
    if (error) {
      handleError(error, "No se pudo quitar el usuario.");
      return;
    }
    showToast("Usuario quitado", "success");
    cargarListaUsuarios();
  } catch (err) {
    handleError(err, "Error de conexión.");
  }
}

function mostrarModalCrearUsuario() {
  abrirHoja("modalCrearUsuario");
}

async function crearUsuario() {
  const email = $("nuevoEmail").value.trim();
  const role = $("nuevoRol").value;
  const fullName = $("nuevoNombre").value.trim();
  const password = $("nuevoPassword").value.trim();

  if (!email || !role || !fullName) {
    showToast("Escribe el nombre, el correo y elige el puesto.");
    return;
  }
  if (password && password.length < 6) {
    showToast("La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  const payload = { action: "create", email, role, fullName };
  if (password) payload.password = password;

  try {
    const { data, error } = await supabaseClient.functions.invoke("manage-user", { body: payload });
    if (error) {
      handleError(error, "No se pudo crear el usuario.");
      return;
    }
    if (data && data.error) {
      showToast(data.error);
      return;
    }
    showToast(password ? "Usuario creado. Ya puede entrar." : "Usuario creado. Le llegará un correo para crear su contraseña.", "success");
    cerrarModalCrearUsuario();
    cargarListaUsuarios();
    cargarRepartidores();
  } catch (err) {
    handleError(err, "Error de conexión.");
  }
}

function cerrarModalCrearUsuario() {
  cerrarHoja("modalCrearUsuario");
  ["nuevoEmail", "nuevoNombre", "nuevoPassword"].forEach(id => { $(id).value = ""; });
  $("nuevoRol").value = "mesero";
}

// ======================
// PESTAÑAS
// ======================
function setupTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  const panes = document.querySelectorAll(".tab-pane");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.dataset.tab;
      tabs.forEach(b => b.classList.toggle("active", b === btn));
      panes.forEach(pane => pane.classList.toggle("active",
        pane.id === `tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (tabId === "ventaslocal") cargarVentasLocal();
      if (tabId === "metricas") actualizarMetricasPeriodo();
    });
  });
}

// ======================
// EVENTOS E INICIO
// ======================
document.querySelectorAll("#filtrosEstado .chip").forEach(chip => chip.addEventListener("click", () => {
  filtroEstadoActual = chip.dataset.estado;
  document.querySelectorAll("#filtrosEstado .chip").forEach(c => c.classList.toggle("is-active", c === chip));
  renderPedidosFiltrados();
}));
$("filtroFecha").addEventListener("change", renderPedidosFiltrados);

document.querySelectorAll("#filtroCategoriaChips .chip").forEach(chip => chip.addEventListener("click", () => {
  categoriaProductoFilter = chip.dataset.cat;
  document.querySelectorAll("#filtroCategoriaChips .chip").forEach(c => c.classList.toggle("is-active", c === chip));
  filtrarProductos();
}));

document.querySelectorAll("#filtrosPeriodo .chip").forEach(chip =>
  chip.addEventListener("click", () => seleccionarPeriodo(chip.dataset.periodo)));

$("filtroFechaLocal").addEventListener("change", cargarVentasLocal);
$("imagen_url").addEventListener("input", actualizarPreview);
$("previewImg").addEventListener("error", () => { $("previewImg").hidden = true; });
$("nuevoProductoSelect").addEventListener("change", (e) => {
  $("nuevoProductoCantidadContainer").hidden = !e.target.value;
  if (e.target.value) $("nuevoProductoCantidad").value = 1;
});
$("btnConfirmarEliminarLocal").addEventListener("click", eliminarPedidoLocalConfirmado);

(async function initDashboard() {
  const ok = await verificarSesionAdmin();
  if (!ok) return;

  if (esSuperAdmin) {
    $("tabUsuariosBtn").hidden = false;
    $("tabbar").style.setProperty("--tabs", 5);
  }
  setupTabs();

  await cargarRepartidores();
  await Promise.all([cargarPedidos({ forzar: true }), cargarProductosAdmin()]);
  if (esSuperAdmin) cargarListaUsuarios();

  // Tiempo real: recargar en cuanto cambie un pedido
  let espera = null;
  supabaseClient.channel("pedidos-admin")
    .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, () => {
      clearTimeout(espera);
      espera = setTimeout(() => cargarPedidos(), 400);
    })
    .subscribe();

  // Respaldo por si se corta el tiempo real
  setInterval(() => cargarPedidos(), 20000);
  // Actualizar los "hace X min" sin recargar datos
  setInterval(() => { if (!document.querySelector(".order select:focus")) renderPedidosFiltrados(); }, 60000);
})();
