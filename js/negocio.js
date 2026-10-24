// js/negocio.js — costos, recetas, gastos y ganancias (solo dueños)
// Dependencias: supabaseClient, utils.js y dashboard.js ($, abrirHoja, cerrarHoja,
// productosCache, cargarListaUsuarios, esSuperAdmin)

let insumosCache = [];
let recetaItemsCache = [];
let gastosCache = [];
let negocioCargado = false;
let seccionNegocio = "ganancias";
let periodoGanancias = "mes";
let tipoRecetas = "platillos";
let insumoEditandoId = null;
let recetaEditando = null;      // { tipo: "producto"|"preparacion", id, nombre, precio, tipo_venta, lineas: [] }
let categoriaGasto = "Renta";

const CATEGORIAS_GASTO = [
  ["Renta", "fa-house"], ["Sueldos", "fa-people-group"], ["Gas", "fa-fire-flame-simple"],
  ["Luz", "fa-bolt"], ["Agua", "fa-droplet"], ["Gasolina", "fa-gas-pump"],
  ["Mantenimiento", "fa-screwdriver-wrench"], ["Otros", "fa-ellipsis"]
];

const UNIDADES = {
  kg: { nombre: "kilo", opciones: [["g", 0.001], ["kg", 1]] },
  l: { nombre: "litro", opciones: [["ml", 0.001], ["l", 1]] },
  pieza: { nombre: "pieza", opciones: [["pza", 1]] },
  porcion: { nombre: "porción", opciones: [["porción", 1]] }
};

const redondear = (n, d = 2) => Math.round(Number(n) * 10 ** d) / 10 ** d;

// Cantidad legible: 0.08 kg → "80 g", 0.5 pieza → "0.5 pza"
function cantidadLegible(cantidad, unidad) {
  const q = Number(cantidad);
  if (unidad === "kg") return q < 1 ? `${redondear(q * 1000, 1)} g` : `${redondear(q, 3)} kg`;
  if (unidad === "l") return q < 1 ? `${redondear(q * 1000, 1)} ml` : `${redondear(q, 3)} l`;
  if (unidad === "porcion") return `${redondear(q, 2)} ${q === 1 ? "porción" : "porciones"}`;
  return `${redondear(q, 2)} pza`;
}

function badgeMargen(margen) {
  if (margen === null) return `<span class="badge no-dot">Sin receta</span>`;
  const clase = margen >= 50 ? "entregado" : margen >= 30 ? "enproceso" : "danger";
  return `<span class="badge ${clase} no-dot">Ganas ${Math.round(margen)}%</span>`;
}

// ======================
// COSTOS (cálculo en pantalla, igual que en la base de datos)
// ======================
function insumoPorId(id) {
  return insumosCache.find(i => i.id === Number(id));
}

function costoInsumo(id) {
  const ins = insumoPorId(id);
  if (!ins) return 0;
  if (!ins.es_preparacion) return Number(ins.costo);
  return recetaItemsCache
    .filter(r => r.preparacion_id === ins.id)
    .reduce((s, r) => s + Number(r.cantidad) * Number(insumoPorId(r.insumo_id)?.costo || 0), 0);
}

function costoLineas(lineas, paraLlevar) {
  return lineas
    .filter(l => paraLlevar || !l.solo_para_llevar)
    .reduce((s, l) => s + Number(l.cantidad) * costoInsumo(l.insumo_id), 0);
}

function lineasDeProducto(productoId) {
  return recetaItemsCache.filter(r => r.producto_id === productoId);
}

// ======================
// CARGA Y NAVEGACIÓN
// ======================
async function abrirNegocio() {
  if (!esSuperAdmin) return;
  if (!negocioCargado) {
    const ok = await cargarDatosNegocio();
    if (!ok) return;
    negocioCargado = true;
  }
  mostrarSeccionNegocio(seccionNegocio);
}

async function cargarDatosNegocio() {
  const [ins, rec] = await Promise.all([
    supabaseClient.from("insumos").select("*").order("nombre"),
    supabaseClient.from("receta_items").select("*")
  ]);
  if (ins.error || rec.error) {
    handleError(ins.error || rec.error, "No se pudieron cargar los costos. ¿Ya corriste el SQL de costos en Supabase?");
    return false;
  }
  insumosCache = ins.data || [];
  recetaItemsCache = rec.data || [];
  return true;
}

function mostrarSeccionNegocio(sec) {
  seccionNegocio = sec;
  document.querySelectorAll("#negocioChips .chip").forEach(c => c.classList.toggle("is-active", c.dataset.sec === sec));
  document.querySelectorAll(".neg-sec").forEach(el => { el.hidden = el.id !== `sec-${sec}`; });
  if (sec === "ganancias") cargarGanancias();
  if (sec === "insumos") renderInsumos();
  if (sec === "recetas") renderRecetas();
  if (sec === "gastos") cargarGastos();
  if (sec === "usuarios") cargarListaUsuarios();
}

// ======================
// GANANCIAS
// ======================
function rangoGanancias() {
  const hoy = getHoy();
  switch (periodoGanancias) {
    case "hoy": return [hoy, hoy];
    case "semana": return [sumarDias(hoy, -diaSemana(hoy)), hoy];
    case "mes": return [hoy.slice(0, 8) + "01", hoy];
    case "mesPasado": {
      const finMesPasado = sumarDias(hoy.slice(0, 8) + "01", -1);
      return [finMesPasado.slice(0, 8) + "01", finMesPasado];
    }
    default: {
      let a = $("ganDesde").value, b = $("ganHasta").value;
      if (!a || !b) return null;
      return a <= b ? [a, b] : [b, a];
    }
  }
}

function fechaCorta(f) {
  const [y, m, d] = f.split("-");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(d)} ${meses[Number(m) - 1]} ${y}`;
}

async function cargarGanancias() {
  const rango = rangoGanancias();
  const cont = $("gananciasContenido");
  if (!rango) {
    cont.innerHTML = `<div class="empty-cart">Elige las dos fechas y toca "Ver ganancias".</div>`;
    return;
  }
  cont.innerHTML = `<div class="empty-cart"><i class="fa-solid fa-spinner fa-spin"></i> Calculando…</div>`;

  const { data: r, error } = await supabaseClient.rpc("reporte_ganancias", { p_desde: rango[0], p_hasta: rango[1] });
  if (error) {
    cont.innerHTML = "";
    handleError(error, "No se pudo calcular. ¿Ya corriste el SQL de costos en Supabase?");
    return;
  }

  const ventas = Number(r.ventas), insumos = Number(r.costo_insumos), comisiones = Number(r.comisiones);
  const gastos = Number(r.gastos);
  const bruta = ventas - insumos - comisiones;
  const neta = bruta - gastos;
  const margenBruto = ventas > 0 ? (bruta / ventas) * 100 : 0;
  const sinReceta = (r.productos || []).filter(p => p.sin_receta);
  const periodoTxt = rango[0] === rango[1] ? fechaCorta(rango[0]) : `${fechaCorta(rango[0])} – ${fechaCorta(rango[1])}`;

  const fila = (texto, monto, clase = "", signo = "") => `
    <div class="row-between money-row ${clase}">
      <span>${texto}</span><strong>${signo}${formatoDinero(Math.abs(monto))}</strong>
    </div>`;

  const aviso = (sinReceta.length || r.pedidos_sin_costo) ? `
    <div class="note">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div class="stack-sm">
        <span>${sinReceta.length ? `<strong>${sinReceta.length} ${sinReceta.length === 1 ? "producto vendido no tiene" : "productos vendidos no tienen"} receta</strong>, así que su costo cuenta como $0 y la ganancia sale más alta de lo real. ` : ""}${r.pedidos_sin_costo ? `${r.pedidos_sin_costo} ventas no tienen costo calculado.` : ""}</span>
        <span class="small">Si ya capturaste las recetas, puedes recalcular este período con los costos actuales.</span>
        <button class="btn btn-sm btn-outline" onclick="recalcularPeriodo()"><i class="fa-solid fa-rotate"></i> Recalcular este período</button>
      </div>
    </div>` : "";

  const productos = (r.productos || []).slice(0, 10);
  const productosHtml = productos.length ? productos.map((p, i) => {
    const margen = Number(p.venta) > 0 ? (Number(p.ganancia) / Number(p.venta)) * 100 : 0;
    return `
      <div class="list-item">
        <div class="rank">${i + 1}</div>
        <div class="grow">
          <div class="title">${escapeHtml(p.nombre)}</div>
          <div class="small muted">${redondear(p.cantidad, 2)} vendidos · venta ${formatoDinero(p.venta)}</div>
        </div>
        <div class="right">
          <div class="amount">${formatoDinero(p.ganancia)}</div>
          ${p.sin_receta ? `<span class="badge no-dot">Sin receta</span>` : badgeMargen(margen)}
        </div>
      </div>`;
  }).join("") : `<div class="empty-cart">No hay ventas en este período.</div>`;

  const canales = (r.por_canal || []).map(c => fila(
    `<i class="fa-solid ${c.canal === "domicilio" ? "fa-motorcycle" : "fa-utensils"}"></i> ${c.canal === "domicilio" ? "Domicilio" : "Restaurante"} <span class="small muted">(${c.pedidos})</span>`,
    Number(c.ventas))).join("");

  const gastosCat = (r.gastos_por_categoria || []).map(g => fila(escapeHtml(g.categoria), Number(g.monto))).join("")
    || `<div class="small muted">No registraste gastos en este período.</div>`;

  cont.innerHTML = `
    <div class="profit-card ${neta < 0 ? "loss" : ""}">
      <div class="money-label">Ganancia neta · ${periodoTxt}</div>
      <div class="money-amount">${neta < 0 ? "−" : ""}${formatoDinero(Math.abs(neta))}</div>
      <div class="small">${r.pedidos} ${r.pedidos === 1 ? "venta" : "ventas"} · margen bruto ${Math.round(margenBruto)}%</div>
    </div>
    ${aviso}
    <div class="card">
      <h3 class="strong">Cómo se calcula</h3>
      <div class="stack-sm mt-8">
        ${fila("Ventas", ventas)}
        ${fila("Costo de insumos", insumos, "minus", "− ")}
        ${comisiones > 0 ? fila("Comisiones de tarjeta", comisiones, "minus", "− ") : ""}
        ${fila("Ganancia bruta", bruta, "total")}
        ${fila("Gastos (renta, sueldos…)", gastos, "minus", "− ")}
        ${fila("Ganancia neta", neta, `total ${neta < 0 ? "neg" : ""}`, neta < 0 ? "− " : "")}
      </div>
    </div>
    <div>
      <h3 class="strong">Lo que más te deja</h3>
      <p class="small muted">Ganancia por platillo (precio menos insumos), antes de descuentos.</p>
      <div class="list mt-8">${productosHtml}</div>
    </div>
    <div class="card">
      <h3 class="strong">Ventas por tipo</h3>
      <div class="stack-sm mt-8">${canales || '<div class="small muted">Sin ventas.</div>'}</div>
    </div>
    <div class="card">
      <h3 class="strong">Gastos del período</h3>
      <div class="stack-sm mt-8">${gastosCat}</div>
    </div>`;
}

async function recalcularPeriodo() {
  const rango = rangoGanancias();
  if (!rango) return;
  if (!confirm("Se volverá a calcular el costo de las ventas de este período usando los costos y recetas de HOY. ¿Continuar?")) return;
  const { data, error } = await supabaseClient.rpc("recalcular_costos", { p_desde: rango[0], p_hasta: rango[1] });
  if (error) {
    handleError(error, "No se pudo recalcular.");
    return;
  }
  showToast(`Listo: ${data} ventas recalculadas`, "success");
  cargarGanancias();
}

// ======================
// INSUMOS
// ======================
function vecesUsado(insumoId) {
  return recetaItemsCache.filter(r => r.insumo_id === insumoId).length;
}

function renderInsumos() {
  const cont = $("listaInsumos");
  const busq = ($("buscarInsumo").value || "").toLowerCase().trim();
  const lista = insumosCache.filter(i => !i.es_preparacion && i.nombre.toLowerCase().includes(busq));

  if (!insumosCache.some(i => !i.es_preparacion)) {
    cont.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🥬</div>
        <div class="empty-title">Todavía no hay insumos</div>
        <p class="mt-8">Empieza con lo que más usas: pescados, camarón, jitomate, cebolla, limón, aceite…</p>
        <button class="btn btn-primary mt-16" onclick="abrirInsumo()"><i class="fa-solid fa-plus"></i> Agregar el primero</button>
      </div>`;
    return;
  }
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-cart">No hay insumos con ese nombre.</div>`;
    return;
  }

  const grupos = {};
  lista.forEach(i => { (grupos[i.categoria] = grupos[i.categoria] || []).push(i); });
  cont.innerHTML = Object.keys(grupos).sort().map(cat => `
    <div>
      <h4 class="group-title">${escapeHtml(cat)}</h4>
      <div class="list">
        ${grupos[cat].map(i => {
          const usos = vecesUsado(i.id);
          return `
            <div class="list-item clickable" onclick="abrirInsumo(${i.id})">
              <div class="grow">
                <div class="title">${escapeHtml(i.nombre)}</div>
                <div class="small muted">${usos ? `En ${usos} ${usos === 1 ? "receta" : "recetas"}` : "Sin usar todavía"}</div>
              </div>
              <div class="right">
                <div class="amount">${formatoDinero(i.costo)}</div>
                <div class="small muted">por ${UNIDADES[i.unidad]?.nombre || i.unidad}</div>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`).join("");
}

function unidadInsumoSeleccionada() {
  return document.querySelector('input[name="insUnidad"]:checked')?.value || "kg";
}

function actualizarTextoUnidad() {
  const nombre = UNIDADES[unidadInsumoSeleccionada()].nombre;
  $("insUnidadTexto").textContent = nombre;
  document.querySelectorAll(".ins-unidad-txt").forEach(el => { el.textContent = nombre; });
}

function abrirInsumo(id = null) {
  insumoEditandoId = id;
  const ins = id ? insumoPorId(id) : null;
  $("tituloInsumo").textContent = ins ? "Editar insumo" : "Nuevo insumo";
  $("insNombre").value = ins?.nombre || "";
  $("insCategoria").value = ins?.categoria || "Pescados y mariscos";
  $("insCosto").value = ins ? Number(ins.costo) : "";
  document.querySelector(`input[name="insUnidad"][value="${ins?.unidad || "kg"}"]`).checked = true;
  $("calcCantidad").value = "";
  $("calcTotal").value = "";
  $("insCalculadora").open = false;
  $("btnBorrarInsumo").hidden = !ins;
  actualizarTextoUnidad();
  abrirHoja("modalInsumo");
}

function cerrarInsumo() {
  cerrarHoja("modalInsumo");
  insumoEditandoId = null;
}

function calcularCostoInsumo() {
  const cantidad = parseFloat($("calcCantidad").value);
  const total = parseFloat($("calcTotal").value);
  if (!(cantidad > 0) || !(total >= 0)) {
    showToast("Escribe cuánto compraste y cuánto pagaste.");
    return;
  }
  $("insCosto").value = redondear(total / cantidad, 2);
  showToast(`Costo: ${formatoDinero(total / cantidad)} por ${UNIDADES[unidadInsumoSeleccionada()].nombre}`, "success");
}

async function guardarInsumo() {
  const nombre = $("insNombre").value.trim();
  const costo = parseFloat($("insCosto").value);
  if (nombre.length < 2) { showToast("Escribe el nombre del insumo."); return; }
  if (isNaN(costo) || costo < 0) { showToast("Escribe el costo, o usa la calculadora."); return; }

  const datos = {
    nombre,
    categoria: $("insCategoria").value,
    unidad: unidadInsumoSeleccionada(),
    costo
  };
  const btn = $("btnGuardarInsumo");
  btn.disabled = true;
  try {
    const { error } = insumoEditandoId
      ? await supabaseClient.from("insumos").update(datos).eq("id", insumoEditandoId)
      : await supabaseClient.from("insumos").insert([datos]);
    if (error) {
      handleError(error, error.code === "23505" ? "Ya existe un insumo con ese nombre." : "No se pudo guardar el insumo.");
      return;
    }
    showToast(insumoEditandoId ? "Insumo actualizado" : "Insumo agregado", "success");
    cerrarInsumo();
    await cargarDatosNegocio();
    renderInsumos();
  } finally {
    btn.disabled = false;
  }
}

async function borrarInsumo() {
  const ins = insumoPorId(insumoEditandoId);
  if (!ins) return;
  const usos = vecesUsado(ins.id);
  if (usos) {
    showToast(`No se puede borrar: "${ins.nombre}" está en ${usos} ${usos === 1 ? "receta" : "recetas"}. Quítalo de ahí primero.`);
    return;
  }
  if (!confirm(`¿Borrar "${ins.nombre}"?`)) return;
  const { error } = await supabaseClient.from("insumos").delete().eq("id", ins.id);
  if (error) {
    handleError(error, "No se pudo borrar el insumo.");
    return;
  }
  showToast("Insumo borrado", "success");
  cerrarInsumo();
  await cargarDatosNegocio();
  renderInsumos();
}

// ======================
// RECETAS
// ======================
function renderRecetas() {
  const cont = $("listaRecetas");
  const busq = ($("buscarReceta").value || "").toLowerCase().trim();
  const esPlatillos = tipoRecetas === "platillos";
  $("btnNuevaPreparacion").hidden = esPlatillos;
  $("recetasAyuda").innerHTML = esPlatillos
    ? "Toca un platillo para escribir lo que lleva. El costo y la ganancia se calculan solos."
    : "Recetas que se repiten en varios platillos, por ejemplo <strong>Guarnición: ensalada + papas</strong>. Se usan como un ingrediente más.";

  if (esPlatillos) {
    const lista = productosCache.filter(p => p.nombre.toLowerCase().includes(busq));
    const conReceta = productosCache.filter(p => lineasDeProducto(p.id).length).length;
    const resumen = `<div class="small muted">${conReceta} de ${productosCache.length} platillos con receta</div>`;
    cont.innerHTML = resumen + (lista.map(p => {
      const lineas = lineasDeProducto(p.id);
      const costo = costoLineas(lineas, false);
      const precio = Number(p.precio);
      const margen = lineas.length && precio > 0 ? ((precio - costo) / precio) * 100 : null;
      return `
        <div class="list-item clickable" onclick="abrirRecetaProducto(${p.id})">
          <div class="grow">
            <div class="title">${escapeHtml(p.nombre)}</div>
            <div class="small muted">Precio ${formatoDinero(precio)}${p.tipo_venta === "granel" ? " por kg" : ""}${lineas.length ? ` · costo ${formatoDinero(costo)}` : ""}</div>
          </div>
          ${badgeMargen(margen)}
        </div>`;
    }).join("") || `<div class="empty-cart">No hay productos con ese nombre.</div>`);
    return;
  }

  const preps = insumosCache.filter(i => i.es_preparacion && i.nombre.toLowerCase().includes(busq));
  if (!preps.length) {
    cont.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🥗</div>
        <div class="empty-title">No hay preparaciones</div>
        <p class="mt-8">Crea una para lo que se repite, como la guarnición de ensalada y papas.</p>
      </div>`;
    return;
  }
  cont.innerHTML = preps.map(i => {
    const usos = vecesUsado(i.id);
    const n = recetaItemsCache.filter(r => r.preparacion_id === i.id).length;
    return `
      <div class="list-item clickable" onclick="abrirRecetaPreparacion(${i.id})">
        <div class="grow">
          <div class="title">${escapeHtml(i.nombre)}</div>
          <div class="small muted">${n} ${n === 1 ? "ingrediente" : "ingredientes"} · en ${usos} ${usos === 1 ? "platillo" : "platillos"}</div>
        </div>
        <div class="right">
          <div class="amount">${formatoDinero(costoInsumo(i.id))}</div>
          <div class="small muted">por porción</div>
        </div>
      </div>`;
  }).join("");
}

function abrirRecetaProducto(productoId) {
  const p = productosCache.find(x => x.id === productoId);
  if (!p) return;
  recetaEditando = {
    tipo: "producto",
    id: p.id,
    nombre: p.nombre,
    precio: Number(p.precio),
    tipo_venta: p.tipo_venta,
    lineas: lineasDeProducto(p.id).map(r => ({ insumo_id: r.insumo_id, cantidad: Number(r.cantidad), solo_para_llevar: r.solo_para_llevar }))
  };
  $("tituloReceta").textContent = p.nombre;
  $("subtituloReceta").textContent = p.tipo_venta === "granel"
    ? "Escribe lo que lleva cada kilo que vendes"
    : "Escribe lo que lleva una pieza o porción";
  $("campoNombrePrep").hidden = true;
  $("btnBorrarPrep").hidden = true;
  $("recLlevarLinea").hidden = false;
  prepararFormularioLinea();
  renderLineasReceta();
  abrirHoja("modalReceta");
}

function abrirRecetaPreparacion(id) {
  const prep = insumoPorId(id);
  recetaEditando = {
    tipo: "preparacion",
    id: prep?.id || null,
    nombre: prep?.nombre || "",
    lineas: prep ? recetaItemsCache.filter(r => r.preparacion_id === prep.id)
      .map(r => ({ insumo_id: r.insumo_id, cantidad: Number(r.cantidad), solo_para_llevar: false })) : []
  };
  $("tituloReceta").textContent = prep ? "Preparación" : "Nueva preparación";
  $("subtituloReceta").textContent = "Se usa como ingrediente en varios platillos";
  $("campoNombrePrep").hidden = false;
  $("nombrePrep").value = recetaEditando.nombre;
  $("btnBorrarPrep").hidden = !prep;
  $("recLlevarLinea").hidden = true;
  prepararFormularioLinea();
  renderLineasReceta();
  abrirHoja("modalReceta");
}

function nuevaPreparacion() {
  abrirRecetaPreparacion(null);
}

function cerrarReceta() {
  cerrarHoja("modalReceta");
  recetaEditando = null;
}

function prepararFormularioLinea() {
  const esPrep = recetaEditando.tipo === "preparacion";
  const disponibles = insumosCache.filter(i => !(esPrep && i.es_preparacion) && i.id !== recetaEditando.id);
  const grupos = {};
  disponibles.forEach(i => {
    const g = i.es_preparacion ? "Preparaciones compartidas" : i.categoria;
    (grupos[g] = grupos[g] || []).push(i);
  });
  const orden = Object.keys(grupos).sort((a, b) => (a === "Preparaciones compartidas" ? -1 : b === "Preparaciones compartidas" ? 1 : a.localeCompare(b)));
  $("recInsumo").innerHTML = `<option value="">${disponibles.length ? "Elige un ingrediente" : "Primero agrega insumos"}</option>` +
    orden.map(g => `<optgroup label="${escapeHtml(g)}">${grupos[g].map(i =>
      `<option value="${i.id}">${escapeHtml(i.nombre)} — ${formatoDinero(costoInsumo(i.id))}/${UNIDADES[i.unidad]?.nombre || i.unidad}</option>`).join("")}</optgroup>`).join("");
  $("recCantidad").value = "";
  $("recLlevar").checked = false;
  actualizarUnidadesLinea();
}

function actualizarUnidadesLinea() {
  const ins = insumoPorId($("recInsumo").value);
  const unidad = ins?.unidad || "kg";
  const opciones = UNIDADES[unidad].opciones;
  $("recUnidad").innerHTML = opciones.map(([txt, factor]) => `<option value="${factor}">${txt}</option>`).join("");
  $("recCantidad").placeholder = unidad === "kg" ? "Ej. 150 (gramos)" : unidad === "l" ? "Ej. 20 (mililitros)" : "Ej. 1";
  // Los desechables casi siempre son "solo para llevar"
  if (recetaEditando?.tipo === "producto") $("recLlevar").checked = ins?.categoria === "Desechables";
}

function agregarLineaReceta() {
  const ins = insumoPorId($("recInsumo").value);
  const valor = parseFloat($("recCantidad").value);
  if (!ins) { showToast("Elige un ingrediente."); return; }
  if (!(valor > 0)) { showToast("Escribe la cantidad."); return; }
  const cantidad = redondear(valor * parseFloat($("recUnidad").value), 4);
  const llevar = recetaEditando.tipo === "producto" && $("recLlevar").checked;

  const existente = recetaEditando.lineas.find(l => l.insumo_id === ins.id && l.solo_para_llevar === llevar);
  if (existente) existente.cantidad = redondear(existente.cantidad + cantidad, 4);
  else recetaEditando.lineas.push({ insumo_id: ins.id, cantidad, solo_para_llevar: llevar });

  $("recInsumo").value = "";
  $("recCantidad").value = "";
  actualizarUnidadesLinea();
  renderLineasReceta();
}

function quitarLineaReceta(index) {
  recetaEditando.lineas.splice(index, 1);
  renderLineasReceta();
}

function cambiarCantidadLinea(index, valor) {
  const linea = recetaEditando.lineas[index];
  const ins = insumoPorId(linea?.insumo_id);
  const v = parseFloat(valor);
  if (!linea || !ins || !(v > 0)) { renderLineasReceta(); return; }
  // El campo se muestra en g/ml cuando la cantidad es menor a 1 kg/l
  const enMiles = (ins.unidad === "kg" || ins.unidad === "l") && linea.cantidad < 1;
  linea.cantidad = redondear(enMiles ? v / 1000 : v, 4);
  renderLineasReceta();
}

function renderLineasReceta() {
  const r = recetaEditando;
  const cont = $("lineasReceta");
  if (!r.lineas.length) {
    cont.innerHTML = `<div class="empty-cart">Todavía no tiene ingredientes. Agrégalos abajo.</div>`;
  } else {
    cont.innerHTML = r.lineas.map((l, i) => {
      const ins = insumoPorId(l.insumo_id);
      if (!ins) return "";
      const enMiles = (ins.unidad === "kg" || ins.unidad === "l") && l.cantidad < 1;
      const valor = enMiles ? redondear(l.cantidad * 1000, 1) : redondear(l.cantidad, 3);
      const unidadTxt = ins.unidad === "kg" ? (enMiles ? "g" : "kg") : ins.unidad === "l" ? (enMiles ? "ml" : "l") : ins.unidad === "porcion" ? "porción" : "pza";
      return `
        <div class="recipe-line">
          <div class="grow">
            <div class="title">${escapeHtml(ins.nombre)} ${ins.es_preparacion ? '<span class="badge no-dot">Preparación</span>' : ""}</div>
            <div class="small muted">${formatoDinero(Number(l.cantidad) * costoInsumo(ins.id))}${l.solo_para_llevar ? ' · <span class="tag-llevar">solo para llevar</span>' : ""}</div>
          </div>
          <div class="qty-edit">
            <input type="number" class="input" value="${valor}" step="any" min="0" inputmode="decimal"
                   onchange="cambiarCantidadLinea(${i}, this.value)" aria-label="Cantidad">
            <span>${unidadTxt}</span>
          </div>
          <button class="icon-btn" style="color:var(--danger)" onclick="quitarLineaReceta(${i})" aria-label="Quitar"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }).join("");
  }

  // Resumen de costo y ganancia
  const costoAqui = costoLineas(r.lineas, false);
  if (r.tipo === "producto") {
    const costoLlevar = costoLineas(r.lineas, true);
    const ganancia = r.precio - costoAqui;
    const margen = r.precio > 0 ? (ganancia / r.precio) * 100 : 0;
    $("resumenReceta").innerHTML = `
      <div class="row-between"><span class="muted">Precio de venta</span><strong>${formatoDinero(r.precio)}</strong></div>
      <div class="row-between"><span class="muted">Costo${costoLlevar !== costoAqui ? " (comer aquí)" : ""}</span><strong>${formatoDinero(costoAqui)}</strong></div>
      ${costoLlevar !== costoAqui ? `<div class="row-between"><span class="muted">Costo para llevar</span><strong>${formatoDinero(costoLlevar)}</strong></div>` : ""}
      <div class="row-between big-line"><span>Ganas</span><span>${formatoDinero(ganancia)} ${r.lineas.length ? badgeMargen(margen) : ""}</span></div>`;
  } else {
    $("resumenReceta").innerHTML = `
      <div class="row-between big-line"><span>Costo por porción</span><span>${formatoDinero(costoAqui)}</span></div>`;
  }
}

async function guardarReceta() {
  const r = recetaEditando;
  if (!r) return;
  const btn = $("btnGuardarReceta");
  btn.disabled = true;
  try {
    let prepId = r.tipo === "preparacion" ? r.id : null;

    if (r.tipo === "preparacion") {
      const nombre = $("nombrePrep").value.trim();
      if (nombre.length < 2) { showToast("Escribe el nombre de la preparación."); return; }
      if (!r.lineas.length) { showToast("Agrega al menos un ingrediente."); return; }
      if (prepId) {
        const { error } = await supabaseClient.from("insumos").update({ nombre }).eq("id", prepId);
        if (error) { handleError(error, error.code === "23505" ? "Ya existe algo con ese nombre." : "No se pudo guardar."); return; }
      } else {
        const { data, error } = await supabaseClient.from("insumos")
          .insert([{ nombre, unidad: "porcion", costo: 0, categoria: "Preparaciones", es_preparacion: true }])
          .select("id").single();
        if (error) { handleError(error, error.code === "23505" ? "Ya existe algo con ese nombre." : "No se pudo crear."); return; }
        prepId = data.id;
      }
    }

    const { error } = await supabaseClient.rpc("guardar_receta", {
      p_producto_id: r.tipo === "producto" ? r.id : null,
      p_preparacion_id: prepId,
      p_items: r.lineas.map(l => ({ insumo_id: l.insumo_id, cantidad: l.cantidad, solo_para_llevar: l.solo_para_llevar }))
    });
    if (error) {
      handleError(error, "No se pudo guardar la receta.");
      return;
    }
    showToast("Receta guardada", "success");
    cerrarReceta();
    await cargarDatosNegocio();
    renderRecetas();
  } finally {
    btn.disabled = false;
  }
}

async function borrarPreparacion() {
  const r = recetaEditando;
  if (!r?.id) return;
  const usos = vecesUsado(r.id);
  if (usos) {
    showToast(`No se puede borrar: se usa en ${usos} ${usos === 1 ? "platillo" : "platillos"}. Quítala de ahí primero.`);
    return;
  }
  if (!confirm(`¿Borrar la preparación "${r.nombre}"?`)) return;
  const { error } = await supabaseClient.from("insumos").delete().eq("id", r.id);
  if (error) {
    handleError(error, "No se pudo borrar.");
    return;
  }
  showToast("Preparación borrada", "success");
  cerrarReceta();
  await cargarDatosNegocio();
  renderRecetas();
}

// ======================
// GASTOS
// ======================
async function cargarGastos() {
  if (!$("gastosMes").value) $("gastosMes").value = getHoy().slice(0, 7);
  const [y, m] = $("gastosMes").value.split("-").map(Number);
  const desde = `${y}-${String(m).padStart(2, "0")}-01`;
  const hasta = sumarDias(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);

  const { data, error } = await supabaseClient.from("gastos").select("*")
    .gte("fecha", desde).lte("fecha", hasta).order("fecha", { ascending: false });
  if (error) {
    handleError(error, "No se pudieron cargar los gastos. ¿Ya corriste el SQL de costos en Supabase?");
    return;
  }
  gastosCache = data || [];
  $("gastosTotalMes").textContent = formatoDinero(gastosCache.reduce((s, g) => s + Number(g.monto), 0));

  const icono = (cat) => (CATEGORIAS_GASTO.find(c => c[0] === cat) || ["", "fa-ellipsis"])[1];
  $("listaGastos").innerHTML = gastosCache.length ? gastosCache.map(g => `
    <div class="list-item">
      <div class="step-icon"><i class="fa-solid ${icono(g.categoria)}"></i></div>
      <div class="grow">
        <div class="title">${escapeHtml(g.categoria)}</div>
        <div class="small muted">${fechaCorta(g.fecha)}${g.concepto ? " · " + escapeHtml(g.concepto) : ""}</div>
      </div>
      <div class="amount">${formatoDinero(g.monto)}</div>
      <button class="icon-btn" style="color:var(--danger)" onclick="borrarGasto(${g.id})" aria-label="Borrar gasto"><i class="fa-solid fa-trash-can"></i></button>
    </div>`).join("")
    : `<div class="empty"><div class="empty-icon">🧾</div><div class="empty-title">Sin gastos este mes</div>
       <p class="mt-8">Registra la renta, sueldos, gas, luz… para conocer tu ganancia real.</p></div>`;
}

function renderCategoriasGasto() {
  $("gastoCategorias").innerHTML = CATEGORIAS_GASTO.map(([cat, ic]) => `
    <button type="button" class="chip ${cat === categoriaGasto ? "is-active" : ""}" data-cat="${cat}">
      <i class="fa-solid ${ic}"></i> ${cat}
    </button>`).join("");
  $("gastoCategorias").querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => {
    categoriaGasto = c.dataset.cat;
    renderCategoriasGasto();
  }));
}

function abrirGasto() {
  categoriaGasto = "Renta";
  renderCategoriasGasto();
  $("gastoMonto").value = "";
  $("gastoConcepto").value = "";
  $("gastoFecha").value = getHoy();
  abrirHoja("modalGasto");
}

function cerrarGasto() {
  cerrarHoja("modalGasto");
}

async function guardarGasto() {
  const monto = parseFloat($("gastoMonto").value);
  if (!(monto > 0)) { showToast("Escribe el monto del gasto."); return; }
  const btn = $("btnGuardarGasto");
  btn.disabled = true;
  try {
    const { error } = await supabaseClient.from("gastos").insert([{
      categoria: categoriaGasto,
      concepto: $("gastoConcepto").value.trim() || null,
      monto,
      fecha: $("gastoFecha").value || getHoy()
    }]);
    if (error) {
      handleError(error, "No se pudo guardar el gasto.");
      return;
    }
    showToast("Gasto registrado", "success");
    cerrarGasto();
    $("gastosMes").value = ($("gastoFecha").value || getHoy()).slice(0, 7);
    cargarGastos();
  } finally {
    btn.disabled = false;
  }
}

async function borrarGasto(id) {
  const g = gastosCache.find(x => x.id === id);
  if (!confirm(`¿Borrar el gasto de ${g?.categoria || ""} por ${formatoDinero(g?.monto)}?`)) return;
  const { error } = await supabaseClient.from("gastos").delete().eq("id", id);
  if (error) {
    handleError(error, "No se pudo borrar el gasto.");
    return;
  }
  showToast("Gasto borrado", "success");
  cargarGastos();
}

// ======================
// EVENTOS
// ======================
document.querySelectorAll("#negocioChips .chip").forEach(c =>
  c.addEventListener("click", () => mostrarSeccionNegocio(c.dataset.sec)));

document.querySelectorAll("#gananciasPeriodo .chip").forEach(c => c.addEventListener("click", () => {
  periodoGanancias = c.dataset.periodo;
  document.querySelectorAll("#gananciasPeriodo .chip").forEach(x => x.classList.toggle("is-active", x === c));
  $("gananciasFechas").hidden = periodoGanancias !== "elegir";
  if (periodoGanancias === "elegir") {
    if (!$("ganDesde").value) $("ganDesde").value = getHoy().slice(0, 8) + "01";
    if (!$("ganHasta").value) $("ganHasta").value = getHoy();
    return;
  }
  cargarGanancias();
}));

document.querySelectorAll("#recetasTipo .chip").forEach(c => c.addEventListener("click", () => {
  tipoRecetas = c.dataset.tipo;
  document.querySelectorAll("#recetasTipo .chip").forEach(x => x.classList.toggle("is-active", x === c));
  $("buscarReceta").value = "";
  renderRecetas();
}));

$("buscarInsumo").addEventListener("input", renderInsumos);
$("buscarReceta").addEventListener("input", renderRecetas);
$("gastosMes").addEventListener("change", cargarGastos);
$("recInsumo").addEventListener("change", actualizarUnidadesLinea);
document.querySelectorAll('input[name="insUnidad"]').forEach(r => r.addEventListener("change", actualizarTextoUnidad));
