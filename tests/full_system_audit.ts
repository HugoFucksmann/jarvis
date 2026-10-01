import fs from 'fs';
import path from 'path';
import { AgentCore } from '../src/agent/AgentCore.js';
import { ContextBuilder } from '../src/agent/contextBuilder.js';
import { config } from '../src/config/index.js';
import { getBuiltinTools } from '../src/tools/builtins/index.js';
import { getSharedVisionProvider } from '../src/tools/builtins/visionTools.js';
import { getSharedPlaywrightManager } from '../src/browser/PlaywrightManager.js';
import { getSharedScheduler } from '../src/scheduler/TaskScheduler.js';
import { getSharedSubagentManager } from '../src/subagents/SubagentManager.js';
import { parseWakeWordPhrase } from '../public/js/modules/wakeword.js';
import { MediaControlTool } from '../src/tools/builtins/mediaTools.js';

// Route factories
import { createStatusRoutes } from '../src/server/routes/statusRoutes.js';
import { createSecurityRoutes } from '../src/server/routes/securityRoutes.js';
import { createTaskRoutes } from '../src/server/routes/taskRoutes.js';
import { createMemoryRoutes } from '../src/server/routes/memoryRoutes.js';
import { createVoiceRoutes } from '../src/server/routes/voiceRoutes.js';
import { createVisionRoutes } from '../src/server/routes/visionRoutes.js';
import { createMediaRoutes } from '../src/server/routes/mediaRoutes.js';
import { createSchedulerRoutes } from '../src/server/routes/schedulerRoutes.js';
import { createSettingsRoutes } from '../src/server/routes/settingsRoutes.js';
import { createSubagentRoutes } from '../src/server/routes/subagentRoutes.js';
import { createBrowserRoutes } from '../src/server/routes/browserRoutes.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runAudit() {
  console.log('================================================================');
  console.log('       J.A.R.V.I.S. FULL SYSTEM AUDIT & INTEGRITY CHECK         ');
  console.log('================================================================\n');

  // ── AUDIT 1: Agent Core & Tool Registry ──────────────────────────────────────
  console.log('─── [AUDIT 1] Agent Core, Built-in Tools & Permissions ───────────');
  const agentCore = new AgentCore();
  const tools = agentCore.getTools();
  const registeredTools = tools.getAllTools();

  assert(registeredTools.length >= 24, `Total herramientas registradas: ${registeredTools.length} (esperado >= 24)`);

  const expectedToolNames = [
    'get_current_time', 'get_system_info',
    'list_files', 'read_file', 'write_file', 'edit_file', 'search_files', 'delete_file',
    'run_command', 'get_processes',
    'open_url', 'open_application',
    'manage_clipboard', 'control_volume', 'send_notification', 'manage_power',
    'simulate_input', 'manage_windows',
    'take_screenshot', 'analyze_image',
    'control_media',
    'manage_schedule',
    'delegate_subagent', 'list_subagents', 'get_subagent_output', 'cancel_subagent',
    'browse_web',
    'manage_memory'
  ];

  for (const name of expectedToolNames) {
    const tool = tools.getTool(name);
    assert(tool !== undefined, `Herramienta registrada: "${name}"`);
    if (tool) {
      assert(Boolean(tool.description && tool.description.length > 10), `  - Descripción válida para "${name}"`);
      assert(['LOW', 'MEDIUM', 'HIGH'].includes(tool.riskLevel), `  - RiskLevel válido para "${name}": ${tool.riskLevel}`);
    }
  }

  // ── AUDIT 2: ContextBuilder & System Prompt Directives ──────────────────────
  console.log('\n─── [AUDIT 2] System Prompt Directives & Architecture ────────────');
  const prompt = ContextBuilder.buildSystemPrompt({
    workspaceRoot: config.workspaceRoot,
    modelName: config.ollama.model,
  });

  assert(prompt.includes('J.A.R.V.I.S.'), 'System Prompt contiene identidad J.A.R.V.I.S.');
  assert(prompt.includes('Windows 11'), 'Prompt contiene arquitectura de Windows 11');
  assert(prompt.includes('1. **Actitud y Estilo**'), 'Directiva 1 presente');
  assert(prompt.includes('7. **Percepción Visual en Pantalla**'), 'Directiva 7 (Visión) presente');
  assert(prompt.includes('8. **Control Multimedia y Música'), 'Directiva 8 (Media) presente');
  assert(prompt.includes('9. **Agenda, Recordatorios y Tareas Programadas**'), 'Directiva 9 (Scheduler) presente');
  assert(prompt.includes('10. **Subagentes y Ejecución en Segundo Plano'), 'Directiva 10 (Subagentes) presente');
  assert(prompt.includes('11. **Navegación Web Autónoma (Playwright)**'), 'Directiva 11 (Playwright) presente');

  // ── AUDIT 3: Phase 3 (Vision & Screen Capture) ──────────────────────────────
  console.log('\n─── [AUDIT 3] Phase 3: Vision Provider & Offline Fallback ────────');
  const visionProvider = getSharedVisionProvider();
  assert(visionProvider.name === 'OllamaVision', 'Vision provider es OllamaVision');
  assert(visionProvider.getDevice() === 'gpu', 'Dispositivo por defecto es GPU');
  visionProvider.setDevice('cpu');
  assert(visionProvider.getDevice() === 'cpu', 'Conmutación en caliente a CPU exitosa');
  visionProvider.setDevice('gpu');
  assert(visionProvider.getDevice() === 'gpu', 'Restauración en caliente a GPU exitosa');

  // ── AUDIT 4: Phase 4 (Autonomous Browser with Playwright) ───────────────────
  console.log('\n─── [AUDIT 4] Phase 4: Autonomous Playwright Browser Engine ──────');
  const playwrightManager = getSharedPlaywrightManager();
  const browserStatus = playwrightManager.getStatus();
  assert(typeof browserStatus.isAvailable === 'boolean', 'Playwright status isAvailable reportado');
  assert(browserStatus.isActive === false, 'Navegador inactivo al inicio para no consumir RAM');
  assert(browserStatus.engine.includes('Playwright'), 'Engine reporta Playwright');

  // ── AUDIT 5: Phase 5 (Passive Wake Word Engine) ─────────────────────────────
  console.log('\n─── [AUDIT 5] Phase 5: Passive Wake Word & Keyword Parsing ───────');
  const keywords = config.wakeWord.keywords;
  assert(keywords.length >= 4, `Keywords configuradas: ${keywords.join(', ')}`);

  const wwPure = parseWakeWordPhrase('¡Hey JARVIS!');
  assert(wwPure !== null && wwPure.isOneShot === false, 'Detecta activación pura "Hey JARVIS"');

  const wwOneShot = parseWakeWordPhrase('Oye JARVIS abre la calculadora por favor');
  assert(
    wwOneShot !== null && wwOneShot.isOneShot === true && wwOneShot.command === 'abre la calculadora por favor',
    'Detecta y extrae comando One-Shot'
  );

  const wwNegative = parseWakeWordPhrase('Este es un texto común sin palabras clave');
  assert(wwNegative === null, 'Rechaza texto no coincidente');

  // ── AUDIT 6: Phase 6 (Media & Universal Music Control) ──────────────────────
  console.log('\n─── [AUDIT 6] Phase 6: Media Control & Key Transport ─────────────');
  const mediaTool = new MediaControlTool();
  const execContext = { workspaceRoot: process.cwd(), sessionId: 'audit', memory: null as any };
  
  const playPauseRes = await mediaTool.execute({ action: 'play_pause' }, execContext);
  assert(playPauseRes.success === true, 'Comando play_pause ejecutado sin error');

  const nowPlayingRes = await mediaTool.execute({ action: 'now_playing' }, execContext);
  assert(nowPlayingRes.success === true, 'Comando now_playing ejecutado sin error');

  // ── AUDIT 7: Phase 7 (Scheduler, Sticky Notes & Multi-Channel) ──────────────
  console.log('\n─── [AUDIT 7] Phase 7: Task Scheduler, Reminders & Notes ─────────');
  const scheduler = getSharedScheduler();
  const testReminder = scheduler.createReminder({
    title: 'Auditoría de Sistemas Stark',
    delayMinutes: 30,
    priority: 'high',
  });

  assert(testReminder.id.startsWith('rem_'), 'Recordatorio creado con ID válido');
  assert(testReminder.completed === false, 'Estado inicial pendiente');

  const snoozed = scheduler.snoozeReminder(testReminder.id, 15);
  assert(snoozed !== null, 'Snooze de recordatorio exitoso');

  const completed = scheduler.completeReminder(testReminder.id);
  assert(completed === true, 'Completado de recordatorio exitoso');

  const testNote = scheduler.addNote('Nota de Verificación', 'Contenido validado');
  assert(testNote.id.startsWith('note_'), 'Nota rápida creada con ID válido');
  scheduler.deleteNote(testNote.id);
  scheduler.deleteReminder(testReminder.id);

  // ── AUDIT 8: Phase 8 (Subagents & Async Background Workers) ─────────────────
  console.log('\n─── [AUDIT 8] Phase 8: Background Subagents & Notifications ──────');
  const subagentManager = getSharedSubagentManager();
  const shellTestCmd = process.platform === 'win32'
    ? 'Write-Output "Audit Worker Running"'
    : 'echo "Audit Worker Running"';

  const subagent = subagentManager.spawnSubagent({
    title: 'Auditoría de Fondo',
    taskPrompt: 'Proceso de verificación',
    type: 'shell_worker',
    command: shellTestCmd,
  });

  assert(subagent.id.startsWith('subagent_'), 'Subagente iniciado con ID');
  assert(subagent.status === 'running' || subagent.status === 'queued', 'Subagente en estado válido');

  // Await completion
  await new Promise((r) => setTimeout(r, 400));
  const subagentFinal = subagentManager.getSubagent(subagent.id);
  assert(subagentFinal?.status === 'completed', 'Subagente concluyó en completed');
  assert(
    subagentFinal?.logs.some((l) => l.includes('Audit Worker Running')) === true,
    'Subagente capturó stdout del comando'
  );

  // ── AUDIT 9: REST API Routes Registration ───────────────────────────────────
  console.log('\n─── [AUDIT 9] Express REST API Router Modules ────────────────────');
  try {
    const r1 = createStatusRoutes({ agentCore, getGpuName: () => Promise.resolve('NVIDIA RTX 3070 Ti') });
    const r2 = createSecurityRoutes(agentCore);
    const r3 = createTaskRoutes(agentCore);
    const r4 = createMemoryRoutes(agentCore);
    const r5 = createVoiceRoutes(null as any);
    const r6 = createVisionRoutes(visionProvider);
    const r7 = createMediaRoutes();
    const r8 = createSchedulerRoutes();
    const r9 = createSettingsRoutes();
    const r10 = createSubagentRoutes();
    const r11 = createBrowserRoutes();

    assert(Boolean(r1 && r2 && r3 && r4 && r5 && r6 && r7 && r8 && r9 && r10 && r11), 'Todos los 11 módulos de rutas Express instanciados correctamente');
  } catch (err: any) {
    assert(false, 'Fallo instanciando rutas Express', err.message);
  }

  // ── AUDIT 10: Frontend UI & Electron Shell Integrity ───────────────────────
  console.log('\n─── [AUDIT 10] Frontend UI Modules & Electron Shell ──────────────');
  const htmlPath = path.join(config.workspaceRoot, 'public', 'native.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  assert(htmlContent.includes('id="btn-toggle-history"'), 'Botón Historial en HUD');
  assert(htmlContent.includes('id="btn-toggle-scheduler"'), 'Botón Scheduler en HUD');
  assert(htmlContent.includes('id="btn-toggle-subagents"'), 'Botón Subagentes en HUD');
  assert(htmlContent.includes('id="btn-toggle-memory"'), 'Botón Memoria en HUD');
  assert(htmlContent.includes('id="btn-toggle-security"'), 'Botón Seguridad en HUD');
  assert(htmlContent.includes('id="scheduler-drawer"'), 'Drawer Scheduler en HUD');
  assert(htmlContent.includes('id="subagents-drawer"'), 'Drawer Subagentes en HUD');

  const requiredModules = [
    'approvals.js', 'history.js', 'markdown.js', 'memory.js', 'scheduler.js',
    'security.js', 'state.js', 'subagents.js', 'tts.js', 'ui.js', 'voice.js',
    'wakeword.js', 'ws.js'
  ];

  for (const mod of requiredModules) {
    const modPath = path.join(config.workspaceRoot, 'public', 'js', 'modules', mod);
    assert(fs.existsSync(modPath), `Módulo frontend presente: "${mod}"`);
  }

  const electronMain = path.join(config.workspaceRoot, 'src', 'desktop', 'main.cjs');
  const electronPreload = path.join(config.workspaceRoot, 'src', 'desktop', 'preload.cjs');
  assert(fs.existsSync(electronMain), 'Desktop main.cjs de Electron presente');
  assert(fs.existsSync(electronPreload), 'Desktop preload.cjs de Electron presente');

  scheduler.destroy();

  console.log('\n================================================================');
  console.log(`  AUDITORÍA FINALIZADA: ${passed} PASADOS | ${failed} FALLADOS`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
