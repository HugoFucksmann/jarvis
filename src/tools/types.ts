import { ToolFunctionDefinition } from '../llm/types.js';

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Represents the real lifecycle state of an action performed by a tool.
 * - requested:  the action was sent to the OS/app but completion is unknown.
 * - started:    the process/player/app has begun but may not be fully ready.
 * - completed:  the action finished and the result was confirmed synchronously.
 * - verified:   completion was actively confirmed (e.g. process check, scrape).
 * - failed:     the action was attempted but definitely did not succeed.
 */
export type ActionState = 'requested' | 'started' | 'completed' | 'verified' | 'failed';

export interface ToolResult {
  success: boolean;
  /** Lifecycle state of the action. Lets the agent reason about whether to
   *  take further steps (e.g. verify, retry) or consider the task done. */
  state?: ActionState;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  workspaceRoot: string;
  signal?: AbortSignal;
  requestApproval?: (toolName: string, args: Record<string, unknown>, risk: RiskLevel, reason: string) => Promise<boolean>;
}

export interface ITool {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredPermissions: string[];
  parameters: ToolFunctionDefinition['parameters'];
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;
  toDefinition(): { type: 'function'; function: ToolFunctionDefinition };
}

export interface AuditLogEntry {
  timestamp: string;
  toolName: string;
  riskLevel: RiskLevel;
  parameters: Record<string, unknown>;
  approved: boolean;
  approvalMode: 'automatic' | 'manual' | 'rejected';
  success?: boolean;
  error?: string;
  executionTimeMs?: number;
}
