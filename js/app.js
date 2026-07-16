// ============================================================
//  Lógica principal del dashboard (vanilla JS).
//  Estado en memoria + render() que repinta según filtros.
// ============================================================

// --- Estado en memoria ---
let compromisos = []; // array maestro tal cual llega del API
let llaveModalActual = null; // llave del compromiso abierto en el modal

// --- Modo demostración (activar con ?demo=1 en la URL) ---
const MODO_DEMO = new URLSearchParams(location.search).get("demo") === "1";

// Etiquetas de los estados guardables.
const ESTADOS_GUARDABLES = ["Pendiente", "En proceso", "Cumplido"];

// --- Atajos al DOM ---
const $ = (id) => document.getElementById(id);

// ============================================================
//  Utilidades
// ============================================================

// "2026-02-27" -> "27/02/2026". Cadena vacía -> "—".
function formatearFecha(iso) {
  if (!iso) return "—";
  const partes = String(iso).slice(0, 10).split("-");
  if (partes.length !== 3) return iso;
  const [a, m, d] = partes;
  return `${d}/${m}/${a}`;
}

// Date a medianoche local a partir de un ISO aaaa-mm-dd.
function fechaDesdeISO(iso) {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d);
}

function hoyMedianoche() {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), h.getDate());
}

// Días de diferencia entre fechaVerif y hoy (positivo = en el futuro).
function diasHastaVerif(iso) {
  const f = fechaDesdeISO(iso);
  if (!f) return null;
  return Math.round((f - hoyMedianoche()) / 86400000);
}

// Guarda en el backend con reintentos (resiliencia ante conexión intermitente).
// En modo demo nada se persiste.
async function guardarBackend(payload, intentos = 3) {
  if (MODO_DEMO) return { ok: true, demo: true };
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      return await API.guardar(payload);
    } catch (err) {
      ultimoError = err;
      if (i < intentos - 1) await esperar(600 * (i + 1)); // backoff 0.6s, 1.2s
    }
  }
  throw ultimoError;
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function esEnProceso(c) {
  return (c.estadoInicial || "").trim().toLowerCase() === "en proceso";
}

function escaparHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

function toast(mensaje, tipo = "") {
  const t = $("toast");
  t.textContent = mensaje;
  t.className = "toast " + tipo;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 3000);
}

// ============================================================
//  Filtros
// ============================================================

function leerFiltros() {
  return {
    programa: $("filtroPrograma").value,
    padrino: $("filtroPadrino").value,
    municipio: $("filtroMunicipio").value,
    busqueda: $("filtroBusqueda").value.trim().toLowerCase(),
  };
}

// Guarda los filtros actuales en la URL (sin recargar) para poder marcarla como favorita.
function sincronizarFiltrosEnURL() {
  const f = leerFiltros();
  const params = new URLSearchParams(location.search);
  const set = (k, v) => (v ? params.set(k, v) : params.delete(k));
  set("programa", f.programa);
  set("padrino", f.padrino);
  set("municipio", f.municipio);
  set("q", f.busqueda);
  const nueva = params.toString();
  history.replaceState(null, "", nueva ? "?" + nueva : location.pathname);
}

// Lee los filtros desde la URL y los aplica a los controles (al cargar).
function aplicarFiltrosDesdeURL() {
  const params = new URLSearchParams(location.search);
  const poner = (id, val) => {
    if (val === null) return;
    const el = $(id);
    // Para selects, solo aplicar si la opción existe.
    if (el.tagName === "SELECT" && !Array.from(el.options).some((o) => o.value === val))
      return;
    el.value = val;
  };
  poner("filtroPrograma", params.get("programa"));
  poner("filtroPadrino", params.get("padrino"));
  poner("filtroMunicipio", params.get("municipio"));
  poner("filtroBusqueda", params.get("q"));
}

function aplicarFiltros(lista) {
  const f = leerFiltros();
  return lista.filter((c) => {
    if (f.programa && c.programa !== f.programa) return false;
    if (f.padrino && c.padrino !== f.padrino) return false;
    if (f.municipio && c.municipio !== f.municipio) return false;
    if (f.busqueda) {
      const blob = [c.compromiso, c.institucion, c.sede, c.responsable]
        .join(" ")
        .toLowerCase();
      if (!blob.includes(f.busqueda)) return false;
    }
    return true;
  });
}

// Rellena un <select> con una opción "Todos" + valores únicos ordenados.
function poblarFiltro(idSelect, etiquetaTodos, valores) {
  const sel = $(idSelect);
  const previo = sel.value;
  const unicos = [...new Set(valores.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
  sel.innerHTML =
    `<option value="">${etiquetaTodos}</option>` +
    unicos
      .map((v) => `<option value="${escaparHTML(v)}">${escaparHTML(v)}</option>`)
      .join("");
  if (unicos.includes(previo)) sel.value = previo;
}

function poblarTodosLosFiltros() {
  poblarFiltro("filtroPrograma", "Todos los proyectos", compromisos.map((c) => c.programa));
  poblarFiltro("filtroPadrino", "Todos los padrinos", compromisos.map((c) => c.padrino));
  poblarFiltro("filtroMunicipio", "Todos los municipios", compromisos.map((c) => c.municipio));
}

// ============================================================
//  Render
// ============================================================

// Cuántas tarjetas mostrar por columna antes del botón "ver más".
const LOTE_TARJETAS = 50;
const mostrarTodo = { pendiente: false, cumplido: false, vencido: false };

// Ordena por urgencia: fechaVerif más próxima primero (sin fecha al final).
function ordenarPorUrgencia(items) {
  return items.slice().sort((a, b) => {
    const fa = fechaDesdeISO(a.fechaVerif);
    const fb = fechaDesdeISO(b.fechaVerif);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return fa - fb;
  });
}

function render() {
  const visibles = aplicarFiltros(compromisos);
  sincronizarFiltrosEnURL();

  // --- KPIs ---
  const cont = { pendiente: 0, cumplido: 0, vencido: 0 };
  visibles.forEach((c) => {
    if (cont[c.estado] !== undefined) cont[c.estado]++;
  });
  $("kpiPendiente").textContent = cont.pendiente;
  $("kpiCumplido").textContent = cont.cumplido;
  $("kpiVencido").textContent = cont.vencido;
  $("contPendiente").textContent = cont.pendiente;
  $("contCumplido").textContent = cont.cumplido;
  $("contVencido").textContent = cont.vencido;

  // --- Barra de avance (% cumplido sobre el total filtrado) ---
  const total = visibles.length;
  const pct = total ? Math.round((cont.cumplido / total) * 100) : 0;
  $("avancePct").textContent = pct + "%";
  $("avanceRelleno").style.width = pct + "%";
  $("avanceDetalle").textContent = `${cont.cumplido} de ${total} compromisos cumplidos`;

  // --- Columnas (ordenadas por urgencia) ---
  renderColumna("colPendiente", ordenarPorUrgencia(visibles.filter((c) => c.estado === "pendiente")), "pendiente");
  renderColumna("colCumplido", ordenarPorUrgencia(visibles.filter((c) => c.estado === "cumplido")), "cumplido");
  renderColumna("colVencido", ordenarPorUrgencia(visibles.filter((c) => c.estado === "vencido")), "vencido");

  // --- Alertas (sobre el conjunto filtrado) ---
  renderAlertas(visibles);

  // --- Resumen (si está abierto) ---
  if (!$("resumen").hidden) renderResumen(visibles);
}

function renderColumna(idCol, items, col) {
  const cont = $(idCol);
  if (!items.length) {
    cont.innerHTML = `<div class="vacio">Sin compromisos</div>`;
    return;
  }
  const limite = mostrarTodo[col] ? items.length : LOTE_TARJETAS;
  const visibles = items.slice(0, limite);
  let html = visibles.map(tarjetaHTML).join("");
  if (items.length > limite) {
    html += `<button class="btn-vermas" data-col="${col}" type="button">Ver ${
      items.length - limite
    } más</button>`;
  }
  cont.innerHTML = html;
}

function tarjetaHTML(c) {
  const dias = diasHastaVerif(c.fechaVerif);
  const proximo =
    c.estado === "pendiente" && dias !== null && dias >= 0 && dias <= CONFIG.DIAS_ALERTA;
  const fechaAlerta = c.estado === "vencido" || proximo ? "alerta" : "";

  return `
    <article class="tarjeta" draggable="true"
             data-llave="${escaparHTML(c.llave)}" data-estado="${c.estado}">
      <div class="tarjeta-texto">${escaparHTML(c.compromiso)}</div>
      <div class="tarjeta-meta">
        <span>${escaparHTML(c.institucion)} · ${escaparHTML(c.sede)}</span>
        <span>${escaparHTML(c.padrino)}</span>
      </div>
      ${
        c.observaciones && c.observaciones.trim()
          ? `<div class="tarjeta-obs"><span class="tarjeta-obs-lbl">Obs.</span> ${escaparHTML(
              c.observaciones
            )}</div>`
          : ""
      }
      <div class="tarjeta-badges">
        ${esEnProceso(c) ? '<span class="badge badge-proceso">En proceso</span>' : ""}
        <span class="badge badge-fecha ${fechaAlerta}">Verif: ${formatearFecha(c.fechaVerif)}</span>
      </div>
    </article>`;
}

function renderAlertas(visibles) {
  const lista = visibles
    .map((c) => {
      const dias = diasHastaVerif(c.fechaVerif);
      if (c.estado === "vencido") return { c, tipo: "venc", orden: -9999 };
      if (
        c.estado === "pendiente" &&
        dias !== null &&
        dias >= 0 &&
        dias <= CONFIG.DIAS_ALERTA
      )
        return { c, tipo: "prox", orden: dias };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.orden - b.orden);

  const cont = $("alertas");
  if (!lista.length) {
    cont.hidden = true;
    return;
  }
  cont.hidden = false;
  $("alertasLista").innerHTML = lista
    .map(
      ({ c, tipo }) => `
      <li class="alerta-item" data-llave="${escaparHTML(c.llave)}">
        <span class="alerta-tag ${tipo}">${tipo === "venc" ? "Vencido" : "Próximo"}</span>
        <span>${escaparHTML(c.institucion)} · ${escaparHTML(c.sede)} — ${formatearFecha(
        c.fechaVerif
      )} — ${escaparHTML(c.padrino)}</span>
      </li>`
    )
    .join("");
}

// ============================================================
//  Resumen por padrino / programa / municipio
// ============================================================
let tabResumen = "padrino"; // campo de agrupación activo

function renderResumen(visibles) {
  const datos = visibles || aplicarFiltros(compromisos);
  const grupos = new Map();
  datos.forEach((c) => {
    const clave = c[tabResumen] || "(sin dato)";
    if (!grupos.has(clave))
      grupos.set(clave, { pendiente: 0, cumplido: 0, vencido: 0, total: 0 });
    const g = grupos.get(clave);
    if (g[c.estado] !== undefined) g[c.estado]++;
    g.total++;
  });

  const filas = [...grupos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([clave, g]) => {
      const pct = g.total ? Math.round((g.cumplido / g.total) * 100) : 0;
      return `
        <tr>
          <td>${escaparHTML(clave)}</td>
          <td class="num c-pendiente">${g.pendiente}</td>
          <td class="num c-cumplido">${g.cumplido}</td>
          <td class="num c-vencido">${g.vencido}</td>
          <td class="num">${g.total}</td>
          <td>
            <span class="resumen-mini-barra"><span class="resumen-mini-relleno" style="width:${pct}%"></span></span>
            ${pct}%
          </td>
        </tr>`;
    })
    .join("");

  const etiqueta = { padrino: "Padrino", programa: "Proyecto", municipio: "Municipio" }[
    tabResumen
  ];
  $("resumenTablaCont").innerHTML = `
    <table class="resumen-tabla">
      <thead>
        <tr>
          <th>${etiqueta}</th>
          <th class="num">Pend.</th>
          <th class="num">Cumpl.</th>
          <th class="num">Venc.</th>
          <th class="num">Total</th>
          <th>% cumplido</th>
        </tr>
      </thead>
      <tbody>${filas || `<tr><td colspan="6" class="vacio">Sin datos</td></tr>`}</tbody>
    </table>`;
}

// ============================================================
//  Exportar CSV (del conjunto filtrado actual)
// ============================================================
function exportarCSV() {
  const datos = aplicarFiltros(compromisos);
  const cols = [
    ["programa", "Proyecto"],
    ["padrino", "Padrino"],
    ["municipio", "Municipio"],
    ["institucion", "Institución"],
    ["sede", "Sede"],
    ["compromiso", "Compromiso"],
    ["responsable", "Responsable"],
    ["fechaVisita", "Fecha visita"],
    ["fechaVerif", "Fecha verificación"],
    ["estadoInicial", "Estado guardado"],
    ["estado", "Estado actual"],
    ["observaciones", "Observaciones"],
  ];
  const lineas = [cols.map(([, t]) => t).join(";")];
  datos.forEach((c) => {
    lineas.push(
      cols
        .map(([k]) => {
          const val = ["fechaVisita", "fechaVerif"].includes(k)
            ? formatearFecha(c[k])
            : c[k];
          const s = String(val ?? "");
          return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(";")
    );
  });
  // BOM para que Excel respete los acentos.
  const blob = new Blob(["﻿" + lineas.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `compromisos_${fecha}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exportados ${datos.length} compromisos`, "ok");
}

// ============================================================
//  Modal
// ============================================================

function abrirModal(llave) {
  const c = compromisos.find((x) => x.llave === llave);
  if (!c) return;
  llaveModalActual = llave;

  // Estado preseleccionado en el selector: el guardado (estadoInicial),
  // o derivado del estado calculado si no hubiera.
  let estadoSel = c.estadoInicial;
  if (!ESTADOS_GUARDABLES.includes(estadoSel)) {
    estadoSel = c.estado === "cumplido" ? "Cumplido" : "Pendiente";
  }

  $("modalCuerpo").innerHTML = `
    <div class="campo">
      <span class="campo-lbl">Compromiso</span>
      <div class="campo-val campo-compromiso">${escaparHTML(c.compromiso)}</div>
    </div>
    <div class="grid-2">
      <div class="campo"><span class="campo-lbl">Proyecto</span><div class="campo-val">${escaparHTML(c.programa)}</div></div>
      <div class="campo"><span class="campo-lbl">Padrino</span><div class="campo-val">${escaparHTML(c.padrino)}</div></div>
      <div class="campo"><span class="campo-lbl">Municipio</span><div class="campo-val">${escaparHTML(c.municipio)}</div></div>
      <div class="campo"><span class="campo-lbl">Institución</span><div class="campo-val">${escaparHTML(c.institucion)}</div></div>
      <div class="campo"><span class="campo-lbl">Sede</span><div class="campo-val">${escaparHTML(c.sede)}</div></div>
      <div class="campo"><span class="campo-lbl">Responsable</span><div class="campo-val">${escaparHTML(c.responsable)}</div></div>
      <div class="campo"><span class="campo-lbl">Fecha de visita</span><div class="campo-val">${formatearFecha(c.fechaVisita)}</div></div>
      <div class="campo"><span class="campo-lbl">Fecha de verificación</span><div class="campo-val">${formatearFecha(c.fechaVerif)}</div></div>
      <div class="campo"><span class="campo-lbl">Número</span><div class="campo-val">${escaparHTML(c.numero)}</div></div>
    </div>
    <div class="campo">
      <span class="campo-lbl">Estado</span>
      <div class="opciones-estado">
        ${ESTADOS_GUARDABLES.map(
          (e) => `
          <label class="opcion-estado">
            <input type="radio" name="estado" value="${e}" ${e === estadoSel ? "checked" : ""} />
            ${e}
          </label>`
        ).join("")}
      </div>
    </div>
    <div class="campo">
      <span class="campo-lbl">Observaciones</span>
      <textarea id="modalObs" placeholder="Notas de seguimiento…">${escaparHTML(
        c.observaciones || ""
      )}</textarea>
    </div>`;

  $("modalFondo").hidden = false;
}

function cerrarModal() {
  $("modalFondo").hidden = true;
  llaveModalActual = null;
}

async function guardarDesdeModal() {
  if (!llaveModalActual) return;
  const c = compromisos.find((x) => x.llave === llaveModalActual);
  if (!c) return;

  const estadoSel = document.querySelector('input[name="estado"]:checked');
  const estado = estadoSel ? estadoSel.value : c.estadoInicial;
  const observaciones = $("modalObs").value;

  // Snapshot para revertir.
  const previo = { ...c };
  const btn = $("modalGuardar");
  btn.disabled = true;

  // Optimismo: actualizar en memoria y repintar de inmediato.
  aplicarCambioLocal(c, estado, observaciones);
  cerrarModal();
  render();

  try {
    await guardarBackend({ llave: c.llave, estado, observaciones });
    toast(MODO_DEMO ? "Cambio aplicado (demo, no se guarda)" : "Cambios guardados", "ok");
  } catch (err) {
    Object.assign(c, previo); // revertir
    render();
    toast("No se pudo guardar: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// Aplica el cambio de estado/observaciones al objeto en memoria,
// recalculando el `estado` calculado igual que lo haría el backend.
function aplicarCambioLocal(c, estado, observaciones) {
  c.estadoInicial = estado;
  if (observaciones !== undefined) c.observaciones = observaciones;
  c.estado = calcularEstado(estado, c.fechaVerif);
}

// Replica la regla del backend: si está cumplido -> cumplido;
// si no, vencido cuando la fecha de verificación ya pasó; si no, pendiente.
function calcularEstado(estadoGuardado, fechaVerif) {
  if ((estadoGuardado || "").trim().toLowerCase() === "cumplido") return "cumplido";
  const dias = diasHastaVerif(fechaVerif);
  if (dias !== null && dias < 0) return "vencido";
  return "pendiente";
}

// ============================================================
//  Drag & Drop
// ============================================================
let llaveArrastrada = null;

function onDragStart(e) {
  const tarjeta = e.target.closest(".tarjeta");
  if (!tarjeta) return;
  llaveArrastrada = tarjeta.dataset.llave;
  tarjeta.classList.add("arrastrando");
  e.dataTransfer.effectAllowed = "move";
}

function onDragEnd(e) {
  const t = e.target.closest(".tarjeta");
  if (t) t.classList.remove("arrastrando");
  llaveArrastrada = null;
  document
    .querySelectorAll(".columna-cuerpo.drop-activo")
    .forEach((el) => el.classList.remove("drop-activo"));
}

function onDragOver(e) {
  const cuerpo = e.target.closest(".columna-cuerpo");
  if (!cuerpo) return;
  // VENCIDO es solo visualización: no acepta drops.
  if (cuerpo.dataset.col === "vencido") return;
  e.preventDefault();
  cuerpo.classList.add("drop-activo");
}

function onDragLeave(e) {
  const cuerpo = e.target.closest(".columna-cuerpo");
  if (cuerpo && !cuerpo.contains(e.relatedTarget)) cuerpo.classList.remove("drop-activo");
}

async function onDrop(e) {
  const cuerpo = e.target.closest(".columna-cuerpo");
  if (!cuerpo || !llaveArrastrada) return;
  const destino = cuerpo.dataset.col;
  if (destino === "vencido") return; // no permitido
  e.preventDefault();
  cuerpo.classList.remove("drop-activo");

  const c = compromisos.find((x) => x.llave === llaveArrastrada);
  llaveArrastrada = null;
  if (!c) return;

  const nuevoEstado = destino === "cumplido" ? "Cumplido" : "Pendiente";
  if (c.estado === destino) return; // sin cambio real

  const previo = { ...c };
  aplicarCambioLocal(c, nuevoEstado, c.observaciones);
  render();

  try {
    await guardarBackend({ llave: c.llave, estado: nuevoEstado });
    toast(MODO_DEMO ? "Estado actualizado (demo, no se guarda)" : "Estado actualizado", "ok");
  } catch (err) {
    Object.assign(c, previo);
    render();
    toast("No se pudo actualizar: " + err.message, "error");
  }
}

// ============================================================
//  Modo demostración — datos ilustrativos en memoria (no se guardan)
// ============================================================

// Observaciones de ejemplo para compromisos CUMPLIDOS.
const OBS_CUMPLIDO = [
  "Verificado en visita de acompañamiento. El docente implementó la estrategia en todas las áreas y se evidenció el material de trabajo.",
  "Cumplido. Se observaron los roles y formas de trabajo definidos con los estudiantes durante la sesión.",
  "Compromiso atendido satisfactoriamente; se levantó registro fotográfico y acta de la visita.",
  "El docente líder socializó la metodología con el resto del equipo y ya está en uso en el aula.",
  "Verificado: las guías y fichas se están aplicando de forma sistemática. Buen avance.",
  "Cumplido en la fecha prevista. La sede reporta apropiación de la estrategia por parte de los estudiantes.",
  "Se constató la implementación durante la visita de seguimiento. Sin novedades.",
];

// Observaciones de ejemplo para compromisos VENCIDOS (razones de no cumplimiento).
const OBS_VENCIDO = [
  "No se ha podido verificar por cambio de docente en la sede; se reprograma acompañamiento.",
  "Pendiente por dificultades de conectividad y acceso a la sede en temporada de lluvias.",
  "El docente solicitó prórroga por carga académica; se acordó nueva fecha de verificación.",
  "No se completó por suspensión de clases en la institución durante el periodo.",
  "Avance parcial: falta consolidar el material de trabajo. Requiere visita adicional.",
  "No atendido a la fecha. Se escalará con la coordinación del programa.",
];

// Observaciones para compromisos EN PROCESO / pendientes con avance.
const OBS_PROCESO = [
  "En avance; se programó nueva visita de acompañamiento para verificar implementación.",
  "El docente inició la implementación; se hará seguimiento en la próxima visita.",
  "",
];

// Reparto objetivo del demo. Los vencidos toman el remanente (~7%)
// para que el total siempre cuadre.
const DEMO_PCT_CUMPLIDO = 0.83;
const DEMO_PCT_PENDIENTE = 0.1;

function aleatorio(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function enteroAleatorio(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function mezclar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// "aaaa-mm-dd" a partir de un Date.
function isoDesdeFecha(f) {
  const mm = String(f.getMonth() + 1).padStart(2, "0");
  const dd = String(f.getDate()).padStart(2, "0");
  return `${f.getFullYear()}-${mm}-${dd}`;
}

// Fecha relativa a hoy (+futuro / -pasado) en ISO.
function isoRelativoAHoy(dias) {
  const f = hoyMedianoche();
  f.setDate(f.getDate() + dias);
  return isoDesdeFecha(f);
}

// Reparte estados sobre los datos cargados, SOLO en memoria.
// Reparto exacto: ~83% cumplidos, ~10% pendientes y ~7% vencidos.
// Ajusta también la fechaVerif para que cada columna sea coherente:
// un pendiente no puede tener la fecha de verificación ya pasada.
function aplicarDatosDemo() {
  const total = compromisos.length;
  const nCumplido = Math.round(total * DEMO_PCT_CUMPLIDO);
  const nPendiente = Math.round(total * DEMO_PCT_PENDIENTE); // el remanente queda en vencidos

  mezclar(compromisos).forEach((c, i) => {
    if (i < nCumplido) {
      // Cumplido: se conserva su fecha real (ya se verificó).
      c.estadoInicial = "Cumplido";
      c.observaciones = aleatorio(OBS_CUMPLIDO);
    } else if (i < nCumplido + nPendiente) {
      // Pendiente: la verificación aún no llega -> fecha en el futuro.
      c.estadoInicial = Math.random() < 0.5 ? "En proceso" : "Pendiente";
      c.observaciones = aleatorio(OBS_PROCESO);
      // ~1 de cada 3 dentro de los próximos 7 días, para alimentar las alertas.
      c.fechaVerif =
        Math.random() < 0.33
          ? isoRelativoAHoy(enteroAleatorio(1, CONFIG.DIAS_ALERTA))
          : isoRelativoAHoy(enteroAleatorio(8, 45));
    } else {
      // Vencido: la fecha de verificación ya pasó.
      c.estadoInicial = "Pendiente";
      c.observaciones = aleatorio(OBS_VENCIDO);
      const dias = diasHastaVerif(c.fechaVerif);
      if (dias === null || dias >= 0) c.fechaVerif = isoRelativoAHoy(-enteroAleatorio(1, 60));
    }
    // El estado se deriva con la misma regla del backend -> columna coherente.
    c.estado = calcularEstado(c.estadoInicial, c.fechaVerif);
  });
}

// ============================================================
//  Carga de datos
// ============================================================

async function cargar() {
  $("estadoError").hidden = true;
  $("estadoCarga").hidden = false;
  $("tablero").style.display = "none";

  try {
    compromisos = await API.leer();
    if (MODO_DEMO) {
      aplicarDatosDemo();
      $("bannerDemo").hidden = false;
    }
    poblarTodosLosFiltros();
    aplicarFiltrosDesdeURL();
    render();
    $("tablero").style.display = "";
  } catch (err) {
    $("errorTexto").textContent =
      "No se pudieron cargar los datos. " + err.message;
    $("estadoError").hidden = false;
  } finally {
    $("estadoCarga").hidden = true;
  }
}

// ============================================================
//  Eventos
// ============================================================

function conectarEventos() {
  $("btnActualizar").addEventListener("click", cargar);
  $("btnReintentar").addEventListener("click", cargar);

  ["filtroPrograma", "filtroPadrino", "filtroMunicipio"].forEach((id) =>
    $(id).addEventListener("change", render)
  );
  $("filtroBusqueda").addEventListener("input", render);

  $("btnLimpiar").addEventListener("click", () => {
    $("filtroPrograma").value = "";
    $("filtroPadrino").value = "";
    $("filtroMunicipio").value = "";
    $("filtroBusqueda").value = "";
    render();
  });

  // Acciones de la barra superior.
  $("btnExportar").addEventListener("click", exportarCSV);
  $("btnImprimir").addEventListener("click", () => window.print());

  // Panel de resumen.
  $("btnResumen").addEventListener("click", () => {
    const panel = $("resumen");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderResumen();
  });
  $("btnCerrarResumen").addEventListener("click", () => ($("resumen").hidden = true));
  document.querySelectorAll(".resumen-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      tabResumen = tab.dataset.tab;
      document.querySelectorAll(".resumen-tab").forEach((t) => t.classList.remove("activo"));
      tab.classList.add("activo");
      renderResumen();
    })
  );

  // "Ver más" en las columnas (delegado en el tablero).
  $("tablero").addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-vermas");
    if (btn) {
      mostrarTodo[btn.dataset.col] = true;
      render();
    }
  });

  // Modal
  $("modalCerrar").addEventListener("click", cerrarModal);
  $("modalCancelar").addEventListener("click", cerrarModal);
  $("modalGuardar").addEventListener("click", guardarDesdeModal);
  $("modalFondo").addEventListener("click", (e) => {
    if (e.target === $("modalFondo")) cerrarModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("modalFondo").hidden) cerrarModal();
  });

  // Clic en tarjeta -> modal (delegado en el tablero).
  $("tablero").addEventListener("click", (e) => {
    const tarjeta = e.target.closest(".tarjeta");
    if (tarjeta) abrirModal(tarjeta.dataset.llave);
  });

  // Clic en alerta -> modal.
  $("alertasLista").addEventListener("click", (e) => {
    const item = e.target.closest(".alerta-item");
    if (item) abrirModal(item.dataset.llave);
  });

  $("btnToggleAlertas").addEventListener("click", () => {
    const lista = $("alertasLista");
    const oculto = lista.style.display === "none";
    lista.style.display = oculto ? "" : "none";
    $("btnToggleAlertas").textContent = oculto ? "Ocultar" : "Mostrar";
  });

  // Drag & drop (delegado en el tablero).
  const tablero = $("tablero");
  tablero.addEventListener("dragstart", onDragStart);
  tablero.addEventListener("dragend", onDragEnd);
  tablero.addEventListener("dragover", onDragOver);
  tablero.addEventListener("dragleave", onDragLeave);
  tablero.addEventListener("drop", onDrop);
}

// --- Arranque ---
document.addEventListener("DOMContentLoaded", () => {
  conectarEventos();
  cargar();
});
