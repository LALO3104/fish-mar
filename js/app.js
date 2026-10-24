// js/app.js
// Dependencias: supabaseClient (supabase.js), utils.js

let carrito = [];
let productos = [];
let categoriaActual = "all";
let subcategoriaActual = "";
let ubicacionActual = "";

// Variables para el mapa
let mapInstance = null;
let marker = null;
let ubicacionSeleccionadaLatLng = null;

// Referencias a campos del modal
let modalNombreCliente, modalTelefonoCliente, modalDireccionCliente, modalMetodoPago, modalNotasPedido, modalUbicacionText;

function construirItemsPedido() {
  // Solo id y cantidad: el precio real lo toma la base de datos
  return carrito.map(item => ({
    id: Number(item.id),
    qty: Number(item.qty) || 1
  }));
}

// ======================
// CARRITO
// ======================

function updateCartBadge() {
  const badge = document.getElementById('cartCountBadge');
  if (badge) {
    const totalItems = carrito.reduce((acc, item) => acc + item.qty, 0);
    badge.textContent = totalItems;
  }
}

function renderCartModal() {
  const modalBody = document.getElementById('cartModalBody');
  const modalSubtotalSpan = document.getElementById('modalSubtotal');
  const modalTotalSpan = document.getElementById('modalTotal');
  if (!modalBody) return;

  if (carrito.length === 0) {
    modalBody.innerHTML = '<div class="empty-cart">Tu carrito está vacío</div>';
    if (modalSubtotalSpan) modalSubtotalSpan.textContent = '0.00';
    if (modalTotalSpan) modalTotalSpan.textContent = '0.00';
    return;
  }

  let subtotal = 0;
  const itemsHtml = carrito.map(item => {
    const precio = Number(item.precio);
    const cantidad = Number(item.qty);
    const lineTotal = precio * cantidad;
    subtotal += lineTotal;

    const unidad = item.tipo_venta === 'granel' ? 'kg' : 'pieza';
    const step = item.tipo_venta === 'granel' ? 0.01 : 1;
    const qtyDisplay = item.tipo_venta === 'granel' ? cantidad.toFixed(3) : cantidad;

    return `
      <div class="cart-item" data-id="${item.id}">
        <div class="cart-item-info">
          <strong>${item.nombre}</strong>
          <small>$${precio.toFixed(2)} / ${unidad}</small>
          <div class="cart-item-price">$${lineTotal.toFixed(2)}</div>
        </div>
        <div class="qty-controls">
          <button class="modal-qty-minus" data-id="${item.id}" data-step="${step}">−</button>
          <span>${qtyDisplay}</span>
          <button class="modal-qty-plus" data-id="${item.id}" data-step="${step}">+</button>
          <button class="remove modal-remove" data-id="${item.id}">Quitar</button>
        </div>
      </div>
    `;
  }).join('');

  modalBody.innerHTML = itemsHtml;
  const subtotalRedondeado = roundUpToHalf(subtotal);
  if (modalSubtotalSpan) modalSubtotalSpan.textContent = subtotalRedondeado.toFixed(2);
  if (modalTotalSpan) modalTotalSpan.textContent = subtotalRedondeado.toFixed(2);

  // Adjuntar eventos a los botones del modal
  document.querySelectorAll('.modal-qty-minus').forEach(btn => {
    btn.removeEventListener('click', handleQtyChange);
    btn.addEventListener('click', handleQtyChange);
  });
  document.querySelectorAll('.modal-qty-plus').forEach(btn => {
    btn.removeEventListener('click', handleQtyChange);
    btn.addEventListener('click', handleQtyChange);
  });
  document.querySelectorAll('.modal-remove').forEach(btn => {
    btn.removeEventListener('click', handleRemove);
    btn.addEventListener('click', handleRemove);
  });
}

function handleQtyChange(e) {
  const btn = e.currentTarget;
  const id = parseInt(btn.dataset.id);
  const step = parseFloat(btn.dataset.step);
  const delta = btn.classList.contains('modal-qty-plus') ? step : -step;
  changeQty(id, delta);
  renderCartModal(); // refrescar después de cambiar cantidad
}

function handleRemove(e) {
  const btn = e.currentTarget;
  const id = parseInt(btn.dataset.id);
  removeItem(id);
  renderCartModal();
}

function renderCarrito() {
  updateCartBadge();
  renderCartModal();
}

function addToCart(id) {
  const producto = productos.find(p => p.id === id);
  if (!producto) return;

  let cantidad = 1;
  if (producto.tipo_venta === 'granel') {
    const kgInput = document.getElementById(`kg-${id}`);
    if (kgInput) {
      let val = parseFloat(kgInput.value);
      if (isNaN(val) || val <= 0) val = 0.1;
      cantidad = val;
    } else {
      cantidad = 0.1;
    }
  }

  const existente = carrito.find(item => item.id === id);
  if (existente) {
    existente.qty += cantidad;
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

  const btn = document.querySelector(`button[onclick="addToCart(${id})"]`);
  if (btn) {
    btn.classList.add("clicked");
    setTimeout(() => btn.classList.remove("clicked"), 200);
  }
}

function changeQty(id, delta) {
  const item = carrito.find(p => p.id === id);
  if (!item) return;

  let newQty = item.qty + delta;
  if (newQty <= 0) {
    carrito = carrito.filter(p => p.id !== id);
  } else {
    if (item.tipo_venta === 'granel') {
      newQty = Math.round(newQty * 100) / 100;
    } else {
      newQty = Math.round(newQty);
    }
    item.qty = newQty;
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
    handleError(error, "Error al cargar productos. Recarga la página.");
    return;
  }

  productos = data || [];
  renderProductos();
}

function renderProductos() {
  const cont = document.getElementById("productos");
  if (!cont) return;

  if (!productos.length) {
    cont.innerHTML = `<div class="hero-card">No hay productos disponibles.</div>`;
    return;
  }

  let filtrados = categoriaActual === "all"
    ? productos
    : productos.filter(p => p.categoria === categoriaActual);

  if (categoriaActual === "Marisquería" && subcategoriaActual !== "") {
    filtrados = filtrados.filter(p => p.subcategoria === subcategoriaActual);
  }

  if (!filtrados.length) {
    cont.innerHTML = `<div class="hero-card">No hay productos en esta categoría/subcategoría.</div>`;
    return;
  }

  cont.innerHTML = filtrados.map(p => {
    const img = p.imagen_url && p.imagen_url.trim()
      ? p.imagen_url
      : "https://via.placeholder.com/300x200?text=Sin+imagen";

    const tipoVenta = p.tipo_venta === 'granel' ? 'kg' : 'pieza';
    const descripcion = p.descripcion || (p.tipo_venta === 'granel' ? 'Venta por kg' : 'Venta por pieza');
    const esGranel = p.tipo_venta === 'granel';
    const precioPorKg = Number(p.precio);

    let cantidadInputHtml = '';
    if (esGranel) {
      cantidadInputHtml = `
        <div class="quantity-selector">
          <div class="dual-input-row">
            <div class="input-group">
              <input type="number" id="kg-${p.id}" class="qty-input" value="0.1" step="0.01" min="0.01" placeholder="kg">
              <span class="unit">kg</span>
            </div>
            <span class="convert-icon">⇄</span>
            <div class="input-group">
              <input type="number" id="price-${p.id}" class="qty-input" value="${(0.1 * precioPorKg).toFixed(2)}" step="0.01" min="0" placeholder="$">
              <span class="unit">$</span>
            </div>
          </div>
        </div>
      `;
    } else {
      cantidadInputHtml = '';
    }

    return `
      <article class="product-card">
        <img class="product-image" src="${img}" alt="${p.nombre}">
        <div class="product-body">
          <div class="product-category">${p.categoria}${p.subcategoria ? ` · ${p.subcategoria}` : ''}</div>
          <div class="product-name">${p.nombre}</div>
          <div class="product-desc">${descripcion}</div>
          <div class="product-footer">
            <div class="price">$${Number(p.precio).toFixed(2)} <span class="unit">/ ${tipoVenta}</span></div>
            ${cantidadInputHtml}
            <button class="small-btn" onclick="addToCart(${p.id})">Agregar</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  filtrados.forEach(p => {
    if (p.tipo_venta === 'granel') {
      const kgInput = document.getElementById(`kg-${p.id}`);
      const priceInput = document.getElementById(`price-${p.id}`);
      const precioPorKg = Number(p.precio);

      if (kgInput && priceInput) {
        kgInput.addEventListener('input', (e) => {
          let kg = parseFloat(e.target.value);
          if (isNaN(kg) || kg < 0.01) kg = 0.01;
          const price = kg * precioPorKg;
          priceInput.value = price.toFixed(2);
        });

        priceInput.addEventListener('input', (e) => {
          let price = parseFloat(e.target.value);
          if (isNaN(price) || price < 0) price = 0;
          let kg = price / precioPorKg;
          if (kg < 0.01) kg = 0.01;
          kgInput.value = kg.toFixed(3);
        });
      }
    }
  });
}

function switchCategory(categoria) {
  categoriaActual = categoria;
  subcategoriaActual = "";
  updateSubcategoryMessage();

  const btnAll = document.getElementById("btnAll");
  const btnPescaderia = document.getElementById("btnPescaderia");
  const btnMarisqueria = document.getElementById("btnMarisqueria");
  const subBar = document.getElementById("subcategoriaBar");

  if (btnAll) btnAll.classList.remove("active");
  if (btnPescaderia) btnPescaderia.classList.remove("active");
  if (btnMarisqueria) btnMarisqueria.classList.remove("active");

  if (categoria === "all" && btnAll) btnAll.classList.add("active");
  if (categoria === "Pescadería" && btnPescaderia) btnPescaderia.classList.add("active");
  if (categoria === "Marisquería" && btnMarisqueria) btnMarisqueria.classList.add("active");

  if (categoria === "Marisquería") {
    subBar.style.display = "flex";
    document.querySelectorAll('.subcat-btn').forEach(btn => btn.classList.remove('active'));
    const firstSubBtn = document.querySelector('.subcat-btn:first-child');
    if (firstSubBtn) firstSubBtn.classList.add('active');
  } else {
    subBar.style.display = "none";
  }

  renderProductos();
}

function switchSubcategoria(subcat) {
  subcategoriaActual = subcat;
  document.querySelectorAll('.subcat-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (subcat === "") {
    const firstBtn = document.querySelector('.subcat-btn:first-child');
    if (firstBtn) firstBtn.classList.add('active');
  } else {
    const btns = document.querySelectorAll('.subcat-btn');
    for (let btn of btns) {
      if (btn.textContent.trim() === subcat) {
        btn.classList.add('active');
        break;
      }
    }
  }
  updateSubcategoryMessage();
  renderProductos();
}

function updateSubcategoryMessage() {
  const messageDiv = document.getElementById("subcategoryMessage");
  const messageContent = messageDiv?.querySelector(".message-content");
  if (!messageDiv || !messageContent) return;

  const specialSubcats = ["Mojarras", "Camarones", "Filetes"];
  const subcat = subcategoriaActual;

  if (specialSubcats.includes(subcat)) {
    let texto = "";
    if (subcat === "Mojarras") texto = "Las Mojarras Incluyen: Ensalada de Frutos Rojos y Papas a la Francesa";
    else if (subcat === "Camarones") texto = "Los Camarones Incluyen: Ensalada de Frutos Rojos y Papas a la Francesa";
    else if (subcat === "Filetes") texto = "Los Filetes Incluyen: Ensalada de Frutos Rojos y Papas a la Francesa";

    messageContent.textContent = texto;
    messageDiv.style.display = "block";
  } else {
    messageDiv.style.display = "none";
  }
}

// ======================
// UBICACIÓN Y FORMULARIO
// ======================

function obtenerUbicacion() {
  const modalBtn = document.getElementById('modalUbicacionBtn');
  if (modalBtn) {
    modalBtn.classList.add("clicked");
    setTimeout(() => modalBtn.classList.remove("clicked"), 200);
  }

  if (!navigator.geolocation) {
    showToast("Tu navegador no permite obtener ubicación.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      ubicacionActual = `https://www.google.com/maps?q=${lat},${lng}`;
      const ubicacionEl = document.getElementById("ubicacion");
      if (ubicacionEl) ubicacionEl.textContent = "Ubicación capturada correctamente.";
      if (modalUbicacionText) modalUbicacionText.textContent = "Ubicación capturada correctamente.";
    },
    (err) => {
      handleError(err, "No se pudo obtener la ubicación. Revisa permisos.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// Funciones del mapa (nuevas)
function abrirMapModal() {
  const modal = document.getElementById('mapModal');
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';

  if (!mapInstance) {
    // Centro por defecto: Ixtapaluca (ajústalo si quieres)
    mapInstance = L.map('map').setView([19.319, -98.882], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB'
    }).addTo(mapInstance);

    mapInstance.on('click', function(e) {
      if (marker) marker.remove();
      marker = L.marker(e.latlng).addTo(mapInstance);
      ubicacionSeleccionadaLatLng = e.latlng;
    });
  } else {
    mapInstance.invalidateSize();
  }
}

function cerrarMapModal() {
  document.getElementById('mapModal').style.display = 'none';
  document.body.style.overflow = 'auto';
}

async function buscarDireccion() {
  const query = document.getElementById('searchAddress').value.trim();
  if (!query) {
    showToast('Escribe una dirección para buscar');
    return;
  }
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length > 0) {
      const { lat, lon } = data[0];
      const latlng = L.latLng(parseFloat(lat), parseFloat(lon));
      mapInstance.setView(latlng, 15);
      if (marker) marker.remove();
      marker = L.marker(latlng).addTo(mapInstance);
      ubicacionSeleccionadaLatLng = latlng;
    } else {
      showToast('No se encontró esa dirección. Intenta con otro término.');
    }
  } catch (err) {
    handleError(err, 'Error al buscar la dirección');
  }
}

function confirmarUbicacionMapa() {
  if (!ubicacionSeleccionadaLatLng) {
    showToast('Selecciona un punto en el mapa primero');
    return;
  }
  const lat = ubicacionSeleccionadaLatLng.lat;
  const lng = ubicacionSeleccionadaLatLng.lng;
  ubicacionActual = `https://www.google.com/maps?q=${lat},${lng}`;
  const ubicacionEl = document.getElementById('ubicacion');
  if (ubicacionEl) ubicacionEl.textContent = 'Ubicación seleccionada manualmente ✅';
  cerrarMapModal();
}

// Validación y envío desde el modal
function clearModalErrors() {
  const fields = ["modalNombreCliente", "modalTelefonoCliente", "modalDireccionCliente", "modalMetodoPago"];
  fields.forEach(id => {
    const input = document.getElementById(id);
    const error = document.getElementById(`error-${id}`);
    if (input) {
      input.classList.remove("input-error", "input-success");
    }
    if (error) error.textContent = "";
  });
}

function setModalError(id, message) {
  const input = document.getElementById(id);
  const error = document.getElementById(`error-${id}`);
  if (input) input.classList.add("input-error");
  if (error) error.textContent = message;
}

function setModalSuccess(id) {
  const input = document.getElementById(id);
  if (input) input.classList.add("input-success");
}

function validateModalForm() {
  clearModalErrors();

  let valid = true;

  const nombre = modalNombreCliente ? modalNombreCliente.value.trim() : "";
  const telefono = modalTelefonoCliente ? modalTelefonoCliente.value.trim() : "";
  const direccion = modalDireccionCliente ? modalDireccionCliente.value.trim() : "";
  const metodoPago = modalMetodoPago ? modalMetodoPago.value : "";

  const phoneRegex = /^[0-9]{10,15}$/;

  if (nombre.length < 3) {
    setModalError("modalNombreCliente", "Escribe un nombre válido de al menos 3 letras.");
    valid = false;
  } else {
    setModalSuccess("modalNombreCliente");
  }

  if (!phoneRegex.test(telefono)) {
    setModalError("modalTelefonoCliente", "Escribe un número válido de 10 a 15 dígitos, sin espacios ni letras.");
    valid = false;
  } else {
    setModalSuccess("modalTelefonoCliente");
  }

  if (direccion.length < 8) {
    setModalError("modalDireccionCliente", "La dirección debe ser más completa.");
    valid = false;
  } else {
    setModalSuccess("modalDireccionCliente");
  }

  if (!metodoPago) {
    setModalError("modalMetodoPago", "Selecciona un método de pago.");
    valid = false;
  } else {
    setModalSuccess("modalMetodoPago");
  }

  if (!ubicacionActual) {
    showToast("Primero debes capturar tu ubicación.");
    valid = false;
  }

  if (!carrito.length) {
    showToast("Tu carrito está vacío.");
    valid = false;
  }

  return valid;
}

async function enviarPedidoDesdeModal() {
  if (!validateModalForm()) return;

  const nombre = modalNombreCliente ? modalNombreCliente.value.trim() : "";
  const telefono = modalTelefonoCliente ? modalTelefonoCliente.value.trim() : "";
  const direccion = modalDireccionCliente ? modalDireccionCliente.value.trim() : "";
  const metodoPago = modalMetodoPago ? modalMetodoPago.value : "";
  const notas = modalNotasPedido ? modalNotasPedido.value.trim() : "";

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
    handleError(error, "No se pudo guardar el pedido. Intenta de nuevo.");
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
    const unidad = item.tipo_venta === 'granel' ? 'kg' : 'pz';
    const qtyDisplay = item.tipo_venta === 'granel' ? Number(item.qty).toFixed(2) : item.qty;
    mensaje += `• ${item.nombre} ${qtyDisplay} ${unidad} - $${(Number(item.precio) * Number(item.qty)).toFixed(2)}\n`;
  });

  mensaje += `\n🧾 *Subtotal:* $${Number(pedido.subtotal).toFixed(2)}\n`;
  mensaje += `🚚 *Envío:* GRATIS\n`;
  mensaje += `💰 *Total redondeado:* $${Number(pedido.total).toFixed(2)}\n`;

  if (notas) mensaje += `📝 *Notas:* ${notas}\n`;
  if (ubicacionActual) mensaje += `\n📍 *Ubicación:* ${ubicacionActual}`;

  const numeroWhatsApp = "5569080488";
  const url = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`;

  window.open(url, "_blank");

  carrito = [];
  renderCarrito();

  if (modalNombreCliente) modalNombreCliente.value = "";
  if (modalTelefonoCliente) modalTelefonoCliente.value = "";
  if (modalDireccionCliente) modalDireccionCliente.value = "";
  if (modalMetodoPago) modalMetodoPago.value = "";
  if (modalNotasPedido) modalNotasPedido.value = "";
  if (modalUbicacionText) modalUbicacionText.textContent = "Sin ubicación capturada.";

  ubicacionActual = "";
  clearModalErrors();

  showToast("Pedido enviado con éxito", "success");
  closeCartModal();
}

// ======================
// CARRITO FLOTANTE Y MODAL
// ======================

function openCartModal() {
  const modal = document.getElementById('cartModal');
  if (!modal) return;
  renderCartModal(); // actualizar contenido antes de mostrar
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeCartModal() {
  const modal = document.getElementById('cartModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.style.overflow = 'auto';
}

// Eventos
const cartFloatingBtn = document.getElementById('cartFloatingBtn');
const closeModalBtn = document.querySelector('.close-modal');
if (cartFloatingBtn) cartFloatingBtn.addEventListener('click', openCartModal);
if (closeModalBtn) closeModalBtn.addEventListener('click', closeCartModal);
window.addEventListener('click', (e) => {
  const modal = document.getElementById('cartModal');
  if (e.target === modal) closeCartModal();
});

// ======================
// CARRUSEL
// ======================
let currentSlide = 0;
const slides = document.querySelectorAll('.carousel-slide');
const dotsContainer = document.querySelector('.carousel-dots');
let interval;
let isHovering = false;

function createDots() {
  slides.forEach((_, idx) => {
    const dot = document.createElement('span');
    dot.classList.add('dot');
    if (idx === 0) dot.classList.add('active');
    dot.addEventListener('click', () => goToSlide(idx));
    dotsContainer.appendChild(dot);
  });
}
function updateDots() {
  document.querySelectorAll('.dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentSlide);
  });
}

function showSlide(index) {
  slides.forEach((slide, i) => {
    slide.classList.toggle('active', i === index);
  });
  updateDots();
}

function nextSlide() {
  currentSlide = (currentSlide + 1) % slides.length;
  showSlide(currentSlide);
  resetInterval();
}

function prevSlide() {
  currentSlide = (currentSlide - 1 + slides.length) % slides.length;
  showSlide(currentSlide);
  resetInterval();
}

function goToSlide(index) {
  currentSlide = index;
  showSlide(currentSlide);
  resetInterval();
}

function startAutoSlide() {
  interval = setInterval(() => {
    if (!isHovering) nextSlide();
  }, 5000);
}

function resetInterval() {
  clearInterval(interval);
  startAutoSlide();
}

function pauseOnHover() {
  const carousel = document.querySelector('.promo-carousel');
  carousel.addEventListener('mouseenter', () => isHovering = true);
  carousel.addEventListener('mouseleave', () => isHovering = false);
}

if (slides.length) {
  createDots();
  showSlide(0);
  startAutoSlide();
  pauseOnHover();
}

document.querySelector('.carousel-control.prev')?.addEventListener('click', prevSlide);
document.querySelector('.carousel-control.next')?.addEventListener('click', nextSlide);

// ======================
// INICIALIZACIÓN
// ======================
function initModalReferences() {
  modalNombreCliente = document.getElementById('modalNombreCliente');
  modalTelefonoCliente = document.getElementById('modalTelefonoCliente');
  modalDireccionCliente = document.getElementById('modalDireccionCliente');
  modalMetodoPago = document.getElementById('modalMetodoPago');
  modalNotasPedido = document.getElementById('modalNotasPedido');
  modalUbicacionText = document.getElementById('modalUbicacionText');
}

initModalReferences();
cargarProductos();
renderCarrito();