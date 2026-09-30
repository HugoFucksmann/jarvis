import WebSocket from 'ws';

async function testWebSocket() {
  console.log('Testing WebSocket connection to ws://127.0.0.1:3000/ws...');
  const ws = new WebSocket('ws://127.0.0.1:3000/ws');

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('WebSocket successfully opened!');
      resolve();
    });
    ws.on('error', reject);
  });

  let receivedTokens = 0;
  let finished = false;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'agent_event') {
      if (msg.payload.type === 'state_change') {
        console.log(`[WS STATE] -> ${msg.payload.state}: ${msg.payload.message}`);
      } else if (msg.payload.type === 'token') {
        receivedTokens++;
        process.stdout.write(msg.payload.token);
      }
    } else if (msg.type === 'task_finished') {
      console.log('\n[WS TASK FINISHED]', msg.payload.taskId);
      finished = true;
      ws.close();
    }
  });

  console.log('\nSending test prompt via WebSocket...');
  ws.send(JSON.stringify({
    type: 'chat_message',
    payload: {
      prompt: 'Responde de forma muy breve: ¿Cuál es tu directiva principal, JARVIS?',
      sessionId: 'ws-test-session',
    }
  }));

  // Wait for finish
  while (!finished) {
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nWebSocket test passed! Received ${receivedTokens} streamed tokens.`);
  process.exit(0);
}

testWebSocket().catch((err) => {
  console.error('WebSocket test failed:', err);
  process.exit(1);
});
