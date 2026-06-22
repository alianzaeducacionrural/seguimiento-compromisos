# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repo currently contains **only a spec**: `CONTEXTO_DASHBOARD.md`. No frontend code exists yet. The task is to build the static web client described in that document. Read `CONTEXTO_DASHBOARD.md` first — it is the source of truth and is written in Spanish.

## What this is

A no-login web dashboard to track *compromisos* (commitments) that advisors ("padrinos") leave during visits to rural schools of the Comité de Cafeteros de Caldas. The backend (Google Apps Script + Google Sheets) is **already built and deployed**; only the frontend client is built here.

## Stack & deployment

- Vanilla **HTML + CSS + JavaScript**. No frameworks, no build tools — it is a static site for **GitHub Pages**.
- Suggested file layout: `/index.html`, `/css/style.css`, `/js/app.js`, `/js/api.js` (backend calls), `/js/config.js` (API URL, easy to change).
- **Hard constraint: keep it lightweight.** Used in rural areas with poor connectivity. Avoid heavy dependencies and images; use system fonts. Only add a library if essential (e.g. drag & drop — prefer native HTML5 Drag and Drop API).
- No build/lint/test tooling is defined. Verify by opening `index.html` in a browser against the deployed API.

## Backend API contract (do not assume anything about the Sheet)

The API base URL (Apps Script `/exec`) lives in `config.js`.

- **GET `{API_URL}`** (no params) → `{ "ok": true, "data": [ ...compromisos ] }` or `{ "ok": false, "error": "..." }`.
- **POST `{API_URL}`** with JSON body `{ llave, estado?, observaciones? }` → `{ "ok": true, "llave": "..." }` or `{ "ok": false, "error": "..." }`. `estado` and `observaciones` are each optional; send one or both.

### CORS gotcha (critical)
POST must use `Content-Type: text/plain;charset=utf-8` (NOT `application/json`) to avoid the CORS preflight, even though the body is `JSON.stringify(...)`. The Apps Script backend `JSON.parse`s it regardless. GET has no CORS issue.

```javascript
await fetch(API_URL, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ llave, estado, observaciones })
});
```

## Domain rules that drive the UI (easy to get wrong)

- **`llave`** is the unique id of each compromiso. It is what POST sends. **Never modify it.**
- **`estadoInicial`** is the stored state: `Pendiente` | `En proceso` | `Cumplido`.
- **`estado`** is **computed by the backend** (lowercase): `pendiente` | `cumplido` | `vencido`. This decides the Trello column. `vencido` is never stored — the backend derives it by comparing `fechaVerif` to today.
- **`En proceso` case:** the API returns these as `estado = "pendiente"`. Show them in the PENDIENTE column with a visible **"En proceso" badge**, and offer "En proceso" as a selectable option in the modal.
- **State to POST is always one of `Pendiente` | `En proceso` | `Cumplido`. NEVER POST "vencido"** — it is computed, not storable.
- **Trello board has 3 columns** (PENDIENTE, CUMPLIDO, VENCIDO). Drag rules:
  - The **VENCIDO column never accepts drops** — vencido is date-driven, not chosen.
  - Dragging *from* VENCIDO to PENDIENTE/CUMPLIDO is allowed. (Moving an overdue card back to PENDIENTE is expected to reappear in VENCIDO on next reload — this is correct behavior, not a bug.)
  - On drop: POST, with **optimistic update + revert if the POST returns `ok:false`**.
- **Dates:** travel internally as ISO `aaaa-mm-dd` (used for comparisons like the "due within 7 days" calc). The user must **always** see `dd/mm/aaaa`. Use a `formatearFecha(iso)` util; handle empty string.
- **KPIs and alerts** reflect the **currently filtered** set. Filters (programa, padrino, municipio, free-text search over `compromiso`/`institucion`/`sede`/`responsable`) combine with AND. No login — a padrino just selects their name in the Padrino filter.

## State management approach

No global state framework. Keep an in-memory `compromisos` array and a `render()` that repaints based on filters. After a successful POST, update the in-memory object and re-render — do **not** re-fetch the whole GET on every edit. A top "Actualizar" button re-runs the GET on demand.

## What NOT to do

No login/auth · never POST "vencido" · no drops into the VENCIDO column · never show ISO dates to the user · no heavy frameworks or build tools · never depend on the Sheet's internal structure (everything goes through the API).
