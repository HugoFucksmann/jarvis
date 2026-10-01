import { AgentCore } from '../src/agent/AgentCore.js';
import { getSharedScheduler } from '../src/scheduler/TaskScheduler.js';
import { config } from '../src/config/index.js';

async function runSchedulerTests() {
  console.log('========================================================');
  console.log('  TEST: J.A.R.V.I.S. Phase 7 — Scheduler & Reminders    ');
  console.log('========================================================\n');

  // Test 1: AgentCore Tool Registration
  console.log('[TEST 1] Verificando registro de "manage_schedule" en AgentCore...');
  const agent = new AgentCore();
  const scheduleTool = agent.getTools().getTool('manage_schedule');

  if (!scheduleTool) {
    throw new Error('Herramienta "manage_schedule" no encontrada en ToolRegistry');
  }

  console.log('  ✔ "manage_schedule" registrada:', {
    name: scheduleTool.name,
    riskLevel: scheduleTool.riskLevel,
    permissions: scheduleTool.requiredPermissions,
  });

  // Test 2: Channel Registry & Scalability (Telegram / WhatsApp)
  console.log('\n[TEST 2] Verificando canales de notificación desacoplados...');
  const scheduler = getSharedScheduler();
  const channels = scheduler.getChannelRegistry().getAllChannels();

  const channelNames = channels.map((c) => c.name);
  console.log('  ✔ Canales registrados:', channelNames.join(', '));

  if (!channelNames.includes('windows_toast') || !channelNames.includes('voice_tts') || !channelNames.includes('hud_websocket')) {
    throw new Error('Faltan canales esenciales locales');
  }
  if (!channelNames.includes('telegram') || !channelNames.includes('whatsapp')) {
    throw new Error('Faltan canales extensibles (Telegram / WhatsApp)');
  }

  const telegramChannel = scheduler.getChannelRegistry().getChannel('telegram');
  const whatsappChannel = scheduler.getChannelRegistry().getChannel('whatsapp');
  console.log(`  ✔ Canal Telegram listo para escalar (activo: ${telegramChannel?.isEnabled()})`);
  console.log(`  ✔ Canal WhatsApp listo para escalar (activo: ${whatsappChannel?.isEnabled()})`);

  // Test 3: Reminder Creation with Relative Minutes
  console.log('\n[TEST 3] Verificando creación de recordatorio con tiempo relativo...');
  const executionContext = { workspaceRoot: config.workspaceRoot };
  const createResult = await scheduleTool.execute(
    {
      action: 'create_reminder',
      title: 'Sacar la pizza del horno',
      message: 'Pizza a 220 grados',
      delayMinutes: 20,
      priority: 'high',
    },
    executionContext
  );

  if (!createResult.success) {
    throw new Error(`Error creando recordatorio relativo: ${createResult.error}`);
  }

  const createdData = createResult.data as { reminder: { id: string; title: string; dueAt: string } };
  const reminderId = createdData.reminder.id;
  const dueTime = new Date(createdData.reminder.dueAt).getTime();
  const diffMinutes = Math.round((dueTime - Date.now()) / 60000);

  console.log(`  ✔ Recordatorio creado: "${createdData.reminder.title}" [${reminderId}]`);
  console.log(`  ✔ Tiempo calculado: aprox ${diffMinutes} minutos en el futuro`);

  if (diffMinutes < 19 || diffMinutes > 21) {
    throw new Error(`Cálculo de tiempo relativo incorrecto: ${diffMinutes} min`);
  }

  // Test 4: Listing Reminders
  console.log('\n[TEST 4] Verificando listado de recordatorios pendientes...');
  const listResult = await scheduleTool.execute({ action: 'list_reminders' }, executionContext);
  if (!listResult.success) {
    throw new Error(`Error listando recordatorios: ${listResult.error}`);
  }
  const listData = listResult.data as { count: number; pending: Array<{ id: string; title: string }> };
  console.log(`  ✔ Recordatorios pendientes encontrados: ${listData.count}`);
  const found = listData.pending.some((r) => r.id === reminderId);
  if (!found) {
    throw new Error('El recordatorio recién creado no apareció en la lista');
  }

  // Test 5: Snoozing a Reminder (+5 minutes)
  console.log('\n[TEST 5] Verificando posponer recordatorio (snooze)...');
  const snoozeResult = await scheduleTool.execute(
    { action: 'snooze_reminder', reminderId, snoozeMinutes: 10 },
    executionContext
  );
  if (!snoozeResult.success) {
    throw new Error(`Error posponiendo recordatorio: ${snoozeResult.error}`);
  }
  console.log('  ✔ Recordatorio pospuesto con éxito por 10 minutos');

  // Test 6: Completing a Reminder
  console.log('\n[TEST 6] Verificando marcar recordatorio como completado...');
  const completeResult = await scheduleTool.execute(
    { action: 'complete_reminder', reminderId },
    executionContext
  );
  if (!completeResult.success) {
    throw new Error(`Error completando recordatorio: ${completeResult.error}`);
  }
  console.log('  ✔ Recordatorio marcado como completado');

  // Test 7: Sticky Notes CRUD
  console.log('\n[TEST 7] Verificando creación y listado de notas rápidas...');
  const noteResult = await scheduleTool.execute(
    { action: 'create_note', title: 'Ideas de Stark Tower', noteContent: 'Mejorar aerodinámica de la armadura' },
    executionContext
  );
  if (!noteResult.success) {
    throw new Error(`Error creando nota: ${noteResult.error}`);
  }
  const noteData = noteResult.data as { note: { id: string; title: string } };
  console.log(`  ✔ Nota creada con éxito: "${noteData.note.title}" [${noteData.note.id}]`);

  const notesListResult = await scheduleTool.execute({ action: 'list_notes' }, executionContext);
  const notesListData = notesListResult.data as { count: number };
  console.log(`  ✔ Total de notas en sistema: ${notesListData.count}`);

  // Test 8: Proactive Watchers
  console.log('\n[TEST 8] Verificando Watchers proactivos de recursos...');
  const watchers = scheduler.listWatchers();
  console.log(`  ✔ Watchers registrados en segundo plano: ${watchers.length}`);
  watchers.forEach((w) => {
    console.log(`    - [${w.id}] ${w.name}: umbral ${w.condition} ${w.threshold}%`);
  });

  scheduler.destroy();

  console.log('\n========================================================');
  console.log('  TODOS LOS TESTS DE LA FASE 7 PASARON SATISFACTORIAMENTE ');
  console.log('========================================================\n');
  process.exit(0);
}

runSchedulerTests().catch((err) => {
  console.error('\n❌ ERROR EN EL TEST DE SCHEDULER:', err);
  process.exit(1);
});
