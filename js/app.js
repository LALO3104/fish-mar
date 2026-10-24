// js/app.js — página pública (pedidos a domicilio)
// Dependencias: supabaseClient (supabase.js), utils.js

let carrito = [];
let productos = [];
let categoriaActual = "all";
let subcategoriaActual = "";
let ubicacionActual = "";

// Mapa
let mapInstance = null;
let marker = null;
let ubicacionSeleccionadaLatLng = null;

const NUMERO_WHATSAPP = "5569080488";
const PASO_KG = 0.25;

const $ = (id) => document.getElementById(id);

function construirItemsPedido() {
  // Solo id y cantidad: el precio real lo toma la base de datos
  return carrito.map(item => ({
    id: Number(item.id),
    qty: Number(item.qty) || 1
  }));
}

function formatoCantidad(item) {
  return item.tipo_venta === "granel" ? `${Number(item.qty).toFixed(2)} kg` : `${Number(item.qty)}`;
}

function totalCarrito() {
  return carrito.reduce((acc, item) => acc + Number(item.precio) * Number(item.qty), 0);
}

function abrirHoja(id) {
  $(id).style.display = "block";
  document.body.classList.add("no-scroll");
}

function cerrarHoja(id) {
  $(id).style.display = "none";
  if (![...document.querySelectorAll(".modal, .map-modal")].some(m => m.style.display === "block")) {
    document.body.classList.remove("no-scroll");
  }
}

// ======================
// CARRITO
// ======================
function updateCartBadge() {
  const piezas = carrito.reduce((acc, item) => acc + (item.tipo_venta === "granel" ? 1 : Number(item.qty)), 0);
  $("cartCountBadge").textContent = piezas;
  $("cartBarTotal").textContent = formatoDinero(roundUpToHalf(totalCarrito()));
  $("cartBar").hidden = carrito.length === 0;
}

function renderCartModal() {
  const body = $("cartModalBody");
  const subtotal = roundUpToHalf(totalCarrito());
  $("modalSubtotal").textContent = subtotal.toFixed(2);
  $("modalTotal").textContent = subtotal.toFixed(2);

  if (carrito.length === 0) {
    body.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🛒</div>
        <div class="empty-title">Tu pedido está vacío</div>
        <p class="mt-8">Agrega productos del menú.</p>
      </div>`;
    return;
  }

  body.innerHTML = carrito.map(item => {
    const esGranel = item.tipo_venta === "granel";
    const paso = esGranel ? PASO_KG : 1;
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
            <button type="button" class="modal-qty-minus" data-id="${item.id}" data-step="${paso}" aria-label="Menos">−</button>
            <span class="stepper-value">${formatoCantidad(item)}</span>
            <button type="button" class="modal-qty-plus" data-id="${item.id}" data-step="${paso}" aria-label="Más">+</button>
          </div>
          <button class="btn btn-text danger modal-remove" data-id="${item.id}"><i class="fa-solid fa-trash-can"></i> Quitar</button>
        </div>
      </div>`;
  }).join("");

  body.querySelectorAll(".modal-qty-minus, .modal-qty-plus").forEach(btn => btn.addEventListener("click", handleQtyChange));
  body.querySelectorAll(".modal-remove").forEach(btn => btn.addEventListener("click", handleRemove));
}

function handleQtyChange(e) {
  const btn = e.currentTarget;
  const step = parseFloat(btn.dataset.step);
  changeQty(parseInt(btn.dataset.id, 10), btn.classList.contains("modal-qty-plus") ? step : -step);
}

function handleRemove(e) {
  removeItem(parseInt(e.currentTarget.dataset.id, 10));
}

function renderCarrito() {
  updateCartBadge();
  renderCartModal();
}

function addToCart(id) {
  const producto = productos.find(p => p.id === id);
  if (!producto) return;

  let cantidad = 1;
  if (producto.tipo_venta === "granel") {
    cantidad = parseFloat($(`kg-${id}`)?.value);
    if (isNaN(cantidad) || cantidad <= 0) cantidad = 0.5;
  }

  const existente = carrito.find(item => item.id === id);
  if (existente) {
    existente.qty = Math.round((Number(existente.qty) + cantidad) * 100) / 100;
  } else {
    carrito.push({
      id: producto.id,
      nombre: producto.nombre,
      precio: Number(producto.precio),
      tipo_venta: producto.tipo_venta,
      qty: cantidad
    });
  }
  renderCarrito();

  // Confirmación visual
  const btn = $(`add-${id}`);
  if (btn) {
    btn.classList.add("btn-dark");
    btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Agregado!';
    setTimeout(() => {
      btn.classList.remove("btn-dark");
      btn.innerHTML = '<i class="fa-solid fa-plus"></i> Agregar';
    }, 900);
  }
  const bar = $("cartFloatingBtn");
  bar.classList.remove("bump");
  void bar.offsetWidth;
  bar.classList.add("bump");
}

function changeQty(id, delta) {
  const item = carrito.find(p => p.id === id);
  if (!item) return;
  const nueva = Number(item.qty) + delta;
  if (nueva <= 0.001) {
    carrito = carrito.filter(p => p.id !== id);
  } else {
    item.qty = item.tipo_venta === "granel" ? Math.round(nueva * 100) / 100 : Math.round(nueva);
  }
  renderCarrito();
}

function removeItem(id) {
  carrito = carrito.filter(p => p.id !== id);
  renderCarrito();
}

// ======================
// PRODUCTOS Y CATEGORÍAS
// ======================
async function cargarProductos() {
  const { data, error } = await supabaseClient
    .from("productos")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    $("productos").innerHTML = `
      <div class="empty"><div class="empty-icon">📶</div>
      <div class="empty-title">No pudimos cargar el menú</div>
      <p class="mt-8">Revisa tu internet y recarga la página.</p></div>`;
    handleError(error, "Error al cargar productos. Recarga la página.");
    return;
  }
  productos = data || [];
  renderProductos();
}

function renderProductos() {
  const cont = $("productos");

  let filtrados = categoriaActual === "all" ? productos : productos.filter(p => p.categoria === categoriaActual);
  if (categoriaActual === "Marisquería" && subcategoriaActual) {
    filtrados = filtrados.filter(p => p.subcategoria === subcategoriaActual);
  }

  if (!filtrados.length) {
    cont.innerHTML = `<div class="empty"><div class="empty-icon">🐟</div><div class="empty-title">No hay productos aquí por ahora</div></div>`;
    return;
  }

  cont.innerHTML = filtrados.map(p => {
    const esGranel = p.tipo_venta === "granel";
    const precio = Number(p.precio);
    const img = p.imagen_url && p.imagen_url.trim()
      ? `<img class="product-img" src="${safeUrl(p.imagen_url)}" alt="${escapeHtml(p.nombre)}" loading="lazy">`
      : `<div class="product-img thumb-empty">${p.categoria === "Pescadería" ? "🐟" : "🦐"}</div>`;
    const descripcion = p.descripcion || (esGranel ? "Se vende por kilo" : "");
    const kgHtml = esGranel ? `
      <div class="stepper">
        <button type="button" onclick="ajustarKg(${p.id}, -${PASO_KG})" aria-label="Menos">−</button>
        <input type="number" id="kg-${p.id}" value="0.5" step="0.05" min="0.05" inputmode="decimal" aria-label="Kilos"
               oninput="actualizarPrecioKg(${p.id})">
        <button type="button" onclick="ajustarKg(${p.id}, ${PASO_KG})" aria-label="Más">+</button>
      </div>
      <span class="kg-hint">kg · <strong id="price-${p.id}">$${(0.5 * precio).toFixed(2)}</strong></span>` : "";

    return `
      <article class="product">
        ${img}
        <div class="product-info">
          <div class="product-cat">${escapeHtml(p.subcategoria || p.categoria)}</div>
          <div class="product-name">${escapeHtml(p.nombre)}</div>
          ${descripcion ? `<div class="product-desc">${escapeHtml(descripcion)}</div>` : ""}
          <div class="product-price">$${precio.toFixed(2)} <small>${esGranel ? "por kg" : "c/u"}</small></div>
        </div>
        <div class="product-actions">
          ${kgHtml}
          <button class="btn btn-accent" id="add-${p.id}" onclick="addToCart(${p.id})">
            <i class="fa-solid fa-plus"></i> Agregar
          </button>
        </div>
      </article>`;
  }).join("");
}

function ajustarKg(id, delta) {
  const input = $(`kg-${id}`);
  if (!input) return;
  let kg = (parseFloat(input.value) || 0) + delta;
  if (kg < PASO_KG) kg = PASO_KG;
  input.value = Math.round(kg * 100) / 100;
  actualizarPrecioKg(id);
}

function actualizarPrecioKg(id) {
  const p = productos.find(x => x.id === id);
  const kg = parseFloat($(`kg-${id}`)?.value) || 0;
  const el = $(`price-${id}`);
  if (p && el) el.textContent = `$${(kg * Number(p.precio)).toFixed(2)}`;
}

function renderSubcategorias() {
  const bar = $("subcategoriaBar");
  if (categoriaActual !== "Marisquería") {
    bar.style.display = "none";
    return;
  }
  const subcats = [...new Set(productos.filter(p => p.categoria === "Marisquería").map(p => p.subcategoria).filter(Boolean))];
  bar.innerHTML = [""].concat(subcats).map(s => `
    <button class="chip subcat-btn ${s === subcategoriaActual ? "active" : ""}" data-sub="${escapeHtml(s)}">${s ? escapeHtml(s) : "Todas"}</button>`).join("");
  bar.querySelectorAll(".subcat-btn").forEach(btn => btn.addEventListener("click", () => switchSubcategoria(btn.dataset.sub)));
  bar.style.display = "flex";
}

function switchCategory(categoria) {
  categoriaActual = categoria;
  subcategoriaActual = "";
  $("btnAll").classList.toggle("active", categoria === "all");
  $("btnPescaderia").classList.toggle("active", categoria === "Pescadería");
  $("btnMarisqueria").classList.toggle("active", categoria === "Marisquería");
  renderSubcategorias();
  updateSubcategoryMessage();
  renderProductos();
}

function switchSubcategoria(subcat) {
  subcategoriaActual = subcat;
  renderSubcategorias();
  updateSubcategoryMessage();
  renderProductos();
}

function updateSubcategoryMessage() {
  const messageDiv = $("subcategoryMessage");
  const textos = {
    Mojarras: "Las mojarras incluyen ensalada de frutos rojos y papas a la francesa.",
    Camarones: "Los camarones incluyen ensalada de frutos rojos y papas a la francesa.",
    Filetes: "Los filetes incluyen ensalada de frutos rojos y papas a la francesa."
  };
  const texto = textos[subcategoriaActual];
  messageDiv.querySelector(".message-content").textContent = texto || "";
  messageDiv.style.display = texto ? "flex" : "none";
}

// ======================
// UBICACIÓN
// ======================
function marcarUbicacion(lat, lng, texto) {
  ubicacionActual = `https://www.google.com/maps?q=${lat},${lng}`;
  const el = $("ubicacion");
  el.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(texto)}`;
  el.classList.add("ok");
}

function obtenerUbicacion() {
  if (!navigator.geolocation) {
    showToast("Tu celular no permite compartir la ubicación. Usa \"Elegir en mapa\".");
    return;
  }
  const btn = $("modalUbicacionBtn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando…';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Mi ubicación';
      marcarUbicacion(pos.coords.latitude, pos.coords.longitude, "Ubicación lista");
    },
    () => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Mi ubicación';
      showToast("No pudimos obtener tu ubicación. Activa el GPS o usa \"Elegir en mapa\".");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function abrirMapModal() {
  $("mapModal").style.display = "block";
  document.body.classList.add("no-scroll");

  if (!mapInstance) {
    mapInstance = L.map("map").setView([19.319, -98.882], 14);   // Ixtapaluca
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO'
    }).addTo(mapInstance);
    mapInstance.on("click", (e) => ponerMarcador(e.latlng));
  }
  setTimeout(() => mapInstance.invalidateSize(), 150);
}

function ponerMarcador(latlng) {
  if (marker) marker.remove();
  marker = L.marker(latlng).addTo(mapInstance);
  ubicacionSeleccionadaLatLng = latlng;
}

function cerrarMapModal() {
  cerrarHoja("mapModal");
}

async function buscarDireccion() {
  const query = $("searchAddress").value.trim();
  if (!query) {
    showToast("Escribe tu calle o colonia para buscar.");
    return;
  }
  const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=mx&q=${encodeURIComponent(query + ", Estado de México")}&limit=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length > 0) {
      const latlng = L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon));
      mapInstance.setView(latlng, 17);
      ponerMarcador(latlng);
    } else {
      showToast("No encontramos esa dirección. Prueba con otra o toca el mapa.");
    }
  } catch (err) {
    handleError(err, "No se pudo buscar la dirección.");
  }
}

function confirmarUbicacionMapa() {
  if (!ubicacionSeleccionadaLatLng) {
    showToast("Toca el mapa para marcar dónde está tu casa.");
    return;
  }
  marcarUbicacion(ubicacionSeleccionadaLatLng.lat, ubicacionSeleccionadaLatLng.lng, "Ubicación marcada en el mapa");
  cerrarMapModal();
}

// ======================
// VALIDACIÓN Y ENVÍO
// ======================
function getMetodoPago() {
  return document.querySelector('input[name="metodoPago"]:checked')?.value || "";
}

function getTelefono() {
  return $("modalTelefonoCliente").value.replace(/\D/g, "");
}

function clearModalErrors() {
  ["modalNombreCliente", "modalTelefonoCliente", "modalDireccionCliente", "modalMetodoPago"].forEach(id => {
    $(id)?.classList.remove("input-error", "input-success");
    const error = $(`error-${id}`);
    if (error) error.textContent = "";
  });
}

function setModalError(id, message) {
  $(id)?.classList.add("input-error");
  const error = $(`error-${id}`);
  if (error) error.textContent = message;
}

function validateModalForm() {
  clearModalErrors();
  const errores = [];

  if (!carrito.length) errores.push(["", "Tu pedido está vacío."]);
  if (!ubicacionActual) errores.push(["ubicacion", "Marca tu ubicación con \"Mi ubicación\" o \"Elegir en mapa\"."]);
  if ($("modalDireccionCliente").value.trim().length < 8) {
    errores.push(["modalDireccionCliente", "Escribe tu dirección completa (calle, número y colonia)."]);
  }
  if ($("modalNombreCliente").value.trim().length < 3) errores.push(["modalNombreCliente", "Escribe tu nombre."]);
  if (!/^[0-9]{10,15}$/.test(getTelefono())) errores.push(["modalTelefonoCliente", "Escribe tu teléfono de 10 dígitos."]);
  if (!getMetodoPago()) errores.push(["modalMetodoPago", "Elige cómo vas a pagar."]);

  errores.forEach(([id, msg]) => { if (id && id !== "ubicacion") setModalError(id, msg); });

  if (errores.length) {
    showToast(errores[0][1]);
    const primero = errores[0][0] && $(errores[0][0]);
    primero?.scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }
  return true;
}

async function enviarPedidoDesdeModal() {
  if (!validateModalForm()) return;

  const nombre = $("modalNombreCliente").value.trim();
  const telefono = getTelefono();
  const direccion = $("modalDireccionCliente").value.trim();
  const metodoPago = getMetodoPago();
  const notas = $("modalNotasPedido").value.trim();

  const btn = $("modalEnviarPedido");
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando…';

  try {
    // El número de pedido, los precios y el total los calcula la base de datos
    const { data: pedido, error } = await supabaseClient.rpc("crear_pedido_domicilio", {
      p_nombre: nombre,
      p_telefono: telefono,
      p_direccion: direccion,
      p_metodo_pago: metodoPago,
      p_ubicacion: ubicacionActual,
      p_notas: notas || null,
      p_items: construirItemsPedido()
    });

    if (error) {
      handleError(error, "No se pudo enviar el pedido. Inténtalo de nuevo.");
      return;
    }

    let mensaje = `🐟 *FishMar Pedido*\n\n`;
    mensaje += `🧾 *Pedido:* ${pedido.numero_pedido}\n`;
    mensaje += `👤 *Nombre:* ${nombre}\n`;
    mensaje += `📞 *Teléfono:* ${telefono}\n`;
    mensaje += `📍 *Dirección:* ${direccion}\n`;
    mensaje += `💳 *Pago:* ${metodoPago}\n\n`;
    mensaje += `🛒 *Productos:*\n`;
    pedido.items.forEach(item => {
      const unidad = item.tipo_venta === "granel" ? "kg" : "pz";
      const qtyDisplay = item.tipo_venta === "granel" ? Number(item.qty).toFixed(2) : item.qty;
      mensaje += `• ${item.nombre} ${qtyDisplay} ${unidad} - $${(Number(item.precio) * Number(item.qty)).toFixed(2)}\n`;
    });
    mensaje += `\n🧾 *Subtotal:* $${Number(pedido.subtotal).toFixed(2)}\n`;
    mensaje += `🚚 *Envío:* GRATIS\n`;
    mensaje += `💰 *Total redondeado:* $${Number(pedido.total).toFixed(2)}\n`;
    if (notas) mensaje += `📝 *Notas:* ${notas}\n`;
    mensaje += `\n📍 *Ubicación:* ${ubicacionActual}`;

    const url = `https://wa.me/52${NUMERO_WHATSAPP}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, "_blank");

    // Limpiar todo y mostrar confirmación
    carrito = [];
    renderCarrito();
    ["modalNombreCliente", "modalTelefonoCliente", "modalDireccionCliente", "modalNotasPedido"].forEach(id => { $(id).value = ""; });
    document.querySelectorAll('input[name="metodoPago"]').forEach(r => { r.checked = false; });
    ubicacionActual = "";
    $("ubicacion").textContent = "Todavía no marcas tu ubicación.";
    $("ubicacion").classList.remove("ok");
    clearModalErrors();

    closeCartModal();
    $("exitoNumero").textContent = pedido.numero_pedido;
    $("exitoWhatsApp").href = url;
    abrirHoja("modalExito");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Enviar pedido';
  }
}

function cerrarExito() {
  cerrarHoja("modalExito");
}

// ======================
// HOJA DEL CARRITO
// ======================
function openCartModal() {
  renderCartModal();
  abrirHoja("cartModal");
}

function closeCartModal() {
  cerrarHoja("cartModal");
}

$("cartFloatingBtn").addEventListener("click", openCartModal);
$("closeCartBtn").addEventListener("click", closeCartModal);
$("cartModal").addEventListener("click", (e) => { if (e.target.id === "cartModal") closeCartModal(); });
$("searchAddress").addEventListener("keydown", (e) => { if (e.key === "Enter") buscarDireccion(); });

// ======================
// CARRUSEL
// ======================
let currentSlide = 0;
const slides = document.querySelectorAll(".carousel-slide");
const dotsContainer = document.querySelector(".carousel-dots");
let interval;

function showSlide(index) {
  slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
  document.querySelectorAll(".carousel-dots .dot").forEach((dot, i) => dot.classList.toggle("active", i === index));
}

function goToSlide(index) {
  currentSlide = (index + slides.length) % slides.length;
  showSlide(currentSlide);
  clearInterval(interval);
  interval = setInterval(() => goToSlide(currentSlide + 1), 5000);
}

if (slides.length) {
  slides.forEach((_, idx) => {
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.addEventListener("click", () => goToSlide(idx));
    dotsContainer.appendChild(dot);
  });
  goToSlide(0);
}
document.querySelector(".carousel-control.prev")?.addEventListener("click", () => goToSlide(currentSlide - 1));
document.querySelector(".carousel-control.next")?.addEventListener("click", () => goToSlide(currentSlide + 1));

// ======================
// INICIO
// ======================
cargarProductos();
renderCarrito();
