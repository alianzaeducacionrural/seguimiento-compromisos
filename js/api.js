// Capa de comunicación con el backend (Apps Script Web App).
// El resto del front solo usa API.leer() y API.guardar().
const API = {
  // GET: trae todos los compromisos.
  async leer() {
    const resp = await fetch(CONFIG.API_URL, { method: "GET" });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || "Error al leer los datos");
    return json.data;
  },

  // POST: guarda estado y/o observaciones de un compromiso.
  // IMPORTANTE: Content-Type text/plain para evitar el preflight CORS de Apps Script.
  async guardar({ llave, estado, observaciones }) {
    const payload = { llave };
    if (estado !== undefined) payload.estado = estado;
    if (observaciones !== undefined) payload.observaciones = observaciones;

    const resp = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || "Error al guardar");
    return json;
  },
};
