# J.A.R.V.I.S. // Local Autonomous AI Agent

Asistente de inteligencia artificial local, modular, extensible y con ejecución autónoma de tareas, inspirado en **JARVIS de Iron Man** y potenciado principalmente por modelos locales ejecutándose mediante **Ollama** (modelo por defecto detectado y configurado: `qwen3.5:9b`).

---

## 1. Características Principales

* **Cerebro 100% Local**: No requiere APIs externas de OpenAI, Anthropic ni Gemini. La inferencia corre en tu propia máquina mediante Ollama.
* **Arquitectura Desacoplada (`LLMProvider`)**: Capa de abstracción que aísla el Core Agent del motor de inferencia. Permite conmutar modelos en caliente sin reiniciar el sistema.
* **Ciclo Agéntico Autónomo (`AgentLoop`)**: *Comprender → Planificar → Seleccionar Herramienta → Autorizar → Ejecutar → Observar Resultado → Razonar → Verificar → Respuesta Final*.
* **Capa de Autorización Independiente (`PermissionManager`)**: El LLM no tiene acceso directo al sistema operativo. Todas las acciones se rigen por políticas de riesgo:
  * `LOW`: Lectura de archivos, fecha/hora, listado de procesos, telemetría de hardware (auto-aprobado).
  * `MEDIUM`: Creación/modificación de archivos, comandos no destructivos, apertura de URLs y apps.
  * `HIGH`: Borrado de archivos, comandos potencialmente destructivos o modificaciones de sistema. Bloquean la ejecución y solicitan confirmación manual e interactiva al usuario en la UI antes de proceder.
* **Registro de Auditoría Estructurado**: Registro inmutable de cada herramienta ejecutada, parámetros, modo de aprobación y resultado en `.jarvis/logs/audit.jsonl`.
* **Memoria Dual (Short-Term & Long-Term)**:
  * *Short-Term*: Buffer conversacional por sesión con poda de tokens.
  * *Long-Term*: Hechos persistentes guardados en `.jarvis/memory/facts.json`, con saneamiento automático contra guardado de credenciales y preparado para RAG vectorial.
* **Interfaces Modales Preparadas**: Abstracciones para Voz (`SpeechToText`, `TextToSpeech`, `WakeWord`) y Visión (`VisionProvider`, screenshots) para integración futura sin modificar el Core.
* **HUD Web Futurista (Stark Industries)**: Interfaz oscura con estética holográfica (cian neón, glow reactivo, Arc Reactor animado, streaming en tiempo real de tokens, visualización interactiva de herramientas en ejecución, modal de autorización y telemetría de hardware).

---

## 2. Estructura del Proyecto

```text
rocco/
├── src/
│   ├── agent/                 # Núcleo del agente y ciclo de razonamiento
│   │   ├── AgentCore.ts       # Orquestador principal
│   │   ├── AgentLoop.ts       # Ciclo iterativo, detección de loops, timeouts
│   │   ├── contextBuilder.ts  # Generador dinámico de prompts con telemetría y memoria
│   │   └── types.ts           # Estados y eventos (streaming, herramientas, aprobaciones)
│   ├── llm/                   # Abstracción desacoplada de modelos
│   │   ├── types.ts           # Interfaces LLMProvider, ChatMessage, ToolDefinition
│   │   ├── OllamaProvider.ts  # Driver nativo de Ollama con streaming y tool calling
│   │   └── LLMProvider.ts     # Re-exportador
│   ├── tools/                 # Sistema de herramientas extensible
│   │   ├── types.ts           # ITool, RiskLevel (LOW, MEDIUM, HIGH), ToolResult
│   │   ├── Tool.ts            # Clase base abstracta BaseTool
│   │   ├── ToolRegistry.ts    # Registro, validación y ejecución de herramientas
│   │   ├── security/
│   │   │   └── PermissionManager.ts # Control de acceso, escalado dinámico y auditoría
│   │   └── builtins/          # Herramientas del sistema
│   │       ├── systemTools.ts     # get_current_time, get_system_info
│   │       ├── fileTools.ts       # list_files, read_file, write_file, edit_file, search_files, delete_file
│   │       ├── terminalTools.ts   # run_command (PowerShell seguro), get_processes
│   │       ├── browserTools.ts    # open_url, open_application
│   │       └── webSearchTools.ts  # web_search (búsqueda web DuckDuckGo)
│   ├── memory/                # Sistema de memoria
│   │   ├── types.ts           # Interfaces IMemoryStore, MemoryFact
│   │   ├── ShortTermMemory.ts # Buffer de sesión en memoria
│   │   ├── LongTermMemory.ts  # Persistencia en disco (.jarvis/memory/facts.json)
│   │   └── MemoryStore.ts     # Fachada unificada
│   ├── modalities/            # Interfaces abstractas para voz y visión
│   │   ├── SpeechInterface.ts # STT, TTS, WakeWord
│   │   └── VisionInterface.ts # Multimodal, screenshots, cámara
│   ├── logger/                # Observabilidad y registro de eventos
│   │   └── Logger.ts          # Logs estructurados por componente y niveles
│   ├── config/                # Configuración centralizada (.env)
│   │   └── index.ts
│   └── server/                # Servidor HTTP y WebSockets
│       └── index.ts
├── public/                    # Frontend JARVIS HUD
│   ├── index.html             # Interfaz web holográfica
│   ├── css/
│   │   └── jarvis.css         # Estilos futuristas Stark HUD, glassmorphism, animaciones
│   └── js/
│       └── app.js             # Conexión WebSocket, streaming, autorizaciones en vivo
├── tests/                     # Tests de integración
│   ├── agent_test.ts          # Test del ciclo agéntico y herramientas
│   └── ws_test.ts             # Test de streaming por WebSocket
├── .env                       # Configuración activa
├── .env.example               # Plantilla de configuración
├── package.json
└── tsconfig.json
```

---

## 3. Requisitos y Detección del Sistema

El agente fue configurado y verificado con las siguientes herramientas detectadas en tu equipo:

* **Sistema Operativo**: Windows 11 Pro (NT 10.0.26200) x64
* **GPU**: NVIDIA GeForce RTX 3070 Ti (8 GB VRAM)
* **RAM**: 32 GB
* **Node.js**: v24.12.0 (npm 11.6.2)
* **Ollama**: v0.32.14 ejecutándose en `http://127.0.0.1:11434`
* **Modelo Activo**: `qwen3.5:9b` (Q4_K_M, tamaño 6.6 GB, con soporte nativo de *tools*, *thinking*, *vision* y 262K context window).

## 4. Comandos de Inicio y Uso

### Iniciar la Aplicación Nativa de Escritorio (Spotlight HUD)
```powershell
npm run desktop
```
* **Atajo Global de Windows**: Presiona **`Alt + Espacio`** en cualquier momento y desde cualquier aplicación para desplegar u ocultar a JARVIS.
* **Tecla de escape**: Presiona **`Esc`** para ocultar la ventana al instante.
* **Bandeja del Sistema (Tray)**: Permite controlar a JARVIS discretamente en segundo plano.

### Iniciar el Servidor Backend (Web)
```powershell
npm run dev
```
El servidor iniciará en: **`http://127.0.0.1:3000`**

### Abrir la Interfaz de JARVIS
Abre tu navegador en:
```text
http://127.0.0.1:3000
```

### Ejecutar Tests de Integración
* Para probar el ciclo agéntico y las herramientas locales:
  ```powershell
  npx tsx tests/agent_test.ts
  ```
* Para probar la comunicación WebSocket y streaming:
  ```powershell
  npx tsx tests/ws_test.ts
  ```

### Compilar para Producción
```powershell
npm run build
npm start
```

---

## 5. Configuración Centralizada (`.env`)

Todas las opciones de JARVIS están centralizadas en el archivo `.env`:

```env
# Ollama Local LLM Settings
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_TEMPERATURE=0.3

# Server Settings
PORT=3000
HOST=127.0.0.1

# Agent Execution Limits
AGENT_MAX_ITERATIONS=15
AGENT_TIMEOUT_SECONDS=180

# Feature Flags
MEMORY_ENABLED=true
WEB_SEARCH_ENABLED=true
VOICE_ENABLED=true
VOICE_MODEL=frozenlab/qwen3-asr:0.6b
VOICE_DEVICE=cpu
VISION_ENABLED=false

# Security & Permissions
AUTO_APPROVE_LOW_RISK=true
AUTO_APPROVE_MEDIUM_RISK=false
AUTO_APPROVE_HIGH_RISK=false

# Workspace Root
WORKSPACE_ROOT=e:/colo/rocco
```

---

## 6. Módulo de Voz: `frozenlab/qwen3-asr:0.6b` y Análisis de Rendimiento

El sistema incluye integración completa con el modelo de reconocimiento de voz **`frozenlab/qwen3-asr:0.6b`** (Speech-to-Text local en Ollama).

### ¿CPU o GPU? Análisis de Rendimiento Técnico

* **Hardware**: GPU NVIDIA GeForce RTX 3070 Ti (8 GB VRAM) + CPU Intel Core i7-12700F (12 núcleos / 20 hilos).
* **Consumo de VRAM**:
  * Modelo principal `qwen3.5:9b`: Ocupa entre **6.6 GB y 7.5 GB** de VRAM con el contexto activo.
  * Modelo de voz `qwen3-asr:0.6b`: Ocupa **~1.0 GB** de VRAM.
* **Problema de correr ambos en GPU (8 GB VRAM)**:
  * Si ambos se fuerzan a la GPU, se supera el límite de los 8 GB de la RTX 3070 Ti. Esto fuerza a Ollama a hacer **Model Swapping** (descarga el modelo de 9B para subir el de voz, y luego descarga el de voz para volver a cargar 6.6 GB del modelo de 9B). Este proceso introduce entre **1.5 y 3 segundos de latencia** en cada interacción hablada.
* **Ventaja de correr el modelo de voz en CPU (`options: { num_gpu: 0 }`)**:
  * Al tener solo 0.6B de parámetros, el procesador Intel Core i7-12700F transcribe el audio en **menos de 200 ms**.
  * Deja los **8 GB de la GPU 100% dedicados al modelo de 9B**, permitiendo que ambos corran en **verdadero paralelo** sin latencia de swapping.
* **Selector en Vivo en la UI**:
  * Puedes alternar entre **CPU (Recomendado)** y **GPU (RTX 3070 Ti)** en cualquier momento desde el selector `VOICE (qwen3-asr)` en la barra superior del HUD sin reiniciar el servidor.

---

## 7. Cómo Cambiar el Modelo de Ollama

El sistema es agnóstico al modelo. Puedes cambiar de modelo de tres formas distintas:

1. **Desde la Interfaz Web (en caliente)**:
   * En la barra superior del HUD, despliega el selector **NEURAL ENGINE**.
   * JARVIS detectará automáticamente los modelos que tengas instalados en Ollama y cambiará el modelo activo al instante sin reiniciar el servidor.

2. **Mediante la API REST**:
   ```powershell
   Invoke-RestMethod -Uri http://127.0.0.1:3000/api/models/select -Method Post -Body '{"model": "otro_modelo"}' -ContentType 'application/json'
   ```

3. **Mediante el archivo `.env`**:
   * Cambia la variable `OLLAMA_MODEL=nombre_de_tu_modelo` y reinicia el proceso.

---

## 7. Herramientas Implementadas y Matriz de Riesgo

| Herramienta | Descripción | Nivel de Riesgo | Política |
|-------------|-------------|-----------------|----------|
| `get_current_time` | Fecha, hora actual, timestamp y zona horaria | `LOW` | Auto-aprobado |
| `get_system_info` | CPU, RAM, GPU, OS, hostname y espacio | `LOW` | Auto-aprobado |
| `list_files` | Listar archivos y carpetas del workspace | `LOW` | Auto-aprobado |
| `read_file` | Leer archivos de texto (con límite seguro) | `LOW` | Auto-aprobado |
| `search_files` | Buscar archivos por coincidencia o extensión | `LOW` | Auto-aprobado |
| `get_processes` | Inspeccionar procesos activos en el sistema | `LOW` | Auto-aprobado |
| `web_search` | Búsqueda web abierta (DuckDuckGo) | `LOW` | Auto-aprobado |
| `write_file` | Crear o sobrescribir archivos | `MEDIUM` | Requiere aprobación o flag |
| `edit_file` | Reemplazo selectivo de texto en archivos | `MEDIUM` | Requiere aprobación o flag |
| `run_command` | Ejecutar comandos en terminal (PowerShell) | `MEDIUM` / `HIGH` | Auto-escalado si es destructivo |
| `open_url` | Abrir URL en navegador del sistema | `MEDIUM` | Requiere aprobación o flag |
| `open_application` | Abrir programas instalados (ej: calc, notepad) | `MEDIUM` | Requiere aprobación o flag |
| `delete_file` | Eliminar archivos permanentemente | `HIGH` | **Requiere siempre confirmación manual en UI** |

---

## 8. Limitaciones Actuales y Próximos Pasos

### Limitaciones Actuales del MVP:
1. **Entrada/Salida por Voz**: Las interfaces de arquitectura (`SpeechToText`, `TextToSpeech`, `WakeWord`) están diseñadas y tipadas, pero operan actualmente en modo texto por defecto.
2. **Visión por Pantalla**: La interfaz `VisionProvider` está definida; el modelo `qwen3.5:9b` soporta visión nativamente, pero requiere acoplar la captura de pantalla (`desktop-screenshot` o `screencapture`).
3. **Embeddings Vectoriales**: La memoria a largo plazo opera mediante almacenamiento estructurado y búsqueda por relevancia léxica. La interfaz `searchSimilar` está lista para conectar ChromaDB, Qdrant o `nomic-embed-text` de Ollama.

### Próximos Pasos Recomendados:
1. **Activar Whisper Local (STT) y Piper/Edge-TTS**: Implementar la interfaz `SpeechInterface.ts` con modelos locales de voz para hablarle a JARVIS y escuchar sus respuestas con acento británico o en español.
2. **Wake Word "Hey Jarvis"**: Integrar Porcupine o OpenWakeWord para activación continua por micrófono.
3. **Visión Automática del Escritorio**: Implementar captura de pantalla en `VisionInterface.ts` para que JARVIS pueda analizar lo que tienes en pantalla cuando pidas *"Revisa este error que tengo en pantalla"*.
4. **Vector Store Local (RAG)**: Integrar embeddings usando `ollama pull nomic-embed-text` para memoria semántica ilimitada sobre tus proyectos.
