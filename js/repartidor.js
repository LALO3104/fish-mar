// js/repartidor.js

let pedidosRepartidor = [];
let userIdActual = null;
let nombreRepartidor = "";
let fechaFiltro = "";   // Fecha seleccionada en formato YYYY-MM-DD

// ======================
// VERIFICACIÓN DE SESIÓN
// ======================
async function verificarSesion() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data?.user) {
    showToast("No hay sesión activa. Redirigiendo al login.");
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
    handleError(rolError, "Tu usuario no tiene rol de repartidor.");
    window.location.href = "admin.html";
    return false;
  }

  nombreRepartidor = rolData.full_name || "Repartidor";
  const titulo = document.querySelector(".header h1");
  const subtitulo = document.querySelector(".header p");

  if (titulo) titulo.textContent = `🐟 ${nombreRepartidor}`;
  if (subtitulo) subtitulo.textContent = "Solo tus pedidos asignados";

  return true;
}

// ======================
// PEDIDOS Y FILTROS
// ======================
async function cargarPedidosRepartidor() {
  const ok = await verificarSesion();
  if (!ok) return;

  const fechaInput = document.getElementById("filtroFechaRepartidor");
  fechaFiltro = fechaInput ? fechaInput.value : "";

  let query = supabaseClient
    .from("pedidos")
    .select("*")
    .eq("repartidor_id", userIdActual)
    .neq('tipo_pedido', 'local')
    .order("created_at", { ascending: false });

  if (fechaFiltro) {
    query = query.gte("created_at", `${fechaFiltro}T00:00:00-06:00`)
                 .lt("created_at", `${fechaFiltro}T23:59:59-06:00`);
  }

  const { data, error } = await query;

  if (error) {
    handleError(error, "Error al cargar tus pedidos.");
    return;
  }

  pedidosRepartidor = data || [];
  renderPedidosRepartidor();
  actualizarStatsRepartidor();
  await actualizarResumenEfectivo();
}

function renderPedidosRepartidor() {
  const cont = document.getElementById("misPedidos");
  if (!cont) return;

  if (!pedidosRepartidor.length) {
    cont.innerHTML = `<div class="panel">No tienes pedidos asignados para este filtro.</div>`;
    return;
  }

  cont.innerHTML = pedidosRepartidor.map(p => {
    const estadoClass = getEstadoClass(p.estado, p.created_at || p.fecha);
    const fechaLocal = formatearFechaPedido(p);
    const tiempo = calcularTiempoPedido(p);
    const mapa = p.ubicacion ? p.ubicacion : "#";
    const pedidoNumero = p.numero_pedido || `#${p.id}`;

    const itemsHtml = Array.isArray(p.items) && p.items.length
      ? p.items.map(item => `
          <li>${item.nombre} x${item.qty} — $${(Number(item.precio) * Number(item.qty)).toFixed(2)}</li>
        `).join("")
      : `<li>Sin detalle de productos</li>`;

    return `
      <div class="pedido-card ${estadoClass}">
        <div class="pedido-top">
          <div>
            <h3>${p.nombre}</h3>
            <span class="pedido-phone">📞 ${p.telefono}</span>
            <p class="pedido-time">🧾 Pedido: <strong>${pedidoNumero}</strong></p>
            <p class="pedido-time">🕒 ${fechaLocal}</p>
            <p class="pedido-time">⏱️ ${tiempo}</p>
          </div>
          <span class="estado-badge ${estadoClass}">${p.estado}</span>
        </div>
        <div class="pedido-body">
          <p>📍 ${p.direccion}</p>
          <p>💳 ${p.metodo_pago}</p>
          <p>💰 <strong>$${Number(p.total).toFixed(2)}</strong></p>
          <p>📝 ${p.notas || "Sin notas"}</p>
          <div class="pedido-items">
            <strong>Productos:</strong>
            <ul>${itemsHtml}</ul>
          </div>
        </div>
        <div class="pedido-actions">
          <select onchange="cambiarEstado(${p.id}, this.value)">
            <option ${p.estado === "Recibido" ? "selected" : ""}>Recibido</option>
            <option ${p.estado === "En proceso" ? "selected" : ""}>En proceso</option>
            <option ${p.estado === "El repartidor está en camino" ? "selected" : ""}>El repartidor está en camino</option>
            <option ${p.estado === "Entregado" ? "selected" : ""}>Entregado</option>
          </select>
          <a href="${mapa}" target="_blank" class="map-btn">Mapa</a>
        </div>
      </div>
    `;
  }).join("");
}

async function cambiarEstado(id, nuevoEstado) {
  const { error } = await supabaseClient
    .from("pedidos")
    .update({ estado: nuevoEstado })
    .eq("id", id);

  if (error) {
    handleError(error, "No se pudo actualizar el pedido.");
    return;
  }

  showToast("Estado actualizado correctamente", "success");
  await cargarPedidosRepartidor();
}

function actualizarStatsRepartidor() {
  const asignados = pedidosRepartidor.length;
  const enCamino = pedidosRepartidor.filter(p => p.estado === "El repartidor está en camino").length;
  const entregados = pedidosRepartidor.filter(p => p.estado === "Entregado").length;

  document.getElementById("statAsignados").textContent = asignados;
  document.getElementById("statCamino").textContent = enCamino;
  document.getElementById("statEntregadosR").textContent = entregados;
}

// ======================
// RECAUDACIÓN Y CORTES
// ======================
async function obtenerTotalesRecaudacionPorFecha() {
  const pedidosEfectivoEntregados = pedidosRepartidor.filter(p => 
    p.metodo_pago === "Efectivo" && p.estado === "Entregado"
  );
  const totalRecaudado = pedidosEfectivoEntregados.reduce((sum, p) => sum + Number(p.total), 0);

  let totalEntregado = 0;
  if (userIdActual) {
    let query = supabaseClient
      .from("repartidor_cortes")
      .select("monto")
      .eq("repartidor_id", userIdActual);

    if (fechaFiltro) {
      query = query.gte("fecha_corte", `${fechaFiltro}T00:00:00-06:00`)
                   .lt("fecha_corte", `${fechaFiltro}T23:59:59-06:00`);
    }

    const { data: cortes, error } = await query;
    if (!error && cortes) {
      totalEntregado = cortes.reduce((sum, c) => sum + Number(c.monto), 0);
    }
  }

  const saldo = totalRecaudado - totalEntregado;
  return { totalRecaudado, totalEntregado, saldo };
}

async function actualizarResumenEfectivo() {
  if (!userIdActual) return;
  try {
    const { totalRecaudado, totalEntregado, saldo } = await obtenerTotalesRecaudacionPorFecha();
    document.getElementById("totalRecaudado").textContent = `$${totalRecaudado.toFixed(2)}`;
    document.getElementById("totalEntregado").textContent = `$${totalEntregado.toFixed(2)}`;
    document.getElementById("saldoPendiente").textContent = `$${saldo.toFixed(2)}`;
  } catch (err) {
    console.error("Error actualizando resumen:", err);
  }
}

function abrirModalEntrega() {
  document.getElementById("modalEntrega").style.display = "block";
  document.body.style.overflow = "hidden";
}

function cerrarModalEntrega() {
  document.getElementById("modalEntrega").style.display = "none";
  document.body.style.overflow = "auto";
  document.getElementById("entregaMonto").value = "";
  document.getElementById("entregaNotas").value = "";
}

async function registrarEntrega() {
  const montoInput = document.getElementById("entregaMonto");
  const notasInput = document.getElementById("entregaNotas");
  let monto = parseFloat(montoInput.value);
  const notas = notasInput.value.trim();

  if (isNaN(monto) || monto <= 0) {
    showToast("Ingresa un monto válido mayor a 0.");
    return;
  }

  const { saldo } = await obtenerTotalesRecaudacionPorFecha();
  if (monto > saldo) {
    showToast(`No puedes entregar más de $${saldo.toFixed(2)} (saldo actual para este período).`);
    return;
  }

  const { error } = await supabaseClient
    .from("repartidor_cortes")
    .insert([{
      repartidor_id: userIdActual,
      monto: monto,
      notas: notas || null
    }]);

  if (error) {
    handleError(error, "Error al registrar la entrega.");
    return;
  }

  showToast(`Entrega de $${monto.toFixed(2)} registrada correctamente.`, "success");
  cerrarModalEntrega();
  await actualizarResumenEfectivo();
  await cargarHistorialEntregas();
}

// ======================
// HISTORIAL DE ENTREGAS (con filtro y eliminación)
// ======================
async function limpiarRegistrosAntiguos() {
  const fechaLimite = new Date();
  fechaLimite.setDate(fechaLimite.getDate() - 8);
  const fechaLimiteStr = fechaLimite.toISOString();

  const { error } = await supabaseClient
    .from("repartidor_cortes")
    .delete()
    .lt("fecha_corte", fechaLimiteStr)
    .eq("repartidor_id", userIdActual);

  if (error) {
    console.error("Error al limpiar registros antiguos:", error);
  } else {
    console.log("Registros antiguos eliminados (más de 8 días)");
  }
}

async function cargarHistorialEntregas() {
  if (!userIdActual) return;

  await limpiarRegistrosAntiguos();

  let query = supabaseClient
    .from("repartidor_cortes")
    .select("*")
    .eq("repartidor_id", userIdActual)
    .order("fecha_corte", { ascending: false });

  const fechaInicio = document.getElementById("historialFechaInicio")?.value;
  const fechaFin = document.getElementById("historialFechaFin")?.value;

  if (fechaInicio) {
    query = query.gte("fecha_corte", `${fechaInicio}T00:00:00-06:00`);
  }
  if (fechaFin) {
    query = query.lte("fecha_corte", `${fechaFin}T23:59:59-06:00`);
  }

  const { data, error } = await query;
  if (error) {
    handleError(error, "Error al cargar historial de entregas.");
    return;
  }

  const contenedor = document.getElementById("historialEntregas");
  if (!contenedor) return;

  if (!data || data.length === 0) {
    contenedor.innerHTML = `<div class="panel">No hay registros de entregas en este período.</div>`;
    return;
  }

  contenedor.innerHTML = data.map(corte => {
    const fecha = new Date(corte.fecha_corte).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      hour12: true
    });
    return `
      <div class="admin-item">
        <div>
          <strong>💰 $${Number(corte.monto).toFixed(2)}</strong>
          <p>📅 ${fecha}</p>
          ${corte.notas ? `<p><small>📝 ${corte.notas}</small></p>` : ''}
        </div>
        <div class="admin-actions">
          <button class="delete-btn" onclick="eliminarRegistroEntrega(${corte.id})">🗑️ Eliminar</button>
        </div>
      </div>
    `;
  }).join("");
}

// Nueva función para eliminar un registro de entrega
async function eliminarRegistroEntrega(id) {
  if (!confirm("¿Estás seguro de eliminar este registro de entrega? Esta acción no se puede deshacer.")) return;

  const { error } = await supabaseClient
    .from("repartidor_cortes")
    .delete()
    .eq("id", id)
    .eq("repartidor_id", userIdActual); // seguridad extra

  if (error) {
    handleError(error, "Error al eliminar el registro.");
    return;
  }

  showToast("Registro eliminado correctamente.", "success");
  // Recargar el historial (respeta filtros actuales)
  await cargarHistorialEntregas();
  // Actualizar el resumen de recaudación porque cambió el total entregado
  await actualizarResumenEfectivo();
}

function limpiarFiltroHistorial() {
  document.getElementById("historialFechaInicio").value = "";
  document.getElementById("historialFechaFin").value = "";
  cargarHistorialEntregas();
}

// ======================
// UTILIDADES PARA FILTROS DE PEDIDOS
// ======================
function ponerHoyRepartidor() {
  const hoy = getHoy();
  const filtro = document.getElementById("filtroFechaRepartidor");
  if (filtro) filtro.value = hoy;
  cargarPedidosRepartidor();
}

function limpiarFiltroRepartidor() {
  const filtro = document.getElementById("filtroFechaRepartidor");
  if (filtro) filtro.value = "";
  cargarPedidosRepartidor();
}

function logout() {
  supabaseClient.auth.signOut();
  window.location.href = "admin.html";
}

// ======================
// INICIALIZACIÓN Y AUTOACTUALIZACIÓN
// ======================
setInterval(() => {
  cargarPedidosRepartidor();
}, 10000);

(async function init() {
  const ok = await verificarSesion();
  if (!ok) return;
  await cargarPedidosRepartidor();
  await cargarHistorialEntregas();
})();