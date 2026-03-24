let pedidosCache = [];
let productosCache = [];
let repartidoresCache = [];
let chart = null;
let productoEditandoId = null;
let ultimoPedidoId = null;

const audio = new Audio("assets/notification.mp3");

// ======================
// UTILIDADES GENERALES
// ======================

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

function getFechaPedidoFiltro(p) {
  if (p.created_at) {
    const d = new Date(p.created_at);
    if (!isNaN(d.getTime())) {
      // Obtener fecha en zona horaria de México
      const year = d.toLocaleString('en-US', { timeZone: 'America/Mexico_City', year: 'numeric' });
      const month = d.toLocaleString('en-US', { timeZone: 'America/Mexico_City', month: '2-digit' });
      const day = d.toLocaleString('en-US', { timeZone: 'America/Mexico_City', day: '2-digit' });
      return `${year}-${month}-${day}`;
    }
  }
  if (p.fecha) return p.fecha;
  return "";
}

function formatearFechaPedido(p) {
  if (p.created_at) {
    const fecha = new Date(p.created_at);
    return fecha.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      hour12: true
    });
  }
  if (p.fecha) return p.fecha;
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

function reproducirNotificacion() {
  audio.play().catch(() => {});
  const alerta = document.createElement("div");
  alerta.className = "alerta-pedido";
  alerta.innerHTML = "🆕 Nuevo pedido recibido";
  document.body.appendChild(alerta);
  setTimeout(() => alerta.remove(), 3000);
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

function getRepartidorNombrePorId(userId) {
  const rep = repartidoresCache.find(r => r.user_id === userId);
  return rep?.full_name || "";
}

function getRepartidorTextoPedido(p) {
  if (p.repartidor_nombre && p.repartidor_nombre.trim()) {
    return p.repartidor_nombre;
  }
  if (p.repartidor_id) {
    const nombre = getRepartidorNombrePorId(p.repartidor_id);
    if (nombre) return nombre;
  }
  return "Sin asignar";
}

// ======================
// VERIFICACIÓN DE SESIÓN
// ======================

async function verificarSesionAdmin() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data?.user) {
    console.warn("No hay sesión activa, redirigiendo a login");
    window.location.href = "admin.html";
    return false;
  }
  const { data: rolData, error: rolError } = await supabaseClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .single();
  if (rolError || rolData?.role !== "admin") {
    console.warn("Usuario no es admin, redirigiendo");
    window.location.href = "admin.html";
    return false;
  }
  return true;
}

// ======================
// PRODUCTOS (CRUD)
// ======================

async function cargarProductosAdmin() {
  const { data, error } = await supabaseClient
    .from("productos")
    .select("*")
    .order("id", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  productosCache = data || [];
  renderProductosAdmin(productosCache);
}

function renderProductosAdmin(productos) {
  const cont = document.getElementById("productosAdmin");
  if (!cont) return;
  if (!productos.length) {
    cont.innerHTML = `<div class="panel">No hay productos</div>`;
    return;
  }
  cont.innerHTML = productos.map(p => {
    const img = p.imagen_url && p.imagen_url.trim() ? p.imagen_url : "https://via.placeholder.com/100";
    const tipoVenta = p.tipo_venta === 'granel' ? 'kg' : 'pieza';
    const subcategoriaHtml = p.subcategoria ? `<small class="subcat">${p.subcategoria}</small>` : '';
    return `
      <div class="admin-item">
        <img src="${img}" alt="${p.nombre}">
        <div>
          <strong>${p.nombre}</strong>
          <p>$${Number(p.precio).toFixed(2)} / ${tipoVenta}</p>
          <small>${p.categoria}</small> ${subcategoriaHtml}
          <p class="product-desc-small">${p.descripcion || 'Sin descripción'}</p>
          <div class="admin-actions">
            <button class="edit-btn" onclick="editarProducto(event, ${p.id})">Editar</button>
            <button class="delete-btn" onclick="eliminarProducto(event, ${p.id})">Eliminar</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function crearProducto() {
  console.log("crearProducto ejecutándose");
  const nombre = document.getElementById("nombre").value.trim();
  const precio = parseFloat(document.getElementById("precio").value);
  const categoria = document.getElementById("categoria").value;
  const imagen_url = document.getElementById("imagen_url").value.trim();
  const descripcion = document.getElementById("descripcion").value.trim();
  const tipoVenta = document.getElementById("tipoVenta").value;
  let subcategoria = null;
  if (categoria === "Marisquería") {
    subcategoria = document.getElementById("subcategoria").value;
    if (!subcategoria) {
      alert("Selecciona una subcategoría para Marisquería");
      return;
    }
  }
  if (!nombre || isNaN(precio)) {
    alert("Completa nombre y precio");
    return;
  }

  const nuevoProducto = {
    nombre,
    precio,
    categoria,
    imagen_url: imagen_url || null,
    descripcion: descripcion || null,
    tipo_venta: tipoVenta,
    subcategoria
  };

  if (productoEditandoId) {
    const { error } = await supabaseClient
      .from("productos")
      .update(nuevoProducto)
      .eq("id", productoEditandoId);
    if (error) {
      console.error("Error al editar:", error);
      alert("Error al editar: " + error.message);
      return;
    }
    productoEditandoId = null;
  } else {
    const { data, error } = await supabaseClient
      .from("productos")
      .insert([nuevoProducto])
      .select();
    if (error) {
      console.error("Error al crear:", error);
      alert("Error al crear: " + error.message);
      return;
    }
    console.log("Producto insertado:", data);
  }

  limpiarFormulario();
  await cargarProductosAdmin();
}

function editarProducto(event, id) {
  // efecto click
  const btn = event.target;
  if (btn) {
    btn.classList.add('clicked');
    setTimeout(() => btn.classList.remove('clicked'), 200);
  }

  const p = productosCache.find(x => x.id === id);
  if (!p) return;

  document.getElementById("nombre").value = p.nombre || "";
  document.getElementById("precio").value = p.precio || "";
  document.getElementById("categoria").value = p.categoria || "Pescadería";
  document.getElementById("imagen_url").value = p.imagen_url || "";
  document.getElementById("descripcion").value = p.descripcion || "";
  document.getElementById("tipoVenta").value = p.tipo_venta || "pieza";
  document.getElementById("previewImg").src = p.imagen_url || "";

  toggleSubcategoria();
  if (p.categoria === "Marisquería") {
    document.getElementById("subcategoria").value = p.subcategoria || "";
  } else {
    document.getElementById("subcategoria").value = "";
  }

  productoEditandoId = id;

  // Scroll y resaltado
  const formPanel = document.getElementById("productFormPanel");
  if (formPanel) {
    formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    formPanel.style.transition = 'box-shadow 0.3s';
    formPanel.style.boxShadow = '0 0 0 4px #0ea5a4';
    setTimeout(() => {
      formPanel.style.boxShadow = '';
    }, 1500);
  }
}

async function eliminarProducto(event, id) {
  const btn = event.target;
  if (btn) {
    btn.classList.add('clicked');
    setTimeout(() => btn.classList.remove('clicked'), 200);
  }

  if (!confirm("¿Eliminar producto?")) return;

  const { error } = await supabaseClient.from("productos").delete().eq("id", id);
  if (error) {
    console.error(error);
    alert("Error eliminando");
    return;
  }

  cargarProductosAdmin();
}

function limpiarFormulario() {
  const nombre = document.getElementById("nombre");
  const precio = document.getElementById("precio");
  const imagen = document.getElementById("imagen_url");
  const preview = document.getElementById("previewImg");
  const descripcion = document.getElementById("descripcion");
  const tipoVenta = document.getElementById("tipoVenta");
  const categoria = document.getElementById("categoria");
  const subcategoria = document.getElementById("subcategoria");
  if (nombre) nombre.value = "";
  if (precio) precio.value = "";
  if (imagen) imagen.value = "";
  if (preview) preview.src = "";
  if (descripcion) descripcion.value = "";
  if (tipoVenta) tipoVenta.value = "pieza";
  if (categoria) categoria.value = "Pescadería";
  if (subcategoria) subcategoria.value = "";
  const subDiv = document.getElementById("subcategoriaDiv");
  if (subDiv) subDiv.style.display = "none";
  productoEditandoId = null;
}

function toggleSubcategoria() {
  const categoria = document.getElementById("categoria")?.value;
  const subDiv = document.getElementById("subcategoriaDiv");
  if (categoria === "Marisquería") {
    subDiv.style.display = "block";
  } else {
    subDiv.style.display = "none";
  }
}

const imagenInput = document.getElementById("imagen_url");
if (imagenInput) {
  imagenInput.addEventListener("input", e => {
    const preview = document.getElementById("previewImg");
    if (preview) preview.src = e.target.value;
  });
}

// ======================
// REPARTIDORES
// ======================

async function cargarRepartidores() {
  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("user_id, full_name, role")
    .eq("role", "repartidor")
    .order("full_name", { ascending: true });
  if (error) {
    console.error(error);
    return;
  }
  repartidoresCache = data || [];
}

// ======================
// PEDIDOS
// ======================

async function cargarPedidos() {
  const estado = document.getElementById("filtroEstado")?.value || "Todos";
  const fecha = document.getElementById("filtroFecha")?.value || "";
  const { data, error } = await supabaseClient
    .from("pedidos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  const nuevosPedidos = data || [];
  if (nuevosPedidos.length > 0) {
    if (ultimoPedidoId && nuevosPedidos[0].id !== ultimoPedidoId) {
      reproducirNotificacion();
    }
    ultimoPedidoId = nuevosPedidos[0].id;
  }
  pedidosCache = nuevosPedidos;
  let pedidosFiltrados = [...pedidosCache];
  if (estado !== "Todos") {
    pedidosFiltrados = pedidosFiltrados.filter(p => p.estado === estado);
  }
  if (fecha) {
    pedidosFiltrados = pedidosFiltrados.filter(p => getFechaPedidoFiltro(p) === fecha);
  }
  renderPedidos(pedidosFiltrados);
  actualizarStats(pedidosCache);
  renderGrafica(pedidosFiltrados);
  renderRepartidores(pedidosFiltrados);
}

function renderPedidos(lista) {
  const cont = document.getElementById("pedidos");
  if (!cont) return;
  if (!lista.length) {
    cont.innerHTML = `<div class="panel">No hay pedidos</div>`;
    return;
  }
  cont.innerHTML = lista.map(p => {
    const estadoClass = getEstadoClass(p.estado, p.created_at || p.fecha);
    const fechaLocal = formatearFechaPedido(p);
    const tiempo = calcularTiempoPedido(p);
    const mapa = p.ubicacion ? p.ubicacion : "#";
    const repartidorAsignadoId = p.repartidor_id || "";
    const pedidoNumero = p.numero_pedido || `#${p.id}`;
    const itemsHtml = Array.isArray(p.items) && p.items.length
      ? p.items.map(item => `
          <li>${item.nombre} x${item.qty} — $${(Number(item.precio) * Number(item.qty)).toFixed(2)}</li>
        `).join("")
      : `<li>Sin detalle de productos</li>`;
    const repartidoresOptions = repartidoresCache.length
      ? repartidoresCache.map(r => `
          <option value="${r.user_id}" ${r.user_id === repartidorAsignadoId ? "selected" : ""}>
            ${r.full_name || "Sin nombre"}
          </option>
        `).join("")
      : `<option value="">No hay repartidores</option>`;
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
          <p>🚚 Repartidor: ${getRepartidorTextoPedido(p)}</p>
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
          <select onchange="asignarRepartidor(${p.id}, this.value)">
            <option value="">Asignar repartidor</option>
            ${repartidoresOptions}
          </select>
          <a href="${mapa}" target="_blank" class="map-btn">Mapa</a>
          <button class="delete-pedido-btn" onclick="eliminarPedido(${p.id})">🗑️ Eliminar</button>
        </div>
      </div>
    `;
  }).join("");
}

async function eliminarPedido(id) {
  if (!confirm("¿Estás seguro de eliminar este pedido? Esta acción no se puede deshacer.")) return;
  const { error } = await supabaseClient.from("pedidos").delete().eq("id", id);
  if (error) {
    console.error("Error al eliminar pedido:", error);
    alert("No se pudo eliminar el pedido.");
    return;
  }
  alert("Pedido eliminado correctamente.");
  cargarPedidos();
}

async function cambiarEstado(id, nuevoEstado) {
  const { error } = await supabaseClient.from("pedidos").update({ estado: nuevoEstado }).eq("id", id);
  if (error) {
    console.error(error);
    alert("Error actualizando estado");
    return;
  }
  cargarPedidos();
}

async function asignarRepartidor(id, repartidorId) {
  const repartidor = repartidoresCache.find(r => r.user_id === repartidorId);
  const payload = {
    repartidor_id: repartidorId || null,
    repartidor_nombre: repartidor ? (repartidor.full_name || "") : ""
  };
  const { error } = await supabaseClient.from("pedidos").update(payload).eq("id", id);
  if (error) {
    console.error(error);
    alert("No se pudo asignar el repartidor.");
    return;
  }
  cargarPedidos();
}

function actualizarStats(todos) {
  const hoy = getHoy();
  const pedidosHoy = todos.filter(p => getFechaPedidoFiltro(p) === hoy);
  const ingresos = pedidosHoy.reduce((acc, p) => acc + Number(p.total), 0);
  const enProceso = todos.filter(p => p.estado === "En proceso").length;
  const entregados = todos.filter(p => p.estado === "Entregado").length;
  const statPedidos = document.getElementById("statPedidos");
  const statIngresos = document.getElementById("statIngresos");
  const statProceso = document.getElementById("statProceso");
  const statEntregados = document.getElementById("statEntregados");
  if (statPedidos) statPedidos.textContent = pedidosHoy.length;
  if (statIngresos) statIngresos.textContent = `$${ingresos.toFixed(2)}`;
  if (statProceso) statProceso.textContent = enProceso;
  if (statEntregados) statEntregados.textContent = entregados;
}

function renderGrafica(lista) {
  const estados = {
    "Recibido": 0,
    "En proceso": 0,
    "El repartidor está en camino": 0,
    "Entregado": 0
  };
  lista.forEach(p => {
    if (estados[p.estado] !== undefined) estados[p.estado]++;
  });
  const canvas = document.getElementById("graficaPedidos");
  if (!canvas) return;
  if (chart) chart.destroy();
  chart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: Object.keys(estados),
      datasets: [{ data: Object.values(estados) }]
    }
  });
}

function renderRepartidores(lista) {
  const cont = document.getElementById("resumenRepartidores");
  if (!cont) return;
  const pedidosFiltrados = lista.filter(p => p.metodo_pago === "Efectivo" && p.estado === "Entregado");
  const resumen = {};
  pedidosFiltrados.forEach(p => {
    const key = getRepartidorTextoPedido(p);
    if (!key || key === "Sin asignar") return;
    if (!resumen[key]) resumen[key] = 0;
    resumen[key] += Number(p.total);
  });
  const entradas = Object.entries(resumen);
  if (!entradas.length) {
    cont.innerHTML = `<div class="panel">No hay pedidos en efectivo entregados en esta vista.</div>`;
    return;
  }
  cont.innerHTML = entradas.map(([nombre, total]) => `
    <div class="admin-item">
      <strong>${nombre}</strong>
      <div>$${total.toFixed(2)}</div>
    </div>
  `).join("");
}

function ponerHoy() {
  const filtro = document.getElementById("filtroFecha");
  if (filtro) filtro.value = getHoy();
  cargarPedidos();
}

function cerrarDia() {
  const fecha = document.getElementById("filtroFecha")?.value || getHoy();
  localStorage.setItem("fishmar_dia_cerrado", fecha);
  alert(`Día cerrado: ${fecha}.`);
}

function logout() {
  supabaseClient.auth.signOut();
  window.location.href = "admin.html";
}

setInterval(() => {
  cargarPedidos();
}, 5000);

// Inicialización
(async function initDashboard() {
  const autenticado = await verificarSesionAdmin();
  if (!autenticado) return;
  await cargarRepartidores();
  await cargarPedidos();
  await cargarProductosAdmin();
})();