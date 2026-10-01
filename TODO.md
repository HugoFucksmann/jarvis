# J.A.R.V.I.S. — Next Roadmap

Roadmap de nuevas capacidades para extender JARVIS más allá del control local del sistema.

---

## 📬 Fase 9: Email — Leer y Enviar (Gmail / IMAP)

- [ ] **Tool `read_email`:**
  - [ ] Conectar vía IMAP (Gmail OAuth2 o contraseña de app).
  - [ ] Listar bandeja de entrada con filtros (no leídos, remitente, asunto).
  - [ ] Leer contenido completo de un email por ID.
- [ ] **Tool `send_email`:**
  - [ ] Enviar mails con asunto, destinatario y cuerpo.
  - [ ] Soporte para responder a un thread existente.
- [ ] **UI:** Widget en panel `Device` o nuevo panel `Comunicaciones`.
- [ ] **Credenciales:** Guardadas en `.jarvis/credentials.json`, nunca en el prompt.

---

## 📅 Fase 10: Calendario — Google Calendar / Outlook

- [ ] **Tool `manage_calendar`:**
  - [ ] Leer eventos del día / semana.
  - [ ] Crear evento con título, hora, duración y descripción.
  - [ ] Eliminar o editar evento por ID.
- [ ] **Integración con Scheduler (Fase 7):** al crear un recordatorio en JARVIS, opcionalmente sincronizarlo con Google Calendar.
- [ ] **UI:** Panel lateral o drawer `📅 Agenda` con vista de hoy y mañana.

---

## 🌐 Fase 11: `fetch_url_content` — Scraping Rápido sin Playwright

- [ ] **Tool `fetch_url_content`:**
  - [ ] GET simple de cualquier URL pública (sin JS rendering).
  - [ ] Convertir HTML a markdown limpio para el contexto del LLM.
  - [ ] Soporte para endpoints JSON / RSS feeds.
- [ ] **Casos de uso:** leer documentación, obtener precios, monitorear RSS, leer APIs públicas.
- [ ] Fallback a `browse_web` (Playwright) si la página requiere JS.

---

## 📁 Fase 12: `monitor_directory` — Watcher de Carpetas

- [ ] **Tool `monitor_directory`:**
  - [ ] Registrar un watcher sobre una ruta específica.
  - [ ] Notificar vía Toast / TTS / WebSocket cuando aparece un archivo nuevo o uno cambia.
  - [ ] Listar watchers activos y permitir cancelarlos.
- [ ] **Casos de uso:** detectar nuevas descargas, monitorear builds, alertar si se modifica un archivo crítico.
- [ ] **Integración:** usar la infra de `SubagentManager` + `ChannelRegistry` ya existente.

---

## 💬 Fase 13: Notificaciones Externas — Telegram / WhatsApp

- [ ] **Telegram Bot:**
  - [ ] Enviar mensajes a un chat configurado.
  - [ ] Recibir comandos desde Telegram y ejecutarlos en JARVIS.
  - [ ] Soporte para imágenes (screenshots de pantalla).
- [ ] **WhatsApp (via Baileys o WA Business API):**
  - [ ] Enviar mensajes de texto a contactos.
  - [ ] (Futuro) Recibir mensajes entrantes como input al agente.
- [ ] **Integración:** `ChannelRegistry` ya tiene los slots `telegram` y `whatsapp` preparados — solo implementar los providers.
- [ ] **UI:** Toggle en panel de Seguridad para activar/desactivar canales externos.

---

## 📬 Fase 14: `manage_contacts` — Gestión de Contactos

- [ ] **Tool `manage_contacts`:**
  - [ ] Leer contactos de Google Contacts o vCard local.
  - [ ] Buscar por nombre o email.
  - [ ] Exportar / importar contactos.
- [ ] **Integración con Email y Calendar:** autocompletar destinatarios al redactar mails.

---

## 🔧 Mejoras Técnicas Pendientes

- [ ] **Autenticación OAuth2 centralizada:** módulo `src/auth/OAuthManager.ts` compartido por Email, Calendar y Contacts.
- [ ] **Panel `Comunicaciones` en la web UI:** nuevo card junto a Chat, Sistema, Memoria y Seguridad.
- [ ] **Cifrado de credenciales** en `.jarvis/credentials.json` con clave derivada del usuario.
- [ ] **Tests de integración** para cada nueva fase (patrón `tests/phase_N_test.ts`).
