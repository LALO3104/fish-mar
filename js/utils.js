// js/utils.js

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