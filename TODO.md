# J.A.R.V.I.S. Roadmap & TODO

Este documento define la hoja de ruta para dotar a JARVIS de control total y autónomo sobre el sistema operativo, automatización de interfaz gráfica, percepción visual y capacidades proactivas.

---

## 📌 Fase 1: Control del Sistema, Portapapeles y Hardware (✅ Completado)
- [x] **Portapapeles (`manage_clipboard`):**
  - [x] Leer contenido actual del portapapeles (`action: "get"`).
  - [x] Copiar textos, snippets o enlaces al portapapeles (`action: "set"`).
  - [x] Vaciar portapapeles (`action: "clear"`).
- [x] **Control de Volumen del Sistema (`control_volume`):**
  - [x] Subir y bajar volumen por pasos porcentuales (`action: "up" | "down"`).
  - [x] Silenciar / desilenciar el audio de Windows (`action: "mute" | "unmute"`).
- [x] **Notificaciones Nativas (`send_notification`):**
  - [x] Enviar notificaciones Toast nativas en Windows con título, mensaje y sonido del sistema.
- [x] **Control de Energía y Sesión (`manage_power`):**
  - [x] Bloquear estación de trabajo (`action: "lock"`).
  - [x] Suspender equipo (`action: "sleep"` - evaluación de riesgo HIGH con confirmación).
  - [x] Reiniciar equipo con gracia de tiempo (`action: "restart"` - riesgo HIGH con confirmación).
  - [x] Apagar equipo con gracia de tiempo (`action: "shutdown"` - riesgo HIGH con confirmación).

---

## 📌 Fase 2: Automatización de GUI y Control de Ventanas (✅ Completado)
- [x] **Control de Mouse y Teclado (`simulate_input`):**
  - [x] Clics del mouse: izquierdo, derecho, doble clic, en coordenadas X/Y o en posición actual (`action: "click"`).
  - [x] Desplazamiento de cursor de mouse a coordenadas (`action: "move_mouse"`).
  - [x] Escritura simulada de texto dentro de la aplicación activa (`action: "type_text"` con escape de caracteres especiales).
  - [x] Pulsación de atajos de teclado y teclas especiales (`action: "press_key"`: `enter`, `esc`, `tab`, `ctrl+s`, `ctrl+c`, `ctrl+v`, `alt+f4`, `alt+tab`, flechas, etc.).
- [x] **Gestión de Ventanas de Windows (`manage_windows`):**
  - [x] Listar ventanas activas visibles en el escritorio con proceso y título (`action: "list"`).
  - [x] Traer ventana específica al frente por nombre o título (`action: "focus"`).
  - [x] Minimizar, maximizar y restaurar ventanas (`action: "minimize" | "maximize" | "restore"`).
  - [x] Cerrar ventanas de forma limpia (`action: "close"`).

---

## 📌 Fase 3: Percepción Visual y Captura de Pantalla (✅ Completado)
- [x] **Captura de Pantalla (`take_screenshot`):**
  - [x] Captura de monitor principal completo (`target: "screen"`).
  - [x] Captura de ventana activa en primer plano (`target: "active_window"` con resolución automática de HWND y RECT).
  - [x] Guardado temporal optimizado en `.jarvis/screenshots/` con rotación automática (máx 25 archivos) y downscaling inteligente (`maxWidth: 1920px`) para optimizar el context window de visión.
  - [x] Argumento opcional `analyzePrompt`: permite capturar y recibir el análisis multimodal en una sola operación atómica.
- [x] **Integración con Visión Local (Ollama VL - `analyze_image` y `OllamaVisionProvider`):**
  - [x] Soporte para modelos multimodales locales (`qwen2.5-vl`, `qwen3.5`, `llava`, `llama3.2-vision`) vía API `/api/chat` de Ollama con imágenes Base64.
  - [x] Herramienta `analyze_image`: inspección detallada de cualquier archivo de imagen (PNG, JPG, WEBP) respondiendo preguntas sobre diagramas, errores o mockups.
  - [x] Conmutación dinámica de hardware de cómputo en caliente (`VISION_DEVICE=gpu | cpu`).
  - [x] Endpoints REST dedicados en `/api/vision` (`/status`, `/device`, `/model`, `/screenshot`, `/analyze`).
  - [x] Directivas integradas en el System Prompt de JARVIS para activar percepción visual autónoma ante consultas del usuario.

---

## 📌 Fase 4: Navegación Web Autónoma (Headless Browser / Playwright) (✅ Completado)
- [x] **Motor de Navegación Autónoma (`PlaywrightManager`):**
  - [x] Integración con Chromium headless y soporte para canales de sistema (`chrome`, `msedge` en Windows 11) sin bloquear ventanas en el escritorio.
  - [x] Resiliencia de red y extracción inteligente con fallback HTTP robusto para garantizar lecturas sin interrupciones.
  - [x] Gestión automática de memoria y ciclo de vida (cierre automático tras 10 minutos de inactividad).
- [x] **Acciones Interactivas y Extracción (`browse_web`):**
  - [x] Extracción profunda de contenido limpio sin ruido publicitario ni etiquetas residuales (`action: "extract"`).
  - [x] Clics en enlaces y botones mediante selectores CSS (`action: "click"`).
  - [x] Relleno de campos de texto y búsqueda en formularios (`action: "fill"`).
  - [x] Envío de pulsaciones de teclado como Enter o Tab (`action: "press"`).
  - [x] Capturas de pantalla web a disco para análisis visual multimodal con Ollama VL (`action: "screenshot"`).
  - [x] Ejecución y evaluación de scripts JavaScript en el contexto de la página (`action: "evaluate"`).
- [x] **Endpoints REST y Directivas del Asistente:**
  - [x] Rutas dedicadas en `/api/browser` (`/status`, `/navigate`, `/extract`, `/click`, `/close`).
  - [x] Directiva 11 en el System Prompt diferenciando `open_url` (para el usuario) de `browse_web` (para que JARVIS investigue y sintetice de fondo).

---

## 📌 Fase 5: Detección de Voz Pasiva (*Wake Word*) (✅ Completado)
- [x] **Activación "Hey JARVIS":**
  - [x] Motor local de wake word ultra liviano en segundo plano sin consumo de GPU ni competencia de VRAM (`public/js/modules/wakeword.js`).
  - [x] Reconocimiento continuo con normalización y priorización por longitud de frases compuestas (`"hey jarvis"`, `"jarvis"`, `"oye jarvis"`, `"hola jarvis"`).
  - [x] Soporte para comandos de voz directos en una sola frase (*One-Shot Voice Commands*, ej: *"Hey JARVIS ¿qué hora es?"*).
  - [x] Apertura, restauración y foco automático de la ventana HUD de Electron ante la palabra de activación (`ipcRenderer.send('jarvis:show')`).
  - [x] Feedback auditivo Stark sintetizado con Web Audio API (chime armónico de reactor 880Hz -> 1320Hz) y halo reactivo visual.
  - [x] Auto-Dismiss inteligente: tras completar la respuesta, si transcurren 12s de inactividad, el HUD se oculta automáticamente.
  - [x] Botón toggle con indicador de onda pulsante en el HUD nativo y dashboard web.
  - [x] Endpoints REST en `/api/voice/wakeword` (`GET` estado/configuración y `POST` toggle).

---

## 📌 Fase 6: Control Multimedia y Música (✅ Completado)
- [x] **Control de Medios Universal (`control_media`):**
  - [x] Controles de transporte universal de Windows (`play_pause`, `next`, `previous`, `stop`) mediante Virtual Keys (`VK_MEDIA_*`) de WScript.Shell (compatible con Spotify, YouTube en Chrome/Edge, VLC, etc.).
  - [x] Integración con Spotify (`action: "play_spotify"`): búsqueda y apertura mediante URI nativo de Windows (`spotify:search:...`) con fallback automático a reproductor web (`https://open.spotify.com/search/...`).
  - [x] Integración con YouTube / YouTube Music (`action: "play_youtube"`): búsqueda y reproducción instantánea en navegador (`service: "youtube" | "youtube_music"`).
  - [x] Detección inteligente de pista actual (`action: "now_playing"`): inspecciona títulos de ventana de Spotify y pestañas de YouTube en navegadores para responder qué artista y canción están sonando.
  - [x] Endpoints REST dedicados en `/api/media` (`/now-playing`, `/control`, `/spotify`, `/youtube`).
  - [x] Directivas en el System Prompt para control autónomo por voz o texto ("pon música de X", "pausa", "¿qué tema es este?").

---

## 📌 Fase 7: Tareas Programadas, Recordatorios y Notas (Scheduler) (✅ Completado)
- [x] **Temporizadores y Recordatorios en Lenguaje Natural (`manage_schedule`):**
  - [x] Programación de avisos con cálculo automático de horario relativo (*"en 20 minutos"*, *"en 2 horas"*) o fijo (*"a las 16:30"*).
  - [x] Gestión completa del ciclo de vida: creación, listado, postergación (*snooze* de 5 a 60 min), completado y cancelación.
- [x] **Notas Rápidas Integradas (*Sticky Notes*):**
  - [x] Creación, listado y eliminación de notas rápidas contextuales asociadas al asistente.
  - [x] Persistencia atómica y resiliente en archivo local `.jarvis/reminders.json`.
- [x] **Arquitectura Multi-Canal Extensible (`ChannelRegistry`):**
  - [x] Dispatcher asíncrono desacoplado capaz de emitir avisos en paralelo por múltiples vías.
  - [x] Notificaciones Nativas de Windows Toast vía PowerShell / WinRT.
  - [x] Canal WebSocket en tiempo real hacia todos los clientes HUD y web conectados.
  - [x] Canal de Síntesis de Voz (TTS) proactivo para avisar auditivamente al usuario.
  - [x] Canales preparados y desacoplados para escalabilidad futura: `TelegramNotificationChannel` y `WhatsAppNotificationChannel`.
- [x] **Watchers Proactivos del Sistema:**
  - [x] Monitor de recursos en segundo plano (evaluación de umbrales críticos de memoria RAM y salud del sistema cada 30 segundos).
  - [x] Prevención de fatiga de alertas (*cooldown anti-spam* de 15 minutos entre avisos del mismo watcher).
- [x] **Interfaz HUD y REST:**
  - [x] Drawer deslizable de estilo Stark Tech en el HUD (`#scheduler-drawer`) con pestañas para Recordatorios y Notas Rápidas.
  - [x] Endpoints REST en `/api/scheduler` (`/reminders`, `/notes`, `/stats`).
  - [x] Directivas en el System Prompt para gestión autónoma por voz o chat de recordatorios y notas.

---

## 📌 Fase 8: Subagentes y Ejecución en Segundo Plano (✅ Completado)
- [x] **Gestor Central de Subagentes (`SubagentManager`):**
  - [x] Ejecución asíncrona no bloqueante de tareas delegadas (`spawnSubagent`) sin congelar la ventana del HUD ni el loop principal.
  - [x] Control de concurrencia y cola de espera (máximo 3 subagentes simultáneos para no saturar memoria ni recursos de cómputo).
  - [x] Soporte para dos tipos de subagentes:
    - `shell_worker`: Procesos de terminal desacoplados (compilaciones, scripts, descargas, monitoreos) con streaming en vivo de stdout/stderr.
    - `llm_worker`: Subagentes cognitivos autónomos con acceso a herramientas para razonamiento y resolución de objetivos complejos de fondo.
  - [x] Soporte de cancelación inmediata bajo demanda (`cancelSubagent` con `AbortController` y terminación limpia de procesos hijos).
- [x] **Notificación Proactiva Multi-Canal al Finalizar:**
  - [x] Integración con `ChannelRegistry` de la Fase 7 para despacho simultáneo en múltiples vías:
    - Anuncio por voz natural (`VoiceTTSChannel`): *"Señor, el subagente X ha finalizado: [resumen]"*.
    - Notificaciones nativas de Windows Toast (`WindowsToastChannel`).
    - Emisión de telemetría y eventos en tiempo real hacia los HUDs conectados vía WebSockets (`HudWebSocketChannel`).
- [x] **Herramientas de Agente (`src/tools/builtins/subagentTools.ts`):**
  - [x] `delegate_subagent`: delega una tarea al background y retorna de inmediato con el ID del subagente y confirmación.
  - [x] `list_subagents`: lista subagentes activos, en cola, completados o fallidos con métricas de tiempo transcurrido.
  - [x] `get_subagent_output`: recupera logs detallados de terminal o el resultado generado por un subagente.
  - [x] `cancel_subagent`: aborta un subagente en ejecución.
- [x] **Interfaz HUD y API REST:**
  - [x] Panel drawer deslizante `#subagents-drawer` con tarjetas de subagente, estados en color Stark (`RUNNING`, `QUEUED`, `COMPLETED`, `FAILED`, `CANCELLED`), fragmento de logs y botón de cancelación rápida.
  - [x] Indicador badge numérico reactivo en el header del HUD con conteo de subagentes activos.
  - [x] Endpoints REST en `/api/subagents` (`/`, `/:id`, `/delegate`, `/:id/cancel`).
  - [x] Directiva 10 en el System Prompt instruyendo a JARVIS a usar `delegate_subagent` ante tareas pesadas o comandos "en segundo plano".
