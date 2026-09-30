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

## 📌 Fase 3: Percepción Visual y Captura de Pantalla
- [ ] **Captura de Pantalla (`take_screenshot`):**
  - [ ] Captura de monitor principal o de ventana activa.
  - [ ] Guardado temporal optimizado para análisis multimodal.
- [ ] **Integración con Visión Local (Ollama VL):**
  - [ ] Soporte para modelos multimodales locales (`qwen2.5-vl`, `llava`) para analizar la pantalla.
  - [ ] Identificación visual de elementos, errores o estados en pantalla.

---

## 📌 Fase 4: Navegación Web Autónoma (Headless Browser / Playwright)
- [ ] **Navegador Automatizado:**
  - [ ] Integración con Playwright en segundo plano.
  - [ ] Capacidad de navegar páginas interactivas, rellenar formularios y hacer clics en enlaces.
  - [ ] Extracción y sintetización profunda de artículos, documentación y páginas web.

---

## 📌 Fase 5: Detección de Voz Pasiva (*Wake Word*)
- [ ] **Activación "Hey JARVIS":**
  - [ ] Motor local de wake word ultra liviano corriendo en segundo plano sin consumo de GPU.
  - [ ] Apertura y escucha automática de la barra HUD al escuchar la palabra de activación.
  - [ ] Cierre automático tras responder si el usuario no continúa la interacción.

---

## 📌 Fase 6: Control Multimedia y Música
- [ ] **Control de Medios de Windows:**
  - [ ] Play, Pausa, Siguiente tema, Tema anterior a través de teclas multimedia del sistema.
  - [ ] Integración con Spotify / YouTube para buscar y reproducir pistas.

---

## 📌 Fase 7: Tareas Programadas y Recordatorios (Scheduler)
- [ ] **Temporizadores y Recordatorios:**
  - [ ] Programación de avisos en lenguaje natural ("en 20 minutos recuérdame X").
  - [ ] Tareas recurrentes o a horario fijo.
- [ ] **Watchers Proactivos:**
  - [ ] Monitoreo de recursos (temperatura de GPU/CPU, disco libre) con alertas proactivas por voz.

---

## 📌 Fase 8: Subagentes y Ejecución en Segundo Plano
- [ ] Tareas asíncronas no bloqueantes delegadas a procesos background.
- [ ] Notificación por voz o Toast al completarse una tarea de fondo sin bloquear el HUD.
