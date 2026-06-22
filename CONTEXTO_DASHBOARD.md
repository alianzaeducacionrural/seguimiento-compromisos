# Dashboard de Seguimiento de Compromisos — Contexto para implementación

> Documento de contexto para construir el **frontend**. El backend (Google Apps Script + Google Sheets) ya está hecho y desplegado. Aquí solo se construye el cliente web.

---

## 1. Qué es esto

Una aplicación web para hacer seguimiento a los **compromisos** que dejan los "padrinos" (asesores) en sus visitas de acompañamiento a instituciones educativas rurales del Comité de Cafeteros de Caldas.

El dashboard permite:
- Ver todos los compromisos consolidados de 6 programas educativos.
- Filtrar libremente (sin login, acceso abierto) por padrino, programa, municipio, etc.
- Organizar los compromisos en un **tablero tipo Trello** (3 columnas).
- Cambiar el estado de un compromiso **arrastrando** entre columnas **o** desde un **modal**.
- Editar **observaciones** de cada compromiso.
- Ver **KPIs** y **alertas de vencimiento** arriba.

**Sin autenticación.** Acceso libre. El padrino simplemente filtra por su nombre.

---

## 2. Stack y despliegue

- **Frontend:** HTML + CSS + JavaScript **vanilla** (sin frameworks). Sitio estático.
- **Despliegue:** GitHub Pages.
- **Backend (ya hecho):** Google Apps Script desplegado como Web App, con Google Sheets como base de datos.
- **Restricción de contexto:** se usa en zonas rurales con conexión limitada → mantener todo **ligero**, pocos archivos, sin dependencias pesadas. Librerías solo si son imprescindibles (p. ej. una pequeña de drag & drop, o implementarlo nativo con la API HTML5 Drag and Drop).

Estructura de archivos sugerida (estático, simple):
```
/index.html
/css/style.css
/js/app.js
/js/api.js      (llamadas al backend)
/js/config.js   (URL del API — fácil de cambiar)
```

---

## 3. El backend ya existe — CONTRATO DE LA API

El backend es un Apps Script desplegado como Web App. **La URL `/exec` se coloca en `config.js`.** El front NO debe asumir nada del Sheet; solo consume esta API.

### 3.1 Leer compromisos — `GET`

Petición: `GET {URL_API}` (sin parámetros).

Respuesta (JSON):
```json
{
  "ok": true,
  "data": [
    {
      "llave": "Escuela Nueva|6961adf9-...|1",
      "programa": "Escuela Nueva",
      "padrino": "Juan Gabriel Alzate Gallego",
      "correo": "edurural.alzate.juang@gmail.com",
      "fechaVisita": "2026-02-11",
      "municipio": "Anserma",
      "institucion": "San Pedro",
      "sede": "El Rosario",
      "compromiso": "Dinamizar en todas las áreas...",
      "responsable": "Docente líder Derli Lorena Martínez",
      "fechaVerif": "2026-02-27",
      "numero": 1,
      "estadoInicial": "Pendiente",
      "observaciones": "",
      "estado": "vencido"
    }
  ]
}
```

**Campos clave:**
- `llave` → **identificador único** de cada compromiso. Es lo que se envía al guardar. NUNCA modificarla.
- `estadoInicial` → lo que está guardado en la base: uno de `Pendiente` | `En proceso` | `Cumplido`.
- `estado` → **estado calculado por el backend** (en minúsculas): `pendiente` | `cumplido` | `vencido`. Este es el que define en qué columna del tablero va la tarjeta. **`vencido` no está guardado**: lo calcula el backend comparando `fechaVerif` con la fecha de hoy.
- Las fechas (`fechaVisita`, `fechaVerif`) llegan en formato ISO `aaaa-mm-dd`. **Ver sección 6 sobre formato de fecha.**

En caso de error: `{ "ok": false, "error": "mensaje" }`.

### 3.2 Guardar cambios — `POST`

Cuando el padrino cambia un estado o edita observaciones, se envía un POST.

Petición: `POST {URL_API}` con cuerpo JSON:
```json
{
  "llave": "Escuela Nueva|6961adf9-...|1",
  "estado": "Cumplido",
  "observaciones": "Se verificó en visita del 27/02"
}
```

- `llave` → **obligatoria**. Identifica qué compromiso actualizar.
- `estado` → opcional. Si se envía, debe ser uno de: `Pendiente` | `En proceso` | `Cumplido`. **NUNCA enviar "vencido"** (no es un estado guardable; es calculado).
- `observaciones` → opcional. Texto libre.
- Se puede enviar solo uno de los dos campos (estado u observaciones) o ambos.

Respuesta: `{ "ok": true, "llave": "..." }` o `{ "ok": false, "error": "..." }`.

### 3.3 ⚠️ Detalle técnico importante: CORS con Apps Script

Apps Script Web Apps tienen un comportamiento particular con CORS en peticiones POST:
- Para **evitar el preflight CORS**, enviar el POST con `Content-Type: text/plain;charset=utf-8` (NO `application/json`), aunque el cuerpo sea un JSON serializado con `JSON.stringify`. El backend hace `JSON.parse(e.postData.contents)` igual.
- Usar `fetch` con `method: "POST"`, `body: JSON.stringify(payload)` y el header de tipo texto plano.
- El `GET` no tiene problema de CORS.

Ejemplo de POST correcto:
```javascript
await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ llave, estado, observaciones })
});
```

---

## 4. La interfaz — qué construir

Layout de arriba hacia abajo:

```
┌────────────────────────────────────────────────────────┐
│  Seguimiento de Compromisos              [↻ Actualizar]  │
├────────────────────────────────────────────────────────┤
│  KPIs:  [Pendientes: N]  [Cumplidos: N]  [Vencidos: N]   │  ← sección 4.1
├────────────────────────────────────────────────────────┤
│  ⚠ Próximos a vencer (7 días) / Vencidos sin atender     │  ← sección 4.2
├────────────────────────────────────────────────────────┤
│  Filtros: [Programa▾] [Padrino▾] [Municipio▾] [buscar..] │  ← sección 4.3
├────────────────────────────────────────────────────────┤
│   PENDIENTE        │    CUMPLIDO       │    VENCIDO       │  ← sección 4.4
│  ┌───────────┐     │  ┌───────────┐    │  ┌───────────┐   │     (tablero Trello)
│  │ tarjeta   │     │  │ tarjeta   │    │  │ tarjeta   │   │
│  └───────────┘     │  └───────────┘    │  └───────────┘   │
└────────────────────────────────────────────────────────┘
```

### 4.1 KPIs (tarjetas de conteo)
Tres contadores que reflejan los compromisos **actualmente filtrados**: cuántos `pendiente`, cuántos `cumplido`, cuántos `vencido`. Si cambian los filtros, los KPIs se recalculan.

### 4.2 Alertas de vencimiento
Lista compacta arriba con:
- Compromisos **vencidos** (estado `vencido`).
- Compromisos **próximos a vencer**: estado `pendiente` cuya `fechaVerif` está dentro de los próximos **7 días**.
Cada alerta muestra: institución – sede – fecha de verificación (en dd/mm/aaaa) – padrino. Clic en una alerta → abre el modal de ese compromiso.

### 4.3 Filtros
- **Programa** (desplegable, valores únicos del campo `programa`).
- **Padrino** (desplegable, valores únicos de `padrino`). ← el principal: cada padrino filtra por su nombre.
- **Municipio** (desplegable).
- **Búsqueda de texto** (input libre que busca en `compromiso`, `institucion`, `sede`, `responsable`).
- Los filtros se combinan (AND). Un botón "Limpiar filtros".
- No hay login: el padrino solo selecciona su nombre en el filtro Padrino.

### 4.4 Tablero tipo Trello — 3 columnas
Columnas: **PENDIENTE**, **CUMPLIDO**, **VENCIDO**.

Reparto de tarjetas según el campo `estado` calculado por la API:
- `pendiente` → columna PENDIENTE
- `cumplido`  → columna CUMPLIDO
- `vencido`   → columna VENCIDO

**Caso "En proceso":** algunos compromisos tienen `estadoInicial = "En proceso"`. La API los devuelve con `estado = "pendiente"` (porque aún no se cumplen). Entonces:
- Se muestran en la columna **PENDIENTE**.
- La tarjeta lleva una **etiqueta/badge visible "En proceso"** para no perder ese matiz.
- En el **modal**, "En proceso" SÍ aparece como una opción de estado seleccionable.

---

## 5. Comportamiento de edición (las dos formas)

### 5.1 Arrastrar (drag & drop)
- El padrino arrastra una tarjeta entre columnas.
- **Reglas de arrastre:**
  - **NO se puede arrastrar HACIA la columna VENCIDO.** "Vencido" no es un estado que se elige; lo determina la fecha. La columna VENCIDO es **solo de visualización** (no acepta drops).
  - Desde PENDIENTE → CUMPLIDO: permitido. Al soltar, se envía `estado: "Cumplido"`.
  - Desde CUMPLIDO → PENDIENTE: permitido. Al soltar, se envía `estado: "Pendiente"`.
  - Desde VENCIDO → CUMPLIDO: permitido (el compromiso se cumplió aunque tarde). Al soltar, se envía `estado: "Cumplido"`.
  - Desde VENCIDO → PENDIENTE: permitido (se envía `estado: "Pendiente"`), pero **ojo**: como la fecha ya pasó, en la siguiente recarga el backend lo volverá a marcar `vencido` y la tarjeta reaparecerá en VENCIDO. Esto es el comportamiento esperado, no un bug.
- Al soltar: hacer el POST, y mientras responde, mostrar un estado optimista (mover la tarjeta ya) con reversión si el POST falla.

### 5.2 Modal (clic en la tarjeta)
Clic en cualquier tarjeta → abre un modal con el detalle completo:
- Datos no editables (mostrar): programa, padrino, municipio, institución, sede, compromiso (texto completo), responsable, fecha de visita, fecha de verificación, número.
- **Selector de estado** (editable): radio buttons o desplegable con **Pendiente / En proceso / Cumplido**. (NO incluir "Vencido" como opción seleccionable.)
- **Observaciones** (editable): textarea.
- Botón **Guardar** → hace el POST con `estado` y `observaciones`. Botón **Cancelar/Cerrar**.
- Tras guardar con éxito: cerrar modal, refrescar la tarjeta/tablero para reflejar el nuevo estado calculado.

---

## 6. Formato de fechas — REGLA ESTRICTA

- Internamente las fechas viajan en ISO `aaaa-mm-dd` (así llegan del API y así se comparan).
- **El usuario SIEMPRE debe ver las fechas en formato `dd/mm/aaaa`.** En todas las vistas: tarjetas, modal, alertas, etc.
- Crear una función utilitaria `formatearFecha(iso)` que convierta `"2026-02-27"` → `"27/02/2026"`. Manejar el caso de cadena vacía (devolver `""` o un guion).
- Para comparaciones (calcular "próximo a vencer 7 días") usar las fechas ISO / objetos Date, nunca el string formateado.

---

## 7. Estados y colores (sugerencia visual)

| Estado calculado | Columna | Color sugerido | Badge extra |
|---|---|---|---|
| `pendiente` | PENDIENTE | amarillo/ámbar | si `estadoInicial="En proceso"` → badge "En proceso" |
| `cumplido` | CUMPLIDO | verde | — |
| `vencido` | VENCIDO | rojo | — |

Diseño limpio, legible, responsive (debe verse bien en móvil, porque algunos padrinos lo abrirán desde el celular en campo). Acceso lento → evitar imágenes pesadas, usar fuentes del sistema.

---

## 8. Detalles de UX importantes

- **Carga inicial:** mostrar un indicador de carga mientras llega el GET. Si el API falla, mensaje claro + botón reintentar.
- **Botón "Actualizar"** arriba: vuelve a hacer el GET (los datos pueden haber cambiado o el trigger del backend agregó compromisos nuevos).
- **Optimismo + reversión:** al editar (drag o modal), actualizar la UI de inmediato y revertir si el POST devuelve `ok:false`.
- **Sin estado global complejo:** al ser vanilla, mantener un array `compromisos` en memoria y una función `render()` que repinta según filtros. Tras un POST exitoso, actualizar el objeto en memoria y volver a renderizar (no es necesario re-hacer el GET completo en cada edición).
- **Responsive:** en móvil, las 3 columnas pueden apilarse o volverse pestañas; el drag & drop puede ser difícil en móvil, así que el **modal es el camino principal en pantallas pequeñas**.

---

## 9. Resumen del flujo de datos

```
Google Sheets (6 origen) ──trigger cada hora──> Sheet MAESTRO
                                                     │
                                          GAS Web App (doGet/doPost)
                                                     │
                                   GET (JSON) ↑   ↓ POST (cambios)
                                                     │
                                        Dashboard estático (este front)
                                          KPIs · Alertas · Trello · Modal
```

El front **solo habla con la API** (GET para leer, POST para escribir). No conoce nada de Sheets ni de la consolidación.

---

## 10. Lo que NO hay que hacer

- No implementar login ni autenticación.
- No enviar "vencido" como estado al guardar.
- No permitir soltar tarjetas en la columna VENCIDO.
- No mostrar fechas en ISO al usuario.
- No agregar frameworks pesados ni build tools complejos (es estático para GitHub Pages).
- No tocar ni depender de la estructura interna del Sheet; todo pasa por la API.
