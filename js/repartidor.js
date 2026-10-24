// js/repartidor.js — entregas a domicilio
// Dependencias: supabaseClient (supabase.js), utils.js

let pedidosRepartidor = [];
let userIdActual = null;
let nombreRepartidor = "";
let modoFiltro = "pendientes";   // "pendientes" | "hoy" | "fecha"
let saldoHoy = 0;

const $ = (id) => document.getElementById(id);

// ======================
// SESIÓN
// ======================
async function verificarSesion() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data?.user) {
    window.location.href = "admin.html";
    return false;
  }
  userIdActual = data.user.id;

  const { data: rolData, error: rolError } = await supabaseClient
    .from("user_roles")
    .select("role, full_name")
    .eq("user_id", userIdActual)
    .single();

  if (rolError || !rolData || rolData.role !== "repartidor") {
    showToast("Esta pantalla es solo para repartidores.");
    window.location.href = "admin.html";
    return false;
  }

  nombreRepartidor = rolData.full_name || "Repartidor";
  $("nombreRepartidor").textContent = `Hola, ${nombreRepartidor}`;
  return true;
}

function logout() {
  supabaseClient.auth.signOut();
  window.location.href = "admin.html";
}

// ======================
// PEDIDOS
// ======================
async function cargarPedidosRepartidor() {
  if (!userIdActual) return;

  let query = supabaseClient
    .from("pedidos")
    .select("*")
    .eq("repartidor_id", userIdActual)
    .neq("tipo_pedido", "local");

  if (modoFiltro === "pendientes") {
    query = query.neq("estado", "Entregado").order("created_at", { ascending: true });
  } else {
    const dia = modoFiltro === "hoy" ? getHoy() : $("filtroFechaRepartidor").value;
    if (!dia) {
      pedidosRepartidor = [];
      renderPedidosRepartidor();
      return;
    }
    const rango = rangoDiaMX(dia);
    query = query.gte("created_at", rango.desde).lt("created_at", rango.hasta)
      .order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) {
    handleError(error, "No se pudieron cargar tus pedidos. Revisa tu internet.");
    return;
  }
  pedidosRepartidor = data || [];
  renderPedidosRepartidor();
  actualizarConteoPendientes();
}

async function actualizarConteoPendientes() {
  if (modoFiltro === "pendientes") {
    $("countPendientes").textContent = pedidosRepartidor.length;
    return;
  }
  const { count } = await supabaseClient
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("repartidor_id", userIdActual)
    .neq("tipo_pedido", "local")
    .neq("estado", "Entregado");
  $("countPendientes").textContent = count ?? 0;
}

function renderPedidosRepartidor() {
  const cont = $("misPedidos");
  const n = pedidosRepartidor.length;
  const textos = {
    pendientes: n ? `Tienes ${n} ${n === 1 ? "pedido" : "pedidos"} por entregar` : "No tienes pedidos por entregar",
    hoy: `${n} ${n === 1 ? "pedido" : "pedidos"} hoy`,
    fecha: `${n} ${n === 1 ? "pedido" : "pedidos"} ese día`
  };
  $("resumenPedidos").textContent = textos[modoFiltro];

  if (!n) {
    cont.innerHTML = modoFiltro === "pendientes"
      ? `<div class="empty"><div class="empty-icon">🎉</div><div class="empty-title">¡Todo entregado!</div>
         <p class="mt-8">Cuando te asignen un pedido aparecerá aquí.</p></div>`
      : `<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">No hay pedidos</div>
         <p class="mt-8">No tuviste pedidos en ese día.</p></div>`;
    return;
  }

  cont.innerHTML = pedidosRepartidor.map(p => {
    const info = estadoInfo(p.estado);
    const clases = getEstadoClass(p.estado, p.created_at || p.fecha);
    const numero = escapeHtml(p.numero_pedido || `#${p.id}`);
    const items = Array.isArray(p.items) ? p.items : [];
    const esEfectivo = p.metodo_pago === "Efectivo";
    const telefono = escapeHtml(p.telefono);

    const itemsHtml = items.length
      ? items.map(item => `
          <li><span><span class="qty">${escapeHtml(item.tipo_venta === "granel" ? `${Number(item.qty).toFixed(2)} kg` : `${Number(item.qty)}×`)}</span>${escapeHtml(item.nombre)}</span>
          <span>$${(Number(item.precio) * Number(item.qty)).toFixed(2)}</span></li>`).join("")
      : `<li>Sin detalle de productos</li>`;

    let accion;
    if (p.estado === "Entregado") {
      accion = `<div class="done-line"><i class="fa-solid fa-circle-check"></i> Entregado</div>`;
    } else if (p.estado === "El repartidor está en camino") {
      accion = `<button class="btn btn-primary btn-lg btn-block" onclick="marcarEntregado(${p.id})">
                  <i class="fa-solid fa-circle-check"></i> Ya lo entregué</button>`;
    } else {
      accion = `<button class="btn btn-dark btn-lg btn-block" onclick="cambiarEstado(${p.id}, 'El repartidor está en camino')">
                  <i class="fa-solid fa-motorcycle"></i> Salir a entregar</button>`;
    }

    const opciones = ESTADOS_PEDIDO.map(e =>
      `<option value="${escapeHtml(e.valor)}" ${e.valor === p.estado ? "selected" : ""}>${e.etiqueta}</option>`).join("");

    return `
      <article class="order ${clases}">
        <div class="order-head">
          <div class="grow">
            <div class="order-name">${escapeHtml(p.nombre)}</div>
            <div class="order-meta">Pedido ${numero} · ${escapeHtml(horaMX(p.created_at))}</div>
            ${p.estado !== "Entregado" ? `<div class="order-wait"><i class="fa-regular fa-clock"></i> ${escapeHtml(calcularTiempoPedido(p))}</div>` : ""}
            ${llegoFueraDeHorario(p) ? `<div class="mt-8"><span class="badge off-hours no-dot"><i class="fa-solid fa-moon"></i> Llegó fuera de horario</span></div>` : ""}
          </div>
          <span class="badge ${info.clase}">${info.etiqueta}</span>
        </div>
        <div class="order-body">
          <div class="info"><i class="fa-solid fa-location-dot"></i><span>${escapeHtml(p.direccion)}</span></div>
          <div class="btn-grid">
            <a class="btn btn-outline" href="${safeUrl(p.ubicacion)}" target="_blank" rel="noopener">
              <i class="fa-solid fa-map-location-dot"></i> Cómo llegar</a>
            <a class="btn btn-outline" href="tel:${telefono}"><i class="fa-solid fa-phone"></i> Llamar</a>
          </div>
          <div class="total-line ${esEfectivo ? "pay-cash" : ""}">
            <span class="muted strong">${esEfectivo ? "Cobrar en efectivo" : "Pago con " + escapeHtml(p.metodo_pago || "—")}</span>
            <span class="amount">${formatoDinero(p.total)}</span>
          </div>
          ${p.notas ? `<div class="note"><i class="fa-solid fa-note-sticky"></i><span>${escapeHtml(p.notas)}</span></div>` : ""}
          <details class="more">
            <summary>Ver productos (${items.length})</summary>
            <ul class="items">${itemsHtml}</ul>
          </details>
          ${accion}
          <details class="more">
            <summary class="small muted">¿Te equivocaste? Corregir estado</summary>
            <select class="select" onchange="cambiarEstado(${p.id}, this.value)">${opciones}</select>
          </details>
        </div>
      </article>`;
  }).join("");
}

async function cambiarEstado(id, nuevoEstado) {
  const { error } = await supabaseClient.from("pedidos").update({ estado: nuevoEstado }).eq("id", id);
  if (error) {
    handleError(error, "No se pudo actualizar el pedido. Inténtalo de nuevo.");
    return;
  }
  showToast(nuevoEstado === "Entregado" ? "¡Pedido entregado!" : `Listo: ${estadoInfo(nuevoEstado).etiqueta}`, "success");
  await cargarPedidosRepartidor();
  await actualizarResumenEfectivo();
}

function marcarEntregado(id) {
  const p = pedidosRepartidor.find(x => x.id === id);
  if (!p) return;
  const cobro = p.metodo_pago === "Efectivo" ? `\n\nRecuerda cobrar ${formatoDinero(p.total)} en efectivo.` : "";
  if (!confirm(`¿Ya entregaste el pedido de ${p.nombre}?${cobro}`)) return;
  cambiarEstado(id, "Entregado");
}

function cambiarFiltro(modo) {
  modoFiltro = modo;
  document.querySelectorAll("#filtrosRepartidor .chip").forEach(c =>
    c.classList.toggle("is-active", c.dataset.modo === modo));
  $("campoFecha").hidden = modo !== "fecha";
  if (modo === "fecha" && !$("filtroFechaRepartidor").value) {
    $("filtroFechaRepartidor").value = sumarDias(getHoy(), -1);
  }
  cargarPedidosRepartidor();
}

// ======================
// DINERO DEL DÍA
// ======================
async function obtenerTotalesHoy() {
  const rango = rangoDiaMX(getHoy());

  const [{ data: pedidosHoy }, { data: cortes }] = await Promise.all([
    supabaseClient.from("pedidos").select("total, metodo_pago, estado")
      .eq("repartidor_id", userIdActual).neq("tipo_pedido", "local")
      .gte("created_at", rango.desde).lt("created_at", rango.hasta),
    supabaseClient.from("repartidor_cortes").select("monto")
      .eq("repartidor_id", userIdActual)
      .gte("fecha_corte", rango.desde).lt("fecha_corte", rango.hasta)
  ]);

  const totalRecaudado = (pedidosHoy || [])
    .filter(p => p.metodo_pago === "Efectivo" && p.estado === "Entregado")
    .reduce((sum, p) => sum + Number(p.total), 0);
  const totalEntregado = (cortes || []).reduce((sum, c) => sum + Number(c.monto), 0);
  return { totalRecaudado, totalEntregado, saldo: totalRecaudado - totalEntregado };
}

async function actualizarResumenEfectivo() {
  if (!userIdActual) return;
  try {
    const { totalRecaudado, totalEntregado, saldo } = await obtenerTotalesHoy();
    saldoHoy = Math.max(saldo, 0);
    $("totalRecaudado").textContent = formatoDinero(totalRecaudado);
    $("totalEntregado").textContent = formatoDinero(totalEntregado);
    $("saldoPendiente").textContent = formatoDinero(saldoHoy);
    $("saldoModal").textContent = formatoDinero(saldoHoy);
  } catch (err) {
    console.error("Error actualizando resumen:", err);
  }
}

function abrirModalEntrega() {
  $("saldoModal").textContent = formatoDinero(saldoHoy);
  $("modalEntrega").style.display = "block";
  document.body.classList.add("no-scroll");
}

function cerrarModalEntrega() {
  $("modalEntrega").style.display = "none";
  document.body.classList.remove("no-scroll");
  $("entregaMonto").value = "";
  $("entregaNotas").value = "";
}

function entregarTodo() {
  if (saldoHoy <= 0) {
    showToast("Hoy no tienes dinero pendiente por entregar.");
    return;
  }
  $("entregaMonto").value = saldoHoy.toFixed(2);
}

async function registrarEntrega() {
  const monto = parseFloat($("entregaMonto").value);
  const notas = $("entregaNotas").value.trim();

  if (isNaN(monto) || monto <= 0) {
    showToast("Escribe cuánto dinero vas a entregar.");
    return;
  }

  const btn = $("btnRegistrarEntrega");
  btn.disabled = true;
  try {
    const { saldo } = await obtenerTotalesHoy();
    if (monto > saldo + 0.001) {
      showToast(`Solo debes ${formatoDinero(Math.max(saldo, 0))} hoy. Revisa la cantidad.`);
      return;
    }

    const { error } = await supabaseClient
      .from("repartidor_cortes")
      .insert([{ repartidor_id: userIdActual, monto, notas: notas || null }]);

    if (error) {
      handleError(error, "No se pudo registrar la entrega. Inténtalo de nuevo.");
      return;
    }

    showToast(`Entrega de ${formatoDinero(monto)} registrada`, "success");
    cerrarModalEntrega();
    await actualizarResumenEfectivo();
    await cargarHistorialEntregas();
  } finally {
    btn.disabled = false;
  }
}

// ======================
// HISTORIAL DE ENTREGAS
// ======================
async function cargarHistorialEntregas() {
  if (!userIdActual) return;

  let query = supabaseClient
    .from("repartidor_cortes")
    .select("*")
    .eq("repartidor_id", userIdActual)
    .order("fecha_corte", { ascending: false });

  const fechaInicio = $("historialFechaInicio").value;
  const fechaFin = $("historialFechaFin").value;
  if (fechaInicio) query = query.gte("fecha_corte", rangoDiaMX(fechaInicio).desde);
  if (fechaFin) query = query.lt("fecha_corte", rangoDiaMX(fechaFin).hasta);

  const { data, error } = await query;
  if (error) {
    handleError(error, "No se pudo cargar el historial.");
    return;
  }

  const cont = $("historialEntregas");
  if (!data || !data.length) {
    cont.innerHTML = `<div class="empty-cart">No hay entregas registradas en esas fechas.</div>`;
    return;
  }

  cont.innerHTML = data.map(corte => `
    <div class="list-item">
      <div class="grow">
        <div class="title">${formatoDinero(corte.monto)}</div>
        <div class="small muted">${escapeHtml(fechaHoraCortaMX(corte.fecha_corte))}</div>
        ${corte.notas ? `<div class="small">${escapeHtml(corte.notas)}</div>` : ""}
      </div>
    </div>`).join("");
}

function limpiarFiltroHistorial() {
  $("historialFechaInicio").value = "";
  $("historialFechaFin").value = "";
  cargarHistorialEntregas();
}

// ======================
// EVENTOS E INICIO
// ======================
document.querySelectorAll("#filtrosRepartidor .chip").forEach(chip =>
  chip.addEventListener("click", () => cambiarFiltro(chip.dataset.modo)));
$("filtroFechaRepartidor").addEventListener("change", cargarPedidosRepartidor);

(async function init() {
  const ok = await verificarSesion();
  if (!ok) return;
  await Promise.all([cargarPedidosRepartidor(), actualizarResumenEfectivo(), cargarHistorialEntregas()]);

  // Avisar al momento cuando le asignan o cambian un pedido
  supabaseClient.channel("pedidos-repartidor")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "pedidos", filter: `repartidor_id=eq.${userIdActual}` },
      () => { cargarPedidosRepartidor(); actualizarResumenEfectivo(); })
    .subscribe();

  // Respaldo por si se pierde la conexión en tiempo real
  setInterval(() => {
    cargarPedidosRepartidor();
    actualizarResumenEfectivo();
  }, 30000);
})();
