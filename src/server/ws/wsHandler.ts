import { WebSocketServer, WebSocket } from 'ws';
import { AgentCore } from '../../agent/AgentCore.js';
import { AgentEvent } from '../../agent/types.js';
import { RiskLevel } from '../../tools/types.js';
import { Logger } from '../../logger/Logger.js';

const logger = new Logger('WSHandler');

/**
 * Attaches the JARVIS WebSocket handler to an existing WebSocketServer.
 * Handles: chat_message, approval_response, cancel_task
 */
export function attachWsHandler(wss: WebSocketServer, agentCore: AgentCore): void {
  // Approval promises are scoped here, not in module-level globals, so they
  // don't leak between connections if multiple clients were ever open.
  const pendingApprovals = new Map<string, (approved: boolean) => void>();

  wss.on('connection', (ws: WebSocket) => {
    logger.info('WebSocket client connected to JARVIS interface.');
    let currentTaskId: string | null = null;

    const send = (type: string, payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
      }
    };

    ws.on('message', async (data: Buffer | string) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type: string;
          payload: Record<string, unknown>;
        };

        if (message.type === 'chat_message') {
          await handleChatMessage(message.payload, send, agentCore, pendingApprovals, (id) => {
            currentTaskId = id;
          });
        } else if (message.type === 'approval_response') {
          handleApprovalResponse(message.payload, pendingApprovals);
        } else if (message.type === 'cancel_task') {
          handleCancelTask(currentTaskId, agentCore, send);
        }
      } catch (err: unknown) {
        logger.error(
          `Error processing WebSocket message: ${err instanceof Error ? err.message : String(err)}`
        );
        send('error', { message: 'Internal server error processing command.' });
      }
    });

    ws.on('close', () => {
      logger.info('WebSocket client disconnected.');
    });
  });
}

// ─────────────────────────────────────────────
// Internal handlers
// ─────────────────────────────────────────────

async function handleChatMessage(
  payload: Record<string, unknown>,
  send: (type: string, data: Record<string, unknown>) => void,
  agentCore: AgentCore,
  pendingApprovals: Map<string, (approved: boolean) => void>,
  setCurrentTaskId: (id: string) => void
): Promise<void> {
  const prompt = payload.prompt as string;
  const sessionId = (payload.sessionId as string) || 'default';

  if (!prompt || !prompt.trim()) return;

  logger.info(`Received prompt from client: "${prompt.substring(0, 50)}..."`);

  const taskResult = await agentCore.runTask(prompt, sessionId, {
    onEvent: (event: AgentEvent) => {
      send('agent_event', event as unknown as Record<string, unknown>);
    },
    requestApproval: (
      toolName: string,
      args: Record<string, unknown>,
      risk: RiskLevel,
      reason: string
    ): Promise<boolean> => {
      const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      send('approval_required', { approvalId, toolName, args, riskLevel: risk, reason });

      return new Promise<boolean>((resolve) => {
        pendingApprovals.set(approvalId, resolve);

        // Auto-reject after 60 seconds if user doesn't respond
        setTimeout(() => {
          if (pendingApprovals.has(approvalId)) {
            pendingApprovals.delete(approvalId);
            resolve(false);
          }
        }, 60_000);
      });
    },
  });

  setCurrentTaskId(taskResult.taskId);
  send('task_finished', taskResult as unknown as Record<string, unknown>);
}

function handleApprovalResponse(
  payload: Record<string, unknown>,
  pendingApprovals: Map<string, (approved: boolean) => void>
): void {
  const { approvalId, approved } = payload as { approvalId: string; approved: boolean };
  const resolver = pendingApprovals.get(approvalId);
  if (resolver) {
    resolver(approved);
    pendingApprovals.delete(approvalId);
    logger.info(
      `User responded to approval [${approvalId}]: ${approved ? 'APPROVED' : 'DENIED'}`
    );
  }
}

function handleCancelTask(
  currentTaskId: string | null,
  agentCore: AgentCore,
  send: (type: string, data: Record<string, unknown>) => void
): void {
  if (currentTaskId) {
    agentCore.cancelTask(currentTaskId);
    send('task_cancelled', { taskId: currentTaskId });
  }
}
