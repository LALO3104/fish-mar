// js/mesero.js
let productos = [];
let categoriaActual = "Marisquería";   // Siempre Marisquería
let subcategoriaActual = "";
let pedidosActivos = [];
let pedidoSeleccionadoId = null;
let carritoActual = [];
let meseroId = null;
let textoBusqueda = "";

// Variables para descuento y comisión en cierre
let descuentoValor = 0;
let descuentoTipo = "monto";
let descuentoMonto = 0;
let comisionTarjeta = 0;       // 4.5% sobre total después de descuento

// DOM elements
const listaPedidosDiv = document.getElementById("listaPedidosActivos");
const productosDiv = document.getElementById("productosMesero");
const carritoDiv = document.getElementById("carritoActual");
const totalSpan = document.getElementById("totalActual");
const mesaActualSpan = document.getElementById("mesaActual");
const buscadorInput = document.getElementById("buscadorProductos");

// ======================
// AUTENTICACIÓN
// ======================
async function verificarSesionMesero() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data?.user) {
    showToast("No hay sesión activa.");
    window.location.href = "admin.html";
    return false;
  }
  const userId = data.user.id;
  const { data: rolData, error: rolError } = await supabaseClient
    .from("user_roles")
    .select("role, full_name")
    .eq("user_id", userId)
    .single();
  if (rolError || rolData.role !== "mesero") {
    showToast("Acceso solo para meseros.");
    window.location.href = "admin.html";
    return false;
  }
  meseroId = userId;
  return true;
}

// ======================
// PRODUCTOS (solo Marisquería)
// ======================
async function cargarProductosMesero() {
  const { data, error } = await supabaseClient
    .from("productos")
    .select("*")
    .eq("categoria", "Marisquería")   // ← Filtrar solo Marisquería
    .order("id");
  if (error) {
    handleError(error);
    return;
  }
  productos = data || [];
  renderProductosMesero();
  // Construir subcategorías dinámicas
  const subcats = [...new Set(productos.map(p => p.subcategoria).filter(Boolean))];
  const subBar = document.getElementById("subcategoriaBarMesero");
  if (subBar) {
    subBar.innerHTML = `<button class="subcat-btn active" data-sub="">Todas</button>` +
      subcats.map(s => `<button class="subcat-btn" data-sub="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
    subBar.style.display = "flex";
    document.querySelectorAll("#subcategoriaBarMesero .subcat-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        subcategoriaActual = e.target.dataset.sub;
        renderProductosMesero();
      });
    });
  }
}

function filtrarProductosPorTexto() {
  renderProductosMesero();
}

function renderProductosMesero() {
  if (!productosDiv) return;
  
  let filtrados = productos;
  // Filtrar por subcategoría
  if (subcategoriaActual) {
    filtrados = filtrados.filter(p => p.subcategoria === subcategoriaActual);
  }
  // Filtrar por texto de búsqueda
  if (textoBusqueda.trim() !== "") {
    const busq = textoBusqueda.toLowerCase();
    filtrados = filtrados.filter(p => p.nombre.toLowerCase().includes(busq));
  }

  productosDiv.innerHTML = filtrados.map(p => {
    const img = p.imagen_url ? safeUrl(p.imagen_url) : "https://via.placeholder.com/300x200?text=Sin+imagen";
    const tipoVenta = p.tipo_venta === 'granel' ? 'kg' : 'pieza';
    const esGranel = p.tipo_venta === 'granel';
    let inputHtml = '';
    if (esGranel) {
      inputHtml = `<div class="quantity-selector">
        <input type="number" id="kg-${p.id}" class="qty-input" value="0.1" step="0.01" min="0.01" style="width:80px;">
        <span>kg</span>
      </div>`;
    }
    return `
      <div class="product-card">
        <img class="product-image" src="${img}" alt="${escapeHtml(p.nombre)}" loading="lazy">
        <div class="product-body">
          <div class="product-name">${escapeHtml(p.nombre)}</div>
          <div class="price">$${Number(p.precio).toFixed(2)} / ${tipoVenta}</div>
          ${inputHtml}
          <button class="small-btn" onclick="agregarAlPedidoActual(${p.id})">Agregar</button>
        </div>
      </div>
    `;
  }).join("");
}

// ======================
// PEDIDOS ACTIVOS
// ======================
async function cargarPedidosActivos() {
  const { data, error } = await supabaseClient
    .from("pedidos")
    .select("*")
    .eq("tipo_pedido", "local")
    .eq("estado_local", "abierto")
    .order("created_at", { ascending: false });

  if (error) {
    handleError(error);
    return;
  }
  pedidosActivos = data || [];
  renderListaPedidos();
}

function renderListaPedidos() {
  if (!listaPedidosDiv) return;
  if (pedidosActivos.length === 0) {
    listaPedidosDiv.innerHTML = '<div class="empty-cart">No hay pedidos abiertos</div>';
    return;
  }
  listaPedidosDiv.innerHTML = pedidosActivos.map(ped => {
    const total = calcularTotalPedido(ped.items || []);
    const activo = (pedidoSeleccionadoId === ped.id) ? 'activo' : '';
    return `
      <div class="pedido-resumen ${activo}" onclick="seleccionarPedido(${ped.id})">
        <div>
          <div class="pedido-mesa">📌 ${escapeHtml(ped.mesa || "Sin mesa")}</div>
          <small>${new Date(ped.created_at).toLocaleTimeString('es-MX', { timeZone: ZONA_MX, hour: '2-digit', minute: '2-digit' })}</small>
        </div>
        <div class="pedido-total">$${total.toFixed(2)}</div>
      </div>
    `;
  }).join("");
}

function calcularTotalPedido(items) {
  if (!items) return 0;
  return items.reduce((sum, i) => sum + (Number(i.precio) * Number(i.qty)), 0);
}

async function seleccionarPedido(id) {
  const pedido = pedidosActivos.find(p => p.id === id);
  if (!pedido) return;
  pedidoSeleccionadoId = id;
  carritoActual = pedido.items ? JSON.parse(JSON.stringify(pedido.items)) : [];
  mesaActualSpan.innerText = pedido.mesa || "Sin mesa";
  renderCarritoActual();
  renderListaPedidos();
  // En celular, al elegir un pedido saltar directo a los productos
  if (esCelular()) {
    document.getElementById("panelProductosMesero")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function esCelular() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function irAlCarritoMesero() {
  document.getElementById("carritoMesero")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Mantiene al día la barra fija inferior (solo visible en celular)
function actualizarBarraMovil(total) {
  const barraMesa = document.getElementById("barraMesa");
  const barraTotal = document.getElementById("barraTotal");
  if (barraMesa) barraMesa.textContent = pedidoSeleccionadoId ? mesaActualSpan.innerText : "Ningún pedido";
  if (barraTotal) barraTotal.textContent = total.toFixed(2);
}

async function crearNuevoPedido() {
  const mesa = prompt("Identificador del pedido (ej. Mesa 3, Barra, Para llevar):");
  if (!mesa) return;
  const nuevoPedido = {
    tipo_pedido: "local",
    mesa: mesa,
    mesero_id: meseroId,
    estado_local: "abierto",
    items: [],
    total: 0,
    nombre: "Cliente local",
    telefono: "0000000000",
    direccion: "Local",
    metodo_pago: null
  };
  const { data, error } = await supabaseClient
    .from("pedidos")
    .insert([nuevoPedido])
    .select();
  if (error) {
    handleError(error);
    return;
  }
  showToast("Pedido creado", "success");
  await cargarPedidosActivos();
  seleccionarPedido(data[0].id);
}

// ======================
// CARRITO Y MODIFICACIONES
// ======================
function agregarAlPedidoActual(productoId) {
  if (!pedidoSeleccionadoId) {
    showToast("Primero selecciona o crea un pedido");
    return;
  }
  const producto = productos.find(p => p.id === productoId);
  if (!producto) return;
  let cantidad = 1;
  if (producto.tipo_venta === 'granel') {
    const input = document.getElementById(`kg-${productoId}`);
    if (input) cantidad = parseFloat(input.value) || 0.1;
  }
  const existente = carritoActual.find(item => item.id === productoId);
  if (existente) {
    existente.qty += cantidad;
    if (producto.tipo_venta === 'granel') existente.qty = Math.round(existente.qty * 100) / 100;
  } else {
    carritoActual.push({
      id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      tipo_venta: producto.tipo_venta,
      qty: cantidad
    });
  }
  renderCarritoActual();
}

function renderCarritoActual() {
  if (!carritoDiv) return;
  if (carritoActual.length === 0) {
    carritoDiv.innerHTML = '<div class="empty-cart">Sin productos</div>';
    totalSpan.innerText = "0.00";
    actualizarBarraMovil(0);
    return;
  }
  let total = 0;
  carritoDiv.innerHTML = carritoActual.map(item => {
    const lineTotal = item.precio * item.qty;
    total += lineTotal;
    const unidad = item.tipo_venta === 'granel' ? 'kg' : 'pz';
    return `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(item.nombre)}</strong><br>
          ${Number(item.qty)} ${unidad} x $${Number(item.precio).toFixed(2)}
          <div class="cart-item-price">$${lineTotal.toFixed(2)}</div>
        </div>
        <div class="qty-controls">
          <button onclick="cambiarCantidad(${item.id}, -${item.tipo_venta === 'granel' ? 0.01 : 1})">-</button>
          <span>${item.tipo_venta === 'granel' ? item.qty.toFixed(2) : item.qty}</span>
          <button onclick="cambiarCantidad(${item.id}, ${item.tipo_venta === 'granel' ? 0.01 : 1})">+</button>
          <button class="remove" onclick="eliminarItem(${item.id})">Quitar</button>
        </div>
      </div>
    `;
  }).join("");
  totalSpan.innerText = total.toFixed(2);
  actualizarBarraMovil(total);
}

function cambiarCantidad(id, delta) {
  const item = carritoActual.find(i => i.id === id);
  if (!item) return;
  let nueva = item.qty + delta;
  if (nueva <= 0) {
    carritoActual = carritoActual.filter(i => i.id !== id);
  } else {
    if (item.tipo_venta === 'granel') nueva = Math.round(nueva * 100) / 100;
    else nueva = Math.round(nueva);
    item.qty = nueva;
  }
  renderCarritoActual();
}

function eliminarItem(id) {
  carritoActual = carritoActual.filter(i => i.id !== id);
  renderCarritoActual();
}

async function guardarPedidoActual() {
  if (!pedidoSeleccionadoId) return;
  const total = carritoActual.reduce((sum, i) => sum + i.precio * i.qty, 0);
  const { error } = await supabaseClient
    .from("pedidos")
    .update({ items: carritoActual, total: total })
    .eq("id", pedidoSeleccionadoId);
  if (error) {
    handleError(error);
    return;
  }
  showToast("Pedido actualizado", "success");
  await cargarPedidosActivos();
  const index = pedidosActivos.findIndex(p => p.id === pedidoSeleccionadoId);
  if (index !== -1) {
    pedidosActivos[index].items = [...carritoActual];
    pedidosActivos[index].total = total;
  }
  renderListaPedidos();
}

// ======================
// IMPRESIÓN DE COMANDA
// ======================
async function imprimirComanda() {
  if (!pedidoSeleccionadoId || carritoActual.length === 0) {
    showToast("No hay productos en el pedido actual");
    return;
  }
  const pedido = pedidosActivos.find(p => p.id === pedidoSeleccionadoId);
  const mesa = pedido?.mesa || "Sin mesa";
  let comandaHtml = `
    <div style="width: 80mm; font-family: monospace; padding: 10px;">
      <h2>🍽️ COMANDA</h2>
      <p><strong>Pedido:</strong> #${pedidoSeleccionadoId}</p>
      <p><strong>Mesa:</strong> ${escapeHtml(mesa)}</p>
      <hr>
      <table style="width:100%">
        <tr><th>Cant</th><th>Producto</th><th>Precio</th></tr>
  `;
  carritoActual.forEach(item => {
    const unidad = item.tipo_venta === 'granel' ? 'kg' : 'pz';
    comandaHtml += `<tr><td>${escapeHtml(item.qty)} ${unidad}</td><td>${escapeHtml(item.nombre)}</td><td>$${item.precio.toFixed(2)}</td></tr>`;
  });
  comandaHtml += `</table><hr><p>Fecha: ${new Date().toLocaleString()}</p><p>¡Gracias!</p></div>`;
  const ventana = window.open();
  ventana.document.write(comandaHtml);
  ventana.document.close();
  ventana.print();
  // Guardar en tabla comandas (opcional)
  await supabaseClient.from("comandas").insert([{
    pedido_id: pedidoSeleccionadoId,
    productos: carritoActual
  }]);
}

// ======================
// CIERRE CON DESCUENTO Y COMISIÓN POR TARJETA
// ======================
function abrirModalCierre() {
  if (!pedidoSeleccionadoId) return;
  const pedido = pedidosActivos.find(p => p.id === pedidoSeleccionadoId);
  if (!pedido) return;
  const subtotal = calcularTotalPedido(carritoActual);
  document.getElementById("cerrarMesa").innerText = pedido.mesa || "Sin mesa";
  document.getElementById("cerrarSubtotal").innerText = subtotal.toFixed(2);
  // Resetear descuentos y comisión
  descuentoValor = 0;
  descuentoTipo = "monto";
  descuentoMonto = 0;
  comisionTarjeta = 0;
  document.getElementById("descuentoValor").value = "";
  document.getElementById("descuentoTipo").value = "monto";
  document.getElementById("metodoPagoCierre").value = "Efectivo";
  actualizarInfoDescuentoCierre(subtotal);
  document.getElementById("modalCerrarPedido").style.display = "block";
}

function actualizarInfoDescuentoCierre(subtotal) {
  let descuento = 0;
  if (descuentoValor > 0) {
    if (descuentoTipo === "porcentaje") {
      descuento = subtotal * (descuentoValor / 100);
    } else {
      descuento = descuentoValor;
    }
    if (descuento > subtotal) descuento = subtotal;
  }
  descuentoMonto = descuento;
  let totalConDescuento = subtotal - descuento;
  // Aplicar comisión si el método es Tarjeta
  const metodo = document.getElementById("metodoPagoCierre").value;
  let totalFinal = totalConDescuento;
  if (metodo === "Tarjeta") {
    comisionTarjeta = totalConDescuento * 0.045;
    totalFinal = totalConDescuento + comisionTarjeta;
  } else {
    comisionTarjeta = 0;
  }
  totalFinal = roundUpToHalf(totalFinal);
  document.getElementById("montoDescuento").innerText = descuento.toFixed(2);
  document.getElementById("totalConDescuento").innerText = totalFinal.toFixed(2);
  // Mostrar o esconder línea de comisión
  let comisionHtml = document.getElementById("infoComision");
  if (!comisionHtml) {
    const container = document.getElementById("infoDescuentoCierre");
    if (container) {
      const div = document.createElement("div");
      div.id = "infoComision";
      div.style.marginTop = "8px";
      container.appendChild(div);
      comisionHtml = div;
    }
  }
  if (comisionHtml) {
    if (metodo === "Tarjeta" && comisionTarjeta > 0) {
      comisionHtml.innerHTML = `<div>💳 Comisión 4.5%: +$${comisionTarjeta.toFixed(2)}</div>`;
    } else {
      comisionHtml.innerHTML = "";
    }
  }
}

function aplicarDescuentoCierre() {
  const subtotal = parseFloat(document.getElementById("cerrarSubtotal").innerText);
  const valor = parseFloat(document.getElementById("descuentoValor").value);
  const tipo = document.getElementById("descuentoTipo").value;
  if (isNaN(valor) || valor <= 0) {
    showToast("Ingresa un valor válido para el descuento");
    return;
  }
  descuentoValor = valor;
  descuentoTipo = tipo;
  actualizarInfoDescuentoCierre(subtotal);
}

function quitarDescuentoCierre() {
  const subtotal = parseFloat(document.getElementById("cerrarSubtotal").innerText);
  descuentoValor = 0;
  document.getElementById("descuentoValor").value = "";
  actualizarInfoDescuentoCierre(subtotal);
}

function cerrarModalCierre() {
  document.getElementById("modalCerrarPedido").style.display = "none";
}

async function confirmarCierre() {
  const metodo = document.getElementById("metodoPagoCierre").value;
  const subtotal = calcularTotalPedido(carritoActual);
  let totalConDescuento = subtotal - descuentoMonto;
  let totalFinal = totalConDescuento;
  let comision = 0;
  if (metodo === "Tarjeta") {
    comision = totalConDescuento * 0.045;
    totalFinal = totalConDescuento + comision;
  }
  totalFinal = roundUpToHalf(totalFinal);

  const payload = {
    estado_local: "cerrado",
    fecha_cierre: new Date().toISOString(),
    metodo_pago_local: metodo,
    total: totalFinal,
    items: carritoActual,
    descuento_valor: descuentoValor,
    descuento_tipo: descuentoTipo,
    descuento_monto: descuentoMonto,
    comision_tarjeta: comision   // guardamos la comisión para el ticket
  };

  const { error } = await supabaseClient
    .from("pedidos")
    .update(payload)
    .eq("id", pedidoSeleccionadoId);

  if (error) {
    handleError(error);
    return;
  }

  showToast("Pedido cerrado correctamente", "success");
  cerrarModalCierre();
  imprimirTicketCliente(pedidoSeleccionadoId, carritoActual, subtotal, descuentoMonto, comision, totalFinal, metodo);
  await cargarPedidosActivos();
  pedidoSeleccionadoId = null;
  carritoActual = [];
  renderCarritoActual();
  mesaActualSpan.innerText = "Ninguno";
}

function imprimirTicketCliente(pedidoId, items, subtotal, descuento, comision, total, metodo) {
  let ticketHtml = `
    <div style="width: 80mm; font-family: monospace; padding: 10px;">
      <h2>🐟 Fish-Mar</h2>
      <p>Gracias por su visita</p>
      <hr>
      <table style="width:100%">
        <tr><th>Cant</th><th>Producto</th><th>Importe</th></tr>
        ${items.map(i => `<tr><td>${escapeHtml(i.qty)} ${i.tipo_venta==='granel'?'kg':'pz'}</td><td>${escapeHtml(i.nombre)}</td><td>$${(i.precio*i.qty).toFixed(2)}</td></tr>`).join('')}
      </table>
      <hr>
      <p>Subtotal: $${subtotal.toFixed(2)}</p>
      ${descuento > 0 ? `<p>Descuento: -$${descuento.toFixed(2)}</p>` : ''}
      ${comision > 0 ? `<p>Comisión tarjeta (4.5%): +$${comision.toFixed(2)}</p>` : ''}
      <p><strong>Total: $${total.toFixed(2)}</strong></p>
      <p>Pago: ${escapeHtml(metodo)}</p>
      <p>¡Vuelva pronto!</p>
    </div>
  `;
  const ventana = window.open();
  ventana.document.write(ticketHtml);
  ventana.document.close();
  ventana.print();
}

function anularPedido() {
  if (!pedidoSeleccionadoId) return;
  if (!confirm("¿Anular este pedido? Se perderán los productos.")) return;
  supabaseClient
    .from("pedidos")
    .update({ estado_local: "anulado" })
    .eq("id", pedidoSeleccionadoId)
    .then(() => {
      showToast("Pedido anulado", "success");
      cargarPedidosActivos();
      pedidoSeleccionadoId = null;
      carritoActual = [];
      renderCarritoActual();
      mesaActualSpan.innerText = "Ninguno";
    });
}

function logout() {
  supabaseClient.auth.signOut();
  window.location.href = "admin.html";
}

// ======================
// BÚSQUEDA Y CONFIGURACIÓN
// ======================
if (buscadorInput) {
  buscadorInput.addEventListener("input", (e) => {
    textoBusqueda = e.target.value;
    renderProductosMesero();
  });
}

// Escuchar cambio de método de pago en el modal
document.addEventListener("DOMContentLoaded", () => {
  const metodoSelect = document.getElementById("metodoPagoCierre");
  if (metodoSelect) {
    metodoSelect.addEventListener("change", () => {
      const subtotal = parseFloat(document.getElementById("cerrarSubtotal").innerText);
      actualizarInfoDescuentoCierre(subtotal);
    });
  }
});

// ======================
// INICIALIZACIÓN
// ======================
(async function init() {
  const ok = await verificarSesionMesero();
  if (!ok) return;
  await cargarProductosMesero();
  await cargarPedidosActivos();
  // Suscripción en tiempo real
  supabaseClient.channel('pedidos-local')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: 'tipo_pedido=eq.local' }, () => {
      cargarPedidosActivos();
    })
    .subscribe();
})();