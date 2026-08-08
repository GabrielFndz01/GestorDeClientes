/* ==========================================================================
   CENTRO DE SOPORTE — Gestor de Tickets
   app.js

   CONTRATO DE LA API (Google Apps Script - Web App):
   ---------------------------------------------------------------------
   GET  {API_URL}
     -> Devuelve un array JSON de tickets con las claves exactas:
        Nr_Cliente, "Marca temporal", Nombre, Apellido, Localidad,
        "Teléfono (WhatsApp)", Dispositivo, "Detalles de la consulta",
        Prioridad ("Alta"|"Media"|"Baja"), Estado (boolean),
        Archivado (boolean), Diagnostico (string)

   POST {API_URL}   (Content-Type: text/plain — ver nota más abajo)
     Body: { action: "update", Nr_Cliente, ...camposModificados }
     Body: { action: "create", Nombre, Apellido, Localidad, ... }
     -> El backend debe parsear e.postData.contents con JSON.parse()
        y responder con JSON, idealmente devolviendo el ticket creado/
        actualizado (para "create" es clave devolver el Nr_Cliente real
        que asignó la planilla).

   NOTA SOBRE CORS: los Web Apps de Apps Script no manejan bien el
   preflight OPTIONS que dispara un POST con Content-Type: application/json.
   Por eso este archivo envía el POST como "text/plain;charset=utf-8"
   (sigue siendo JSON válido en el body) para que el navegador lo trate
   como "solicitud simple" y evite el preflight.
   ========================================================================== */

/* ---------- CONFIGURACIÓN ---------- */
const CONFIG = {
  // Reemplazá esto por la URL de tu despliegue de Apps Script (…/exec)
  API_URL: "URL_DE_TU_API_AQUI",
};

const PLACEHOLDER_URL = "URL_DE_TU_API_AQUI";

/* ---------- ESTADO GLOBAL ---------- */
let ticketsData = [];           // Cache local de tickets (evita GET innecesarios)
let activeTab = "activos";      // Pestaña activa
let charts = {};                // Instancias de Chart.js activas

const searchTerm = { activos: "", archivados: "" };
const priorityFilter = { activos: "todas", archivados: "todas" };

const CHART_PALETTE = ["#4fd1c5", "#f0554b", "#f2b84b", "#4cc38a", "#7c93ff", "#d473d4", "#5ac8d8", "#e39b4f", "#9aa5b1"];

/* ==========================================================================
   INICIALIZACIÓN
   ========================================================================== */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  setupNav();
  setupToolbars();
  setupGridListeners("gridActivos");
  setupGridListeners("gridArchivados");
  setupThemeToggle();
  document.getElementById("refreshBtn").addEventListener("click", () => loadTickets());
  document.getElementById("newTicketForm").addEventListener("submit", handleNewTicketSubmit);

  if (CONFIG.API_URL === PLACEHOLDER_URL) {
    showToast("Configurá CONFIG.API_URL en app.js con la URL de tu Apps Script.", "error");
  }

  await loadTickets();
}

/* ==========================================================================
   CARGA DE DATOS (GET)
   ========================================================================== */
async function loadTickets() {
  if (CONFIG.API_URL === PLACEHOLDER_URL) {
    renderAll();
    return;
  }

  showLoading(true, "Cargando tickets…");
  try {
    const res = await fetch(CONFIG.API_URL, { method: "GET" });
    if (!res.ok) throw new Error("Error HTTP " + res.status);
    const data = await res.json();
    ticketsData = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
    renderAll();
    setLastSync();
    showToast("Tickets actualizados", "success");
  } catch (err) {
    console.error("Error al cargar tickets:", err);
    showToast("No se pudieron cargar los tickets. Verificá la conexión con la API.", "error");
    renderAll();
  } finally {
    showLoading(false);
  }
}

function renderAll() {
  renderTickets("activos");
  renderTickets("archivados");
  updateSidebarBadge();
  if (activeTab === "analiticas") renderCharts();
}

/* ==========================================================================
   NAVEGACIÓN ENTRE PESTAÑAS
   ========================================================================== */
function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  document.getElementById(`tab-${tabName}`).classList.add("active");

  if (tabName === "analiticas") renderCharts();
}

/* ==========================================================================
   BARRAS DE BÚSQUEDA / FILTRO
   ========================================================================== */
function setupToolbars() {
  document.getElementById("searchActivos").addEventListener(
    "input",
    debounce((e) => {
      searchTerm.activos = e.target.value;
      renderTickets("activos");
    }, 250)
  );
  document.getElementById("filterActivos").addEventListener("change", (e) => {
    priorityFilter.activos = e.target.value;
    renderTickets("activos");
  });

  document.getElementById("searchArchivados").addEventListener(
    "input",
    debounce((e) => {
      searchTerm.archivados = e.target.value;
      renderTickets("archivados");
    }, 250)
  );
  document.getElementById("filterArchivados").addEventListener("change", (e) => {
    priorityFilter.archivados = e.target.value;
    renderTickets("archivados");
  });
}

/* ==========================================================================
   RENDER DE TICKETS (Pestañas 1 y 2)
   ========================================================================== */
function renderTickets(tab) {
  const isArchived = tab === "archivados";
  const gridEl = document.getElementById(isArchived ? "gridArchivados" : "gridActivos");
  const countEl = document.getElementById(isArchived ? "countArchivados" : "countActivos");
  const search = (searchTerm[tab] || "").trim().toLowerCase();
  const priority = priorityFilter[tab] || "todas";

  let list = ticketsData.filter((t) => Boolean(t.Archivado) === isArchived);

  if (search) {
    list = list.filter((t) => {
      const haystack = [t.Nombre, t.Apellido, t.Localidad, t.Dispositivo].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }
  if (priority !== "todas") {
    list = list.filter((t) => t.Prioridad === priority);
  }

  list.sort((a, b) => new Date(b["Marca temporal"]) - new Date(a["Marca temporal"]));

  countEl.textContent = `${list.length} ticket${list.length === 1 ? "" : "s"}`;

  gridEl.innerHTML = list.length === 0 ? emptyStateHtml(isArchived, Boolean(search) || priority !== "todas") : list.map((t) => ticketCardHtml(t, isArchived)).join("");
}

function ticketCardHtml(t, isArchived) {
  const id = escapeHtml(String(t.Nr_Cliente));
  const priority = t.Prioridad || "Media";
  const phoneRaw = t["Teléfono (WhatsApp)"] || "";
  const waLink = phoneRaw ? `https://wa.me/${phoneRaw.replace(/\D/g, "")}` : "";
  const resuelto = Boolean(t.Estado);

  return `
    <article class="ticket-card" data-priority="${escapeHtml(priority)}">
      <div class="ticket-card-header">
        <div>
          <h3>${escapeHtml(t.Nombre || "")} ${escapeHtml(t.Apellido || "")}</h3>
          <p class="ticket-meta">${escapeHtml(t.Localidad || "Sin localidad")}</p>
        </div>
        <div class="ticket-tag">
          <span class="ticket-id">#${id}</span>
          <span class="ticket-date">${formatDate(t["Marca temporal"])}</span>
        </div>
      </div>

      <dl class="ticket-info">
        <div><dt>Dispositivo</dt><dd>${escapeHtml(t.Dispositivo || "—")}</dd></div>
        <div><dt>Teléfono</dt><dd>${phoneRaw ? `<a href="${waLink}" target="_blank" rel="noopener">${escapeHtml(phoneRaw)}</a>` : "—"}</dd></div>
      </dl>

      <p class="ticket-details">${escapeHtml(t["Detalles de la consulta"] || "Sin detalles registrados.")}</p>

      <div class="ticket-controls">
        <div class="control-field" style="margin-bottom:0;">
          <label for="prio-${id}">Prioridad</label>
          <select id="prio-${id}" class="priority-select" data-id="${id}" data-value="${escapeHtml(priority)}">
            <option value="Alta" ${priority === "Alta" ? "selected" : ""}>Alta</option>
            <option value="Media" ${priority === "Media" ? "selected" : ""}>Media</option>
            <option value="Baja" ${priority === "Baja" ? "selected" : ""}>Baja</option>
          </select>
        </div>

        <label class="status-toggle">
          <input type="checkbox" class="status-checkbox" data-id="${id}" ${resuelto ? "checked" : ""} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="status-text">${resuelto ? "Resuelto" : "Pendiente"}</span>
        </label>
      </div>

      <div class="control-field">
        <label for="diag-${id}">Diagnóstico</label>
        <textarea id="diag-${id}" class="diagnostico-input" data-id="${id}" rows="2" placeholder="Anotá el diagnóstico o la solución…">${escapeHtml(t.Diagnostico || "")}</textarea>
      </div>

      <footer class="ticket-card-footer">
        <button type="button" class="btn-archive ${isArchived ? "btn-unarchive" : ""}" data-id="${id}" data-action="${isArchived ? "desarchivar" : "archivar"}">
          ${isArchived ? "↩ Desarchivar" : "🗄 Archivar"}
        </button>
      </footer>
    </article>
  `;
}

function emptyStateHtml(isArchived, isFiltered) {
  if (isFiltered) {
    return `
      <div class="empty-state">
        <p class="empty-icon">🔍</p>
        <h3>Sin resultados</h3>
        <p>Ningún ticket coincide con la búsqueda o el filtro aplicado.</p>
      </div>`;
  }
  return `
    <div class="empty-state">
      <p class="empty-icon">${isArchived ? "🗄" : "📭"}</p>
      <h3>${isArchived ? "No hay tickets archivados" : "No hay tickets activos"}</h3>
      <p>${isArchived ? "Los tickets que archives van a aparecer acá." : "Cuando cargues un nuevo ticket, va a aparecer en esta vista."}</p>
    </div>`;
}

/* ---------- Delegación de eventos por grilla ---------- */
function setupGridListeners(gridId) {
  const grid = document.getElementById(gridId);

  // change: burbujea normalmente -> sirve para <select> y <checkbox>
  grid.addEventListener("change", (e) => {
    const id = e.target.dataset.id;
    if (!id) return;

    if (e.target.matches(".priority-select")) {
      e.target.dataset.value = e.target.value; // feedback visual inmediato
      updateTicketField(id, { Prioridad: e.target.value });
    } else if (e.target.matches(".status-checkbox")) {
      updateTicketField(id, { Estado: e.target.checked });
    }
  });

  // blur no burbujea: se necesita captura para delegar
  grid.addEventListener(
    "blur",
    (e) => {
      if (e.target.matches(".diagnostico-input")) {
        const id = e.target.dataset.id;
        const original = ticketsData.find((t) => String(t.Nr_Cliente) === String(id));
        if (original && (original.Diagnostico || "") === e.target.value) return; // sin cambios reales
        updateTicketField(id, { Diagnostico: e.target.value }, { skipRerender: true });
      }
    },
    true
  );

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-archive");
    if (!btn) return;
    const id = btn.dataset.id;
    const archivar = btn.dataset.action === "archivar";
    updateTicketField(id, { Archivado: archivar });
  });
}

/* ==========================================================================
   ACTUALIZACIÓN DE TICKETS (POST) — actualización optimista + rollback
   ========================================================================== */
async function updateTicketField(nrCliente, changes, options = {}) {
  const idx = ticketsData.findIndex((t) => String(t.Nr_Cliente) === String(nrCliente));
  if (idx === -1) return;

  const previous = { ...ticketsData[idx] };
  ticketsData[idx] = { ...ticketsData[idx], ...changes };

  if (!options.skipRerender) {
    renderTickets(activeTab === "archivados" ? "archivados" : "activos");
    // Un cambio de Archivado puede mover el ticket entre pestañas: refrescamos ambas.
    renderTickets("activos");
    renderTickets("archivados");
  }
  updateSidebarBadge();

  try {
    await postToApi({ action: "update", Nr_Cliente: nrCliente, ...changes });
    showToast("Cambios guardados", "success");
  } catch (err) {
    console.error("Error al actualizar ticket:", err);
    ticketsData[idx] = previous;
    renderTickets("activos");
    renderTickets("archivados");
    updateSidebarBadge();
    showToast("No se pudo guardar el cambio. Se revirtió localmente.", "error");
  }
}

async function postToApi(payload) {
  if (CONFIG.API_URL === PLACEHOLDER_URL) {
    throw new Error("API_URL sin configurar");
  }
  const res = await fetch(CONFIG.API_URL, {
    method: "POST",
    // text/plain evita el preflight CORS que los Web Apps de Apps Script no manejan bien
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Error HTTP " + res.status);

  const result = await res.json().catch(() => ({}));
  // Apps Script casi siempre responde HTTP 200 aunque el script haya
  // manejado un error internamente (ticket no encontrado, columna
  // faltante, etc.), así que el éxito real se valida en el body.
  if (result && result.success === false) {
    throw new Error(result.error || "La API respondió con un error");
  }
  return result;
}

function updateSidebarBadge() {
  const pendientes = ticketsData.filter((t) => !t.Archivado && !t.Estado).length;
  const badge = document.getElementById("badgeActivos");
  badge.textContent = pendientes;
  badge.style.display = pendientes > 0 ? "inline-flex" : "none";
}

/* ==========================================================================
   NUEVO TICKET (Pestaña 4)
   ========================================================================== */
async function handleNewTicketSubmit(e) {
  e.preventDefault();
  const form = e.target;

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const fd = new FormData(form);
  const nuevoTicket = {
    action: "create",
    Nombre: fd.get("nombre").trim(),
    Apellido: fd.get("apellido").trim(),
    Localidad: fd.get("localidad").trim(),
    "Teléfono (WhatsApp)": fd.get("telefono").trim(),
    Dispositivo: fd.get("dispositivo").trim(),
    "Detalles de la consulta": fd.get("detalles").trim(),
    Prioridad: fd.get("prioridad"),
    Estado: false,
    Archivado: false,
    Diagnostico: "",
    "Marca temporal": new Date().toISOString(),
  };

  const submitBtn = document.getElementById("submitTicketBtn");
  submitBtn.disabled = true;
  showLoading(true, "Creando ticket…");

  try {
    await postToApi(nuevoTicket);
    form.reset();
    document.getElementById("fPrioridad").value = "Media";
    showToast("Ticket creado con éxito", "success");
    // Volvemos a pedir los datos: así el Nr_Cliente que asigna la planilla
    // queda sincronizado (evita conflictos de ID generados en el cliente).
    await loadTickets();
    switchTab("activos");
  } catch (err) {
    console.error("Error al crear ticket:", err);
    showToast("No se pudo crear el ticket. Intentá nuevamente.", "error");
  } finally {
    submitBtn.disabled = false;
    showLoading(false);
  }
}

/* ==========================================================================
   ANALÍTICAS (Pestaña 3) — Chart.js
   Los gráficos se crean recién cuando se visita la pestaña, porque
   Chart.js mide el tamaño del <canvas> y un contenedor con display:none
   reporta ancho 0 (bug clásico de charts dentro de tabs ocultas).
   ========================================================================== */
function renderCharts() {
  const hasData = ticketsData.length > 0;

  toggleChartEmpty("emptyLocalidades", "chartLocalidades", !hasData);
  toggleChartEmpty("emptyArchivadosChart", "chartArchivados", !hasData);
  toggleChartEmpty("emptyCarga", "chartCarga", !hasData);

  if (!hasData) return;

  const localidadCounts = countBy(ticketsData, "Localidad");
  renderPieChart("chartLocalidades", "localidades", localidadCounts);

  const archivadoCounts = {
    Activos: ticketsData.filter((t) => !t.Archivado).length,
    Archivados: ticketsData.filter((t) => t.Archivado).length,
  };
  renderPieChart("chartArchivados", "archivados", archivadoCounts);

  const activos = ticketsData.filter((t) => !t.Archivado);
  const inicioSemana = getStartOfWeek(new Date());
  const nuevosEstaSemana = activos.filter((t) => {
    const d = new Date(t["Marca temporal"]);
    return !isNaN(d) && d >= inicioSemana;
  }).length;
  const cerrados = activos.filter((t) => t.Estado === true).length;

  renderDonutChart("chartCarga", "carga", {
    "Nuevos esta semana": nuevosEstaSemana,
    "Resueltos (cerrados)": cerrados,
  });
}

function toggleChartEmpty(emptyId, canvasId, show) {
  document.getElementById(emptyId).hidden = !show;
  document.getElementById(canvasId).style.display = show ? "none" : "block";
}

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

function cssVar(name, fallback) {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: cssVar("--text-secondary", "#8fa0a8"), font: { family: "Inter, sans-serif", size: 12 }, padding: 14, boxWidth: 12 },
      },
      tooltip: { padding: 10 },
    },
  };
}

function renderPieChart(canvasId, key, dataObj) {
  destroyChart(key);
  const canvas = document.getElementById(canvasId);
  charts[key] = new Chart(canvas, {
    type: "pie",
    data: {
      labels: Object.keys(dataObj),
      datasets: [
        {
          data: Object.values(dataObj),
          backgroundColor: CHART_PALETTE,
          borderColor: cssVar("--bg-surface", "#161c21"),
          borderWidth: 2,
        },
      ],
    },
    options: baseChartOptions(),
  });
}

function renderDonutChart(canvasId, key, dataObj) {
  destroyChart(key);
  const canvas = document.getElementById(canvasId);
  charts[key] = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: Object.keys(dataObj),
      datasets: [
        {
          data: Object.values(dataObj),
          backgroundColor: [CHART_PALETTE[0], CHART_PALETTE[3]],
          borderColor: cssVar("--bg-surface", "#161c21"),
          borderWidth: 2,
        },
      ],
    },
    options: { ...baseChartOptions(), cutout: "62%" },
  });
}

function countBy(list, key) {
  return list.reduce((acc, item) => {
    const raw = item[key];
    const k = raw && String(raw).trim() ? String(raw).trim() : "Sin dato";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = domingo … 6 = sábado
  const diff = (day === 0 ? -6 : 1) - day; // retrocede hasta el lunes
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ==========================================================================
   TEMA CLARO / OSCURO
   ========================================================================== */
function setupThemeToggle() {
  const switchEl = document.getElementById("themeSwitch");
  switchEl.addEventListener("change", (e) => {
    const theme = e.target.checked ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("themeLabel").textContent = theme === "dark" ? "Modo oscuro" : "Modo claro";
    if (ticketsData.length > 0) renderCharts(); // recalcula colores de leyenda para el nuevo tema
  });
}

/* ==========================================================================
   UI: LOADING / TOASTS
   ========================================================================== */
function showLoading(state, text) {
  const overlay = document.getElementById("loadingOverlay");
  if (text) document.getElementById("loadingText").textContent = text;
  overlay.classList.toggle("visible", state);
  overlay.setAttribute("aria-hidden", String(!state));
}

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function setLastSync() {
  const el = document.getElementById("lastSync");
  const now = new Date();
  el.textContent = "Actualizado " + now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/* ==========================================================================
   UTILIDADES
   ========================================================================== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  const d = new Date(value);
  if (isNaN(d)) return "—";
  const fecha = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return `${fecha} ${hora}`;
}

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
