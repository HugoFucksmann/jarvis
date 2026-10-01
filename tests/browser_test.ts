import { AgentCore } from '../src/agent/AgentCore.js';
import { getSharedPlaywrightManager } from '../src/browser/PlaywrightManager.js';
import { BrowseWebTool } from '../src/tools/builtins/browserNavigationTools.js';

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

async function runTests() {
  console.log('\n======================================================');
  console.log('  J.A.R.V.I.S. Phase 4 Test Suite: Autonomous Playwright Browser');
  console.log('======================================================\n');

  // Test 1: Tool Registration in AgentCore
  console.log('[Test 1] Verificando registro de "browse_web" en AgentCore...');
  const agentCore = new AgentCore();
  const tools = agentCore.getTools();
  const browseTool = tools.getTool('browse_web');

  assert(browseTool !== undefined, 'Herramienta "browse_web" registrada correctamente en AgentCore');
  assert(browseTool?.riskLevel === 'LOW', 'Risk level es LOW');
  assert(browseTool?.requiredPermissions.includes('browser:navigate') === true, 'Requiere permiso browser:navigate');

  // Test 2: Tool parameter schema
  console.log('\n[Test 2] Verificando esquema de parámetros de Tool Calling para Ollama...');
  const schema = (browseTool as any).parameters;
  assert(schema.type === 'object', 'Schema type es object');
  assert(Array.isArray(schema.properties.action.enum), 'Acción tiene enum de opciones válidas');
  assert(
    ['navigate', 'extract', 'click', 'fill', 'press', 'screenshot', 'evaluate', 'close'].every((act) =>
      schema.properties.action.enum.includes(act)
    ),
    'Enum incluye todas las acciones interactivas requeridas'
  );

  // Test 3: Input validation
  console.log('\n[Test 3] Verificando validaciones de entrada...');
  const toolInstance = new BrowseWebTool();
  const execContext = { workspaceRoot: process.cwd(), sessionId: 'test', memory: null as any };

  const invalidActionRes = await toolInstance.execute({ action: 'accion_desconocida' }, execContext);
  assert(invalidActionRes.success === false, 'Rechaza acción inválida');
  assert(
    (invalidActionRes.error || '').includes('no reconocida'),
    'Mensaje de error descriptivo ante acción inválida'
  );

  const missingUrlRes = await toolInstance.execute({ action: 'navigate' }, execContext);
  assert(missingUrlRes.success === false, 'Rechaza navigate sin URL');

  const missingSelectorRes = await toolInstance.execute({ action: 'click' }, execContext);
  assert(missingSelectorRes.success === false, 'Rechaza click sin selector');

  // Test 4: PlaywrightManager Status
  console.log('\n[Test 4] Verificando estado inicial de PlaywrightManager...');
  const manager = getSharedPlaywrightManager();
  const status = manager.getStatus();

  assert(typeof status.isAvailable === 'boolean', 'isAvailable es booleano');
  assert(status.isActive === false, 'isActive es false antes de abrir páginas');
  assert(status.engine.includes('Playwright'), 'Engine reporta Playwright');

  // Test 5: Fallback Content Extraction
  console.log('\n[Test 5] Verificando extracción de contenido web...');
  // Testing extraction with fallback against a known reliable domain or fallback simulation
  const extractRes = await toolInstance.execute(
    { action: 'extract', url: 'https://example.com' },
    execContext
  );

  assert(extractRes.success === true, 'Extracción de contenido finalizó con éxito');
  const extractData = extractRes.data as any;
  assert(typeof extractData.title === 'string' && extractData.title.length > 0, 'Título de página extraído');
  assert(typeof extractData.content === 'string' && extractData.content.length > 0, 'Texto de página extraído');
  assert(extractData.url.includes('example.com'), 'URL devuelta correctamente');

  // Test 6: Browser Close lifecycle
  console.log('\n[Test 6] Verificando ciclo de vida y cierre de sesión...');
  const closeRes = await toolInstance.execute({ action: 'close' }, execContext);
  assert(closeRes.success === true, 'Cierre de sesión de navegador ejecutado exitosamente');

  const finalStatus = manager.getStatus();
  assert(finalStatus.isActive === false, 'Estado activo es false tras cierre');

  console.log('\n======================================================');
  console.log(`  Tests Passed: ${passed} | Tests Failed: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
