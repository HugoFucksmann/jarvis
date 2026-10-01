import { config, updateWakeWordConfig } from '../src/config/index.js';
import { parseWakeWordPhrase } from '../public/js/modules/wakeword.js';

async function runWakeWordTests() {
  console.log('========================================================');
  console.log('  TEST: J.A.R.V.I.S. Phase 5 — Passive Wake Word Engine ');
  console.log('========================================================\n');

  // Test 1: Configuration in config/index.ts
  console.log('[TEST 1] Verificando configuración del sistema de Wake Word...');
  if (!config.wakeWord) {
    throw new Error('config.wakeWord no está definido');
  }
  if (!Array.isArray(config.wakeWord.keywords) || config.wakeWord.keywords.length === 0) {
    throw new Error('config.wakeWord.keywords no contiene palabras clave válidas');
  }
  if (typeof config.wakeWord.autoDismissSeconds !== 'number' || config.wakeWord.autoDismissSeconds <= 0) {
    throw new Error('config.wakeWord.autoDismissSeconds debe ser un número positivo');
  }

  console.log('  ✔ Estado inicial:', config.wakeWord.enabled ? 'HABILITADO' : 'DESHABILITADO');
  console.log('  ✔ Palabras clave registradas:', config.wakeWord.keywords.join(', '));
  console.log('  ✔ Tiempo de auto-dismiss:', `${config.wakeWord.autoDismissSeconds} segundos`);

  // Test 2: Hot-switching config
  console.log('\n[TEST 2] Verificando actualización de configuración en caliente...');
  const initial = config.wakeWord.enabled;
  updateWakeWordConfig(!initial);
  if (config.wakeWord.enabled === initial) {
    throw new Error('updateWakeWordConfig falló al cambiar el estado');
  }
  updateWakeWordConfig(initial); // restore
  console.log('  ✔ updateWakeWordConfig alterna el estado correctamente');

  // Test 3: Wake word phrase parser - Pure Activation
  console.log('\n[TEST 3] Verificando detección de activación pura (solo wake word)...');
  const pureTest1 = parseWakeWordPhrase('Hey JARVIS');
  if (!pureTest1 || pureTest1.keyword !== 'hey jarvis' || pureTest1.isOneShot) {
    throw new Error(`Fallo en detección pura "Hey JARVIS": ${JSON.stringify(pureTest1)}`);
  }
  console.log('  ✔ "Hey JARVIS" -> Activación pura detectada');

  const pureTest2 = parseWakeWordPhrase('¡Oye JARVIS!');
  if (!pureTest2 || pureTest2.keyword !== 'oye jarvis' || pureTest2.isOneShot) {
    throw new Error(`Fallo en detección pura "¡Oye JARVIS!": ${JSON.stringify(pureTest2)}`);
  }
  console.log('  ✔ "¡Oye JARVIS!" (con signos de exclamación) -> Activación pura detectada');

  // Test 4: Wake word phrase parser - One-Shot Voice Commands
  console.log('\n[TEST 4] Verificando detección de One-Shot Voice Commands...');
  const oneShot1 = parseWakeWordPhrase('Hey JARVIS, ¿qué hora es?');
  if (!oneShot1 || !oneShot1.isOneShot || oneShot1.command !== 'qué hora es') {
    throw new Error(`Fallo en one-shot "Hey JARVIS qué hora es": ${JSON.stringify(oneShot1)}`);
  }
  console.log(`  ✔ "Hey JARVIS, ¿qué hora es?" -> Comando extraído: "${oneShot1.command}"`);

  const oneShot2 = parseWakeWordPhrase('Jarvis abre la calculadora por favor');
  if (!oneShot2 || !oneShot2.isOneShot || !oneShot2.command.includes('calculadora')) {
    throw new Error(`Fallo en one-shot "Jarvis abre la calculadora": ${JSON.stringify(oneShot2)}`);
  }
  console.log(`  ✔ "Jarvis abre la calculadora por favor" -> Comando extraído: "${oneShot2.command}"`);

  // Test 5: Rejecting non-wake phrases
  console.log('\n[TEST 5] Verificando rechazo de frases sin palabra clave...');
  const nonMatch1 = parseWakeWordPhrase('Hola cómo estás hoy');
  if (nonMatch1 !== null) {
    throw new Error('Falso positivo detectado en frase no relacionada');
  }
  const nonMatch2 = parseWakeWordPhrase('Abriendo Visual Studio Code');
  if (nonMatch2 !== null) {
    throw new Error('Falso positivo detectado en frase no relacionada');
  }
  console.log('  ✔ Frases ordinarias rechazadas correctamente sin falsos positivos');

  console.log('\n========================================================');
  console.log('  TODOS LOS TESTS DE LA FASE 5 PASARON SATISFACTORIAMENTE ');
  console.log('========================================================\n');
  process.exit(0);
}

runWakeWordTests().catch((err) => {
  console.error('\n❌ ERROR EN EL TEST DE WAKE WORD:', err);
  process.exit(1);
});
