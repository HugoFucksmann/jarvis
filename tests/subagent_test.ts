import { getSharedSubagentManager, SubagentManager } from '../src/subagents/SubagentManager.js';
import {
  DelegateSubagentTool,
  ListSubagentsTool,
  GetSubagentOutputTool,
  CancelSubagentTool,
} from '../src/tools/builtins/subagentTools.js';

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
  console.log('  J.A.R.V.I.S. Phase 8 Test Suite: Subagents & Background Workers');
  console.log('======================================================\n');

  const manager = getSharedSubagentManager();

  // Test 1: Spawn shell worker
  console.log('[Test 1] Spawning a shell worker in background...');
  const shellCmd = process.platform === 'win32'
    ? 'Write-Output "Alpha 1 Ready"; Start-Sleep -Milliseconds 150; Write-Output "Alpha 2 Complete"'
    : 'echo "Alpha 1 Ready"; sleep 0.15; echo "Alpha 2 Complete"';

  const record1 = manager.spawnSubagent({
    title: 'Compilación y Verificación Alpha',
    taskPrompt: 'Ejecutar verificación de compilación',
    type: 'shell_worker',
    command: shellCmd,
    notifyChannels: ['toast', 'voice', 'hud'],
  });

  assert(record1.id.startsWith('subagent_'), 'Subagent ID generated properly');
  assert(record1.title === 'Compilación y Verificación Alpha', 'Subagent title stored properly');
  assert(record1.status === 'running' || record1.status === 'queued', 'Initial status is running or queued');

  // Wait for shell worker to complete
  await new Promise((r) => setTimeout(r, 600));

  const updated1 = manager.getSubagent(record1.id);
  assert(updated1 !== undefined, 'Subagent record exists in manager');
  assert(updated1?.status === 'completed', `Subagent finished with status 'completed' (actual: ${updated1?.status})`);
  assert(
    updated1?.logs.some((l) => l.includes('Alpha 1 Ready') || l.includes('Alpha 2 Complete')) === true,
    'Subagent logs captured process stdout output'
  );
  assert(typeof updated1?.durationMs === 'number' && updated1.durationMs > 0, 'Duration in ms was computed');

  // Test 2: Cancel subagent
  console.log('\n[Test 2] Testing subagent cancellation...');
  const longCmd = process.platform === 'win32'
    ? 'Start-Sleep -Seconds 10'
    : 'sleep 10';

  const record2 = manager.spawnSubagent({
    title: 'Tarea Larga a Cancelar',
    taskPrompt: 'Esperar 10 segundos',
    type: 'shell_worker',
    command: longCmd,
  });

  assert(record2.status === 'running', 'Long task started running');
  const cancelled = manager.cancelSubagent(record2.id);
  assert(cancelled === true, 'cancelSubagent returned true');

  const updated2 = manager.getSubagent(record2.id);
  assert(updated2?.status === 'cancelled', `Subagent status updated to cancelled (actual: ${updated2?.status})`);

  // Test 3: List subagents
  console.log('\n[Test 3] Testing listSubagents...');
  const list = manager.listSubagents();
  assert(list.length >= 2, `listSubagents returned ${list.length} subagents`);
  assert(list[0].startTime >= list[1].startTime, 'Subagents sorted newest first');

  // Test 4: Tools execution (DelegateSubagentTool)
  console.log('\n[Test 4] Testing DelegateSubagentTool...');
  const delegateTool = new DelegateSubagentTool();
  const delegateRes = await delegateTool.execute(
    {
      title: 'Auditoría de Archivos',
      taskPrompt: 'Escanear archivos en background',
      type: 'shell_worker',
      command: process.platform === 'win32' ? 'Write-Output "Audit OK"' : 'echo "Audit OK"',
    },
    { workspaceRoot: process.cwd(), sessionId: 'test', memory: null as any }
  );

  assert(delegateRes.success === true, 'DelegateSubagentTool executed successfully');
  const delegateData = delegateRes.data as any;
  assert(typeof delegateData.subagentId === 'string', 'Returned subagentId');
  assert(delegateData.status === 'running' || delegateData.status === 'queued', 'Returned status');

  // Wait for it
  await new Promise((r) => setTimeout(r, 400));

  // Test 5: GetSubagentOutputTool
  console.log('\n[Test 5] Testing GetSubagentOutputTool...');
  const outputTool = new GetSubagentOutputTool();
  const outputRes = await outputTool.execute(
    { subagentId: delegateData.subagentId },
    { workspaceRoot: process.cwd(), sessionId: 'test', memory: null as any }
  );

  assert(outputRes.success === true, 'GetSubagentOutputTool executed successfully');
  const outputData = outputRes.data as any;
  assert(outputData.id === delegateData.subagentId, 'Output data matches requested subagent');
  assert(outputData.status === 'completed', `Subagent output status is completed (actual: ${outputData.status})`);

  // Test 6: ListSubagentsTool
  console.log('\n[Test 6] Testing ListSubagentsTool...');
  const listTool = new ListSubagentsTool();
  const listRes = await listTool.execute(
    { status: 'all' },
    { workspaceRoot: process.cwd(), sessionId: 'test', memory: null as any }
  );

  assert(listRes.success === true, 'ListSubagentsTool executed successfully');
  const listData = listRes.data as any;
  assert(Array.isArray(listData.subagents), 'Returned subagents array');
  assert(listData.count >= 3, `Count is ${listData.count}`);

  // Test 7: CancelSubagentTool on nonexistent / already finished
  console.log('\n[Test 7] Testing CancelSubagentTool on finished task...');
  const cancelTool = new CancelSubagentTool();
  const cancelRes = await cancelTool.execute(
    { subagentId: delegateData.subagentId },
    { workspaceRoot: process.cwd(), sessionId: 'test', memory: null as any }
  );
  // It shouldn't crash, should return error because it's already completed
  assert(cancelRes.success === false, 'Cancel on completed task handled gracefully');

  // Test 8: LLM Worker Fallback/Simulation
  console.log('\n[Test 8] Testing LLM worker execution...');
  const recordLlm = manager.spawnSubagent({
    title: 'Investigación Conceptual de Agentes',
    taskPrompt: 'Analizar cómo desacoplar subagentes asíncronos',
    type: 'llm_worker',
  });

  assert(recordLlm.type === 'llm_worker', 'LLM worker type configured');
  // Wait for LLM worker simulated execution
  await new Promise((r) => setTimeout(r, 1000));
  const updatedLlm = manager.getSubagent(recordLlm.id);
  assert(
    updatedLlm?.status === 'completed',
    `LLM subagent completed autonomously (actual: ${updatedLlm?.status})`
  );

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
