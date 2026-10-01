import { AgentCore } from '../src/agent/AgentCore.js';
import { getSharedVisionProvider } from '../src/tools/builtins/visionTools.js';
import { config } from '../src/config/index.js';

async function runVisionTests() {
  console.log('========================================================');
  console.log('  TEST: J.A.R.V.I.S. Phase 3 — Vision & Screen Capture  ');
  console.log('========================================================\n');

  // Test 1: AgentCore registers vision tools
  console.log('[TEST 1] Verificando registro de herramientas de visión en AgentCore...');
  const agent = new AgentCore();
  const tools = agent.getTools();

  const screenshotTool = tools.getTool('take_screenshot');
  const analyzeTool = tools.getTool('analyze_image');

  if (!screenshotTool) {
    throw new Error('Herramienta "take_screenshot" no encontrada en ToolRegistry');
  }
  if (!analyzeTool) {
    throw new Error('Herramienta "analyze_image" no encontrada en ToolRegistry');
  }

  console.log('  ✔ "take_screenshot" registrada correctamente:', {
    riskLevel: screenshotTool.riskLevel,
    permissions: screenshotTool.requiredPermissions,
  });
  console.log('  ✔ "analyze_image" registrada correctamente:', {
    riskLevel: analyzeTool.riskLevel,
    permissions: analyzeTool.requiredPermissions,
  });

  // Test 2: Tool definitions for LLM tool calling schema
  console.log('\n[TEST 2] Verificando esquemas de Tool Calling para Ollama...');
  const screenshotDef = screenshotTool.toDefinition();
  const analyzeDef = analyzeTool.toDefinition();

  if (screenshotDef.type !== 'function' || screenshotDef.function.name !== 'take_screenshot') {
    throw new Error('Definición de función inválida para take_screenshot');
  }
  if (analyzeDef.type !== 'function' || analyzeDef.function.name !== 'analyze_image') {
    throw new Error('Definición de función inválida para analyze_image');
  }
  console.log('  ✔ Parámetros de take_screenshot:', Object.keys(screenshotDef.function.parameters.properties));
  console.log('  ✔ Parámetros de analyze_image:', Object.keys(analyzeDef.function.parameters.properties));

  // Test 3: Vision Provider initialization and configuration
  console.log('\n[TEST 3] Verificando proveedor de visión (OllamaVisionProvider)...');
  const visionProvider = getSharedVisionProvider();
  console.log(`  ✔ Nombre del proveedor: ${visionProvider.name}`);
  console.log(`  ✔ Modelo de visión activo: ${visionProvider.getModelName()}`);
  console.log(`  ✔ Dispositivo de cómputo: ${visionProvider.getDevice()}`);
  console.log(`  ✔ Configuración max width: ${config.vision.maxWidth}px, calidad: ${config.vision.quality}%`);

  // Test 4: Switching device and model in runtime
  console.log('\n[TEST 4] Verificando conmutación en caliente de device y model...');
  const initialDevice = visionProvider.getDevice();
  visionProvider.setDevice(initialDevice === 'gpu' ? 'cpu' : 'gpu');
  console.log(`  ✔ Device cambiado a: ${visionProvider.getDevice()}`);
  visionProvider.setDevice(initialDevice); // restore
  console.log(`  ✔ Device restaurado a: ${visionProvider.getDevice()}`);

  // Test 5: Check availability without crashing when Ollama is offline
  console.log('\n[TEST 5] Verificando resiliencia offline de isVisionSupported()...');
  const isSupported = await visionProvider.isVisionSupported();
  console.log(`  ✔ isVisionSupported() retornó de forma segura: ${isSupported} (sin crashear con Ollama offline)`);

  // Test 6: Image analysis error handling with non-existent file
  console.log('\n[TEST 6] Verificando validación de archivos inexistentes en analyze_image...');
  const executionContext = {
    workspaceRoot: config.workspaceRoot,
  };
  const nonexistentResult = await analyzeTool.execute(
    { path: 'archivo_fantasma_inexistente.png', prompt: '¿Qué ves?' },
    executionContext
  );
  if (nonexistentResult.success) {
    throw new Error('analyze_image debió fallar ante un archivo inexistente');
  }
  console.log(`  ✔ Validación correcta ante archivo inexistente: "${nonexistentResult.error}"`);

  console.log('\n========================================================');
  console.log('  TODOS LOS TESTS DE LA FASE 3 PASARON SATISFACTORIAMENTE ');
  console.log('========================================================\n');
  process.exit(0);
}

runVisionTests().catch((err) => {
  console.error('\n❌ ERROR EN EL TEST DE VISIÓN:', err);
  process.exit(1);
});
