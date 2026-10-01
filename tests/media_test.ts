import { AgentCore } from '../src/agent/AgentCore.js';
import { MediaControlTool } from '../src/tools/builtins/mediaTools.js';
import { config } from '../src/config/index.js';

async function runMediaTests() {
  console.log('========================================================');
  console.log('  TEST: J.A.R.V.I.S. Phase 6 — Media & Music Control    ');
  console.log('========================================================\n');

  // Test 1: Tool Registry Registration in AgentCore
  console.log('[TEST 1] Verificando registro de "control_media" en AgentCore...');
  const agent = new AgentCore();
  const mediaTool = agent.getTools().getTool('control_media');

  if (!mediaTool) {
    throw new Error('Herramienta "control_media" no encontrada en ToolRegistry');
  }

  console.log('  ✔ "control_media" registrada con éxito:', {
    name: mediaTool.name,
    riskLevel: mediaTool.riskLevel,
    permissions: mediaTool.requiredPermissions,
  });

  // Test 2: Function Definition for LLM Tool Calling
  console.log('\n[TEST 2] Verificando esquema de Tool Calling para Ollama...');
  const def = mediaTool.toDefinition();
  if (def.type !== 'function' || def.function.name !== 'control_media') {
    throw new Error('Definición de función inválida para control_media');
  }

  const actions = (def.function.parameters.properties.action as { enum: string[] }).enum;
  console.log('  ✔ Acciones soportadas por el LLM:', actions.join(', '));
  console.log('  ✔ Parámetros aceptados:', Object.keys(def.function.parameters.properties).join(', '));

  // Test 3: Validation of required arguments
  console.log('\n[TEST 3] Verificando validaciones de entrada...');
  const executionContext = {
    workspaceRoot: config.workspaceRoot,
  };

  const spotifyNoQuery = await mediaTool.execute({ action: 'play_spotify' }, executionContext);
  if (spotifyNoQuery.success) {
    throw new Error('play_spotify debió fallar al omitir el parámetro "query"');
  }
  console.log('  ✔ Validación play_spotify sin query:', `"${spotifyNoQuery.error}"`);

  const youtubeNoQuery = await mediaTool.execute({ action: 'play_youtube' }, executionContext);
  if (youtubeNoQuery.success) {
    throw new Error('play_youtube debió fallar al omitir el parámetro "query"');
  }
  console.log('  ✔ Validación play_youtube sin query:', `"${youtubeNoQuery.error}"`);

  const invalidAction = await mediaTool.execute({ action: 'accion_desconocida' }, executionContext);
  if (invalidAction.success) {
    throw new Error('Debe rechazar acciones no válidas');
  }
  console.log('  ✔ Validación de acción inválida:', `"${invalidAction.error}"`);

  // Test 4: Now Playing inspection
  console.log('\n[TEST 4] Verificando consulta de estado actual ("now_playing")...');
  const nowPlayingResult = await mediaTool.execute({ action: 'now_playing' }, executionContext);
  if (!nowPlayingResult.success) {
    throw new Error(`now_playing falló inesperadamente: ${nowPlayingResult.error}`);
  }
  console.log('  ✔ now_playing ejecutado con éxito:', nowPlayingResult.data);

  // Test 5: Transport Control Commands
  console.log('\n[TEST 5] Verificando comandos de transporte (play_pause, next, previous)...');
  const playPauseResult = await mediaTool.execute({ action: 'play_pause' }, executionContext);
  if (!playPauseResult.success) {
    throw new Error(`play_pause falló: ${playPauseResult.error}`);
  }
  console.log('  ✔ play_pause señal enviada correctamente:', playPauseResult.data);

  const nextResult = await mediaTool.execute({ action: 'next' }, executionContext);
  if (!nextResult.success) {
    throw new Error(`next falló: ${nextResult.error}`);
  }
  console.log('  ✔ next señal enviada correctamente:', nextResult.data);

  console.log('\n========================================================');
  console.log('  TODOS LOS TESTS DE LA FASE 6 PASARON SATISFACTORIAMENTE ');
  console.log('========================================================\n');
  process.exit(0);
}

runMediaTests().catch((err) => {
  console.error('\n❌ ERROR EN EL TEST DE CONTROL MULTIMEDIA:', err);
  process.exit(1);
});
