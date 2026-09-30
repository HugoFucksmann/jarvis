import { ToolFunctionDefinition } from '../llm/types.js';

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export interface ToolResult {
  success: boolean;
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
