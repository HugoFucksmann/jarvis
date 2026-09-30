import { RiskLevel, ToolResult } from '../tools/types.js';

export enum AgentState {
  IDLE = 'IDLE',
  UNDERSTANDING = 'UNDERSTANDING',
  PLANNING = 'PLANNING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  EXECUTING_TOOL = 'EXECUTING_TOOL',
  OBSERVING = 'OBSERVING',
  REASONING = 'REASONING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  CANCELLED = 'CANCELLED',
}

export type AgentEvent =
  | { type: 'state_change'; state: AgentState; message: string }
  | { type: 'token'; token: string }
  | { type: 'thinking_summary'; summary: string }
  | { type: 'tool_call_start'; toolName: string; args: Record<string, unknown>; riskLevel: RiskLevel; callId: string }
  | { type: 'approval_requested'; toolName: string; args: Record<string, unknown>; riskLevel: RiskLevel; reason: string; approvalId: string }
  | { type: 'approval_resolved'; approvalId: string; approved: boolean }
  | { type: 'tool_call_result'; callId: string; toolName: string; result: ToolResult }
  | { type: 'task_complete'; response: string }
  | { type: 'task_error'; error: string }
  | { type: 'task_cancelled' };

export interface AgentTaskRequest {
  taskId: string;
  sessionId: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface AgentTaskResult {
  taskId: string;
  success: boolean;
  response: string;
  toolCallsCount: number;
  iterations: number;
  durationMs: number;
  error?: string;
}
