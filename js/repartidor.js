let pedidosRepartidor = [];
let userIdActual = null;
let nombreRepartidor = "";

function getHoy() {
  return new Date().toISOString().split("T")[0];
}

function getFechaPedido(p) {
  if (p.created_at) {
    const d = new Date(p.created_at);
    if (!isNaN(d.getTime())) return d;
  }

  if (p.fecha) {
    const d = new Date(`${p.fecha}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function formatearFechaPedido(p) {
  if (p.created_at) {
    const fecha = new Date(p.created_at);
    // Formato: 22/03/2026, 02:40:38 p.m.
    return fecha.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      hour12: true
    });
  }
  if (p.fecha) {
    return p.fecha;
  }
  return "Sin fecha";
}

function calcularTiempoPedido(p) {
  const d = getFechaPedido(p);
  if (!d) return "Sin tiempo";

  const ahora = new Date();
  const diffMs = ahora - d;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Hace unos segundos";
  if (diffMin < 60) return `Hace ${diffMin} min`;

  const horas = Math.floor(diffMin / 60);
  if (horas < 24) return `Hace ${horas} h`;

  const dias = Math.floor(horas / 24);
  return `Hace ${dias} día(s)`;
}

function getEstadoClass(estado, fechaPedido) {
  let clase = "";

  if (estado === "Recibido") clase = "recibido";
  if (estado === "En proceso") clase = "enproceso";
  if (estado === "El repartidor está en camino") clase = "encamino";
  if (estado === "Entregado") clase = "entregado";

  const d = fechaPedido ? new Date(fechaPedido) : null;
  if (d && !isNaN(d.getTime())) {
    const ahora = new Date();
    const diffMin = Math.floor((ahora - d) / 60000);

    if (diffMin >= 30 && estado !== "Entregado") {
      clase += " urgente";
    } else if (diffMin >= 20 && estado !== "Entregado") {
      clase += " alerta";
    }
  }

  return clase.trim();
}

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

async function cargarPedidosRepartidor() {
  const ok = await verificarSesion();
  if (!ok) return;

  const { data, error } = await supabaseClient
    .from("pedidos")
    .select("*")
    .eq("repartidor_id", userIdActual)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  pedidosRepartidor = data || [];
  renderPedidosRepartidor();
  actualizarStatsRepartidor();
}

function renderPedidosRepartidor() {
  const cont = document.getElementById("misPedidos");
  if (!cont) return;

  if (!pedidosRepartidor.length) {
    cont.innerHTML = `<div class="panel">No tienes pedidos asignados.</div>`;
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
            <ul>
              ${itemsHtml}
            </ul>
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
    console.error(error);
    alert("No se pudo actualizar el pedido.");
    return;
  }

  cargarPedidosRepartidor();
}

function actualizarStatsRepartidor() {
  const asignados = pedidosRepartidor.length;
  const enCamino = pedidosRepartidor.filter(p => p.estado === "El repartidor está en camino").length;
  const entregados = pedidosRepartidor.filter(p => p.estado === "Entregado").length;

  const statAsignados = document.getElementById("statAsignados");
  const statCamino = document.getElementById("statCamino");
  const statEntregadosR = document.getElementById("statEntregadosR");

  if (statAsignados) statAsignados.textContent = asignados;
  if (statCamino) statCamino.textContent = enCamino;
  if (statEntregadosR) statEntregadosR.textContent = entregados;
}

function logout() {
  supabaseClient.auth.signOut();
  window.location.href = "admin.html";
}

setInterval(() => {
  cargarPedidosRepartidor();
}, 5000);

cargarPedidosRepartidor();