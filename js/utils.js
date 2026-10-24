// js/utils.js

// ======================
// SEGURIDAD AL MOSTRAR DATOS
// ======================

// Escapa texto antes de meterlo en innerHTML (evita que un nombre o una
// nota con <script> o <img onerror=...> se ejecute en el panel).
function escapeHtml(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Solo permite enlaces http(s); cualquier otra cosa (javascript:, data:...) se vuelve "#"
function safeUrl(url) {
  if (!url) return "#";
  try {
    const u = new URL(String(url), window.location.href);
    if (u.protocol === "http:" || u.protocol === "https:") return escapeHtml(u.href);
  } catch (e) { /* URL inválida */ }
  return "#";
}

// ======================
// FECHAS (siempre en hora de Ciudad de México)
// ======================

const ZONA_MX = "America/Mexico_City";
// México no tiene horario de verano desde 2022: el desfase es fijo
const OFFSET_MX = "-06:00";

// "YYYY-MM-DD" de una fecha vista en hora de México
function fechaMX(fecha = new Date()) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: ZONA_MX });
}

// Suma días a un "YYYY-MM-DD" y devuelve otro "YYYY-MM-DD"
function sumarDias(fechaStr, dias) {
  const d = new Date(`${fechaStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Día de la semana (0 = domingo) de un "YYYY-MM-DD"
function diaSemana(fechaStr) {
  return new Date(`${fechaStr}T12:00:00Z`).getUTCDay();
}

// Límites para consultar un día completo en Supabase: usar .gte(desde) y .lt(hasta)
function rangoDiaMX(fechaStr) {
  return {
    desde: `${fechaStr}T00:00:00${OFFSET_MX}`,
    hasta: `${sumarDias(fechaStr, 1)}T00:00:00${OFFSET_MX}`
  };
}

function getHoy() {
  return fechaMX(new Date());
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
    const f = fechaMX(p.created_at);
    if (f) return f;
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

function roundUpToHalf(num) {
  return Math.ceil(num * 2) / 2;
}
function showToast(message, type = 'error') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function handleError(error, defaultMessage = 'Ocurrió un error. Intenta de nuevo.') {
  const errorMessage = error?.message || defaultMessage;
  showToast(errorMessage);
  // Guardar error internamente para depuración (no se muestra al usuario)
  if (!window.debugLog) window.debugLog = [];
  window.debugLog.push({ time: new Date(), error });
}
// ======================
// ESTADOS DE PEDIDO A DOMICILIO
// (el valor se guarda tal cual en la base; la etiqueta es lo que se muestra)
// ======================
const ESTADOS_PEDIDO = [
  { valor: "Recibido", etiqueta: "Recibido", clase: "recibido", icono: "fa-inbox" },
  { valor: "En proceso", etiqueta: "Preparando", clase: "enproceso", icono: "fa-fire-burner" },
  { valor: "El repartidor está en camino", etiqueta: "En camino", clase: "encamino", icono: "fa-motorcycle" },
  { valor: "Entregado", etiqueta: "Entregado", clase: "entregado", icono: "fa-circle-check" }
];

function estadoInfo(estado) {
  return ESTADOS_PEDIDO.find(e => e.valor === estado) || { valor: estado, etiqueta: estado || "Sin estado", clase: "", icono: "fa-circle" };
}

// Hora corta en México, ej. "8:57 p.m."
function horaMX(fecha) {
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-MX", { timeZone: ZONA_MX, hour: "numeric", minute: "2-digit", hour12: true });
}

// Fecha y hora cortas en México, ej. "23 oct, 8:57 p.m."
function fechaHoraCortaMX(fecha) {
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("es-MX", { timeZone: ZONA_MX, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function formatoDinero(n) {
  return "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ======================
// REGLAS DEL NEGOCIO
// (si cambian, actualizar también la función crear_pedido_domicilio en Supabase)
// ======================
const NEGOCIO = {
  tienda: { lat: 19.2992749, lng: -98.9061094 },   // Fish-Mar en Google Maps
  radioKm: 5,            // distancia máxima de entrega
  pedidoMinimo: 140,     // en productos, sin envío
  horaApertura: 10,      // 10:00 a.m.
  horaCierre: 19         // 7:00 p.m.
};

// Distancia en km entre dos puntos (fórmula de Haversine)
function distanciaKm(lat1, lng1, lat2, lng2) {
  const rad = (g) => g * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function distanciaATiendaKm(lat, lng) {
  return distanciaKm(NEGOCIO.tienda.lat, NEGOCIO.tienda.lng, lat, lng);
}

// Hora (0-23) de una fecha vista en México
function horaDelDiaMX(fecha = new Date()) {
  return Number(new Date(fecha).toLocaleString("en-US", { timeZone: ZONA_MX, hour: "numeric", hour12: false })) % 24;
}

function estaAbierto(fecha = new Date()) {
  const h = horaDelDiaMX(fecha);
  return h >= NEGOCIO.horaApertura && h < NEGOCIO.horaCierre;
}

// ¿El pedido llegó con el local cerrado?
function llegoFueraDeHorario(p) {
  return p && p.tipo_pedido !== "local" && p.created_at ? !estaAbierto(p.created_at) : false;
}
