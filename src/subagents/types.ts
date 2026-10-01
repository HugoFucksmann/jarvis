import { RiskLevel } from '../tools/types.js';

export type SubagentType = 'llm_worker' | 'shell_worker';

export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubagentConfig {
  title: string;
  taskPrompt: string;
  type?: SubagentType;
  command?: string;
  notifyChannels?: string[];
  maxIterations?: number;
  timeoutSeconds?: number;
}

export interface SubagentRecord {
  id: string;
  title: string;
  prompt: string;
  type: SubagentType;
  command?: string;
  status: SubagentStatus;
  progress: number; // 0 - 100
  startTime: number;
  endTime?: number;
  durationMs?: number;
  result?: string;
  error?: string;
  logs: string[];
  notifyChannels: string[];
}

export type SubagentEvent =
  | { type: 'subagent_queued'; subagent: SubagentRecord }
  | { type: 'subagent_started'; subagent: SubagentRecord }
  | { type: 'subagent_log'; subagentId: string; log: string }
  | { type: 'subagent_progress'; subagentId: string; progress: number }
  | { type: 'subagent_completed'; subagent: SubagentRecord }
  | { type: 'subagent_failed'; subagent: SubagentRecord; error: string }
  | { type: 'subagent_cancelled'; subagent: SubagentRecord };
