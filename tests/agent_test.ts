import { AgentCore } from '../src/agent/AgentCore.js';
import { RiskLevel } from '../src/tools/types.js';

async function runTest() {
  console.log('--- TEST: JARVIS Autonomous Agent Core ---');
  const agent = new AgentCore();

  console.log('\n[TEST 1] Consultando fecha/hora y archivos del workspace...');
  const result1 = await agent.runTask(
    'Dime qué hora es y lista qué archivos hay en la raíz del proyecto.',
    'test-session-1',
    {
      onEvent: (event) => {
        if (event.type === 'state_change') {
          console.log(`  [STATE] ${event.state}: ${event.message}`);
        } else if (event.type === 'tool_call_start') {
          console.log(`  [TOOL START] ${event.toolName} (Risk: ${event.riskLevel})`, event.args);
        } else if (event.type === 'tool_call_result') {
          console.log(`  [TOOL RESULT] ${event.toolName} -> success: ${event.result.success}`);
        }
      },
      requestApproval: async (tool, args, risk, reason) => {
        console.log(`  [APPROVAL REQUESTED] ${tool} (${risk}): ${reason}`);
        return true;
      }
    }
  );

  console.log('\n[RESULT 1 RESPONSE]:');
  console.log(result1.response);
  console.log(`Iterations: ${result1.iterations}, Tool Calls: ${result1.toolCallsCount}, Duration: ${result1.durationMs}ms`);

  console.log('\n[TEST 2] Verificando auditoría de seguridad registrada...');
  const auditLogs = agent.getPermissionManager().getRecentAudit(10);
  console.log(`Se registraron ${auditLogs.length} eventos de auditoría:`);
  auditLogs.forEach((log) => {
    console.log(`  - ${log.toolName} [${log.riskLevel}] -> Mode: ${log.approvalMode}, Success: ${log.success}`);
  });

  console.log('\n--- TESTS COMPLETED SUCCESSFULLY ---');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
