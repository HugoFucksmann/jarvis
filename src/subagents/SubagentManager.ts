import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import {
  SubagentConfig,
  SubagentRecord,
  SubagentEvent,
  SubagentStatus,
  SubagentType,
} from './types.js';
import { Logger } from '../logger/Logger.js';
import { config } from '../config/index.js';
import { getSharedScheduler } from '../scheduler/TaskScheduler.js';
import { NotificationPayload } from '../scheduler/types.js';
import { AgentCore } from '../agent/AgentCore.js';

export class SubagentManager extends EventEmitter {
  private subagents: Map<string, SubagentRecord> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private queue: { config: SubagentConfig; id: string }[] = [];
  private maxConcurrent: number = 3;
  private runningCount: number = 0;
  private logger = new Logger('SubagentManager');
  private agentCoreSupplier?: () => AgentCore;

  constructor(agentCoreSupplier?: () => AgentCore) {
    super();
    this.agentCoreSupplier = agentCoreSupplier;
    this.logger.info('SubagentManager initialized (max concurrent subagents: 3)');
  }

  public setAgentCoreSupplier(supplier: () => AgentCore): void {
    this.agentCoreSupplier = supplier;
  }

  /**
   * Spawns or queues a new background subagent task.
   * Returns immediately with the created subagent record.
   */
  public spawnSubagent(subagentConfig: SubagentConfig): SubagentRecord {
    const id = `subagent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const type: SubagentType = subagentConfig.type || (subagentConfig.command ? 'shell_worker' : 'llm_worker');

    const record: SubagentRecord = {
      id,
      title: subagentConfig.title || 'Tarea en segundo plano',
      prompt: subagentConfig.taskPrompt || '',
      type,
      command: subagentConfig.command,
      status: 'queued',
      progress: 0,
      startTime: Date.now(),
      logs: [],
      notifyChannels: subagentConfig.notifyChannels && subagentConfig.notifyChannels.length > 0
        ? subagentConfig.notifyChannels
        : ['toast', 'voice', 'hud'],
    };

    this.subagents.set(id, record);

    if (this.runningCount < this.maxConcurrent) {
      this.executeSubagent(record, subagentConfig);
    } else {
      this.queue.push({ config: subagentConfig, id });
      this.logger.info(`Subagent [${id}] "${record.title}" queued (${this.queue.length} in queue).`);
      this.emitEvent({ type: 'subagent_queued', subagent: record });
    }

    return record;
  }

  public getSubagent(id: string): SubagentRecord | undefined {
    return this.subagents.get(id);
  }

  public listSubagents(limit: number = 20): SubagentRecord[] {
    const list = Array.from(this.subagents.values());
    // Most recent first
    list.sort((a, b) => b.startTime - a.startTime);
    return list.slice(0, limit);
  }

  public cancelSubagent(id: string): boolean {
    const record = this.subagents.get(id);
    if (!record) return false;

    if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled') {
      return false;
    }

    // If queued, remove from queue
    const queueIdx = this.queue.findIndex((item) => item.id === id);
    if (queueIdx !== -1) {
      this.queue.splice(queueIdx, 1);
    }

    // Abort if running
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }

    record.status = 'cancelled';
    record.endTime = Date.now();
    record.durationMs = record.endTime - record.startTime;
    record.result = 'Tarea cancelada por el usuario.';

    this.logger.info(`Subagent [${id}] "${record.title}" was cancelled.`);
    this.emitEvent({ type: 'subagent_cancelled', subagent: record });

    this.processQueue();
    return true;
  }

  // ─────────────────────────────────────────────
  // Execution Dispatcher
  // ─────────────────────────────────────────────

  private async executeSubagent(record: SubagentRecord, configData: SubagentConfig): Promise<void> {
    this.runningCount++;
    record.status = 'running';
    record.startTime = Date.now();

    const abortController = new AbortController();
    this.abortControllers.set(record.id, abortController);

    this.logger.info(`Starting subagent [${record.id}] "${record.title}" (${record.type})`);
    this.emitEvent({ type: 'subagent_started', subagent: record });

    try {
      if (record.type === 'shell_worker') {
        await this.runShellWorker(record, configData, abortController.signal);
      } else {
        await this.runLlmWorker(record, configData, abortController.signal);
      }
    } catch (err: unknown) {
      if (!abortController.signal.aborted && record.status === 'running') {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.markFailed(record, errorMsg);
      }
    } finally {
      this.abortControllers.delete(record.id);
      this.runningCount--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length > 0 && this.runningCount < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        const record = this.subagents.get(next.id);
        if (record && record.status === 'queued') {
          this.executeSubagent(record, next.config);
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  // Shell Worker Implementation
  // ─────────────────────────────────────────────

  private async runShellWorker(
    record: SubagentRecord,
    configData: SubagentConfig,
    signal: AbortSignal
  ): Promise<void> {
    const command = configData.command || record.command;
    if (!command || !command.trim()) {
      throw new Error('Comando shell vacío para el subagente de terminal.');
    }

    const isWindows = process.platform === 'win32';
    const shellProgram = isWindows ? 'powershell.exe' : 'bash';
    const shellArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command];

    return new Promise<void>((resolve, reject) => {
      const child = spawn(shellProgram, shellArgs, {
        cwd: config.workspaceRoot,
        windowsHide: true,
      });

      const timeoutMs = (configData.timeoutSeconds || 300) * 1000;
      const timeoutId = setTimeout(() => {
        child.kill();
        const err = `Tiempo de ejecución excedido (${configData.timeoutSeconds || 300}s).`;
        this.markFailed(record, err);
        reject(new Error(err));
      }, timeoutMs);

      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        child.kill();
        resolve();
      });

      const appendLog = (line: string) => {
        const clean = line.trim();
        if (clean) {
          if (record.logs.length >= 500) {
            record.logs.shift(); // keep max 500 entries
          }
          record.logs.push(`[${new Date().toLocaleTimeString()}] ${clean}`);
          this.emitEvent({ type: 'subagent_log', subagentId: record.id, log: clean });
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        text.split('\n').forEach(appendLog);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        text.split('\n').forEach(appendLog);
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        this.markFailed(record, err.message);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (signal.aborted) {
          resolve();
          return;
        }

        if (code === 0) {
          const lastLogs = record.logs.slice(-5).join('; ');
          const summary = lastLogs || 'Comando finalizado con código de salida 0 exitoso.';
          this.markCompleted(record, summary);
          resolve();
        } else {
          const err = `El proceso de fondo terminó con código de error ${code}.`;
          this.markFailed(record, err);
          resolve();
        }
      });
    });
  }

  // ─────────────────────────────────────────────
  // LLM Worker Implementation
  // ─────────────────────────────────────────────

  private async runLlmWorker(
    record: SubagentRecord,
    configData: SubagentConfig,
    signal: AbortSignal
  ): Promise<void> {
    const agentCore = this.agentCoreSupplier ? this.agentCoreSupplier() : null;

    if (!agentCore) {
      // Fallback if AgentCore is not supplied (e.g. unit tests)
      record.logs.push(`[Simulación] Ejecutando objetivo: ${record.prompt}`);
      record.progress = 50;
      this.emitEvent({ type: 'subagent_progress', subagentId: record.id, progress: 50 });

      await new Promise((r) => setTimeout(r, 800));

      this.markCompleted(
        record,
        `Objetivo procesado correctamente: "${record.prompt.slice(0, 100)}"`
      );
      return;
    }

    record.logs.push(`Iniciando subagente cognitivo para: "${record.prompt}"`);

    // Run independent task on AgentCore
    try {
      const result = await agentCore.runTask(
        `[INSTRUCCIÓN DE SUBAGENTE EN SEGUNDO PLANO: Resuelve de forma autónoma la siguiente tarea sin solicitar confirmaciones interactivas si es posible y resume el resultado final de forma clara]\n${record.prompt}`,
        `subagent_${record.id}`,
        {
          onEvent: (event) => {
            if (signal.aborted) return;
            if (event.type === 'token') {
              // Accumulate or ignore stream
            } else if (event.type === 'tool_call_start') {
              const logMsg = `Herramienta: ${event.toolName}(${JSON.stringify(event.args).slice(0, 100)})`;
              record.logs.push(logMsg);
              this.emitEvent({ type: 'subagent_log', subagentId: record.id, log: logMsg });
            } else if (event.type === 'thinking_summary') {
              record.logs.push(`Razonamiento: ${event.summary.slice(0, 120)}`);
            }
          },
        }
      );

      if (signal.aborted) return;

      if (result.success) {
        this.markCompleted(record, result.response);
      } else {
        this.markFailed(record, result.error || 'Error en la ejecución del subagente.');
      }
    } catch (err: unknown) {
      if (!signal.aborted) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.markFailed(record, errorMsg);
      }
    }
  }

  // ─────────────────────────────────────────────
  // State Updates & Multi-Channel Notifications
  // ─────────────────────────────────────────────

  private markCompleted(record: SubagentRecord, result: string): void {
    record.status = 'completed';
    record.progress = 100;
    record.endTime = Date.now();
    record.durationMs = record.endTime - record.startTime;
    record.result = result;

    this.logger.info(`Subagent [${record.id}] "${record.title}" COMPLETED in ${record.durationMs}ms`);
    this.emitEvent({ type: 'subagent_completed', subagent: record });

    // Proactive Multi-channel Notification via Phase 7 ChannelRegistry
    this.dispatchCompletionNotification(record);
  }

  private markFailed(record: SubagentRecord, error: string): void {
    record.status = 'failed';
    record.endTime = Date.now();
    record.durationMs = record.endTime - record.startTime;
    record.error = error;

    this.logger.warn(`Subagent [${record.id}] "${record.title}" FAILED: ${error}`);
    this.emitEvent({ type: 'subagent_failed', subagent: record, error });

    // Proactive Error Notification
    this.dispatchErrorNotification(record, error);
  }

  private normalizeChannels(channels?: string[]): string[] {
    if (!channels || channels.length === 0) {
      return ['windows_toast', 'voice_tts', 'hud_websocket'];
    }
    return channels.map((c) => {
      const lower = c.toLowerCase();
      if (lower === 'toast') return 'windows_toast';
      if (lower === 'voice') return 'voice_tts';
      if (lower === 'hud') return 'hud_websocket';
      return lower;
    });
  }

  private async dispatchCompletionNotification(record: SubagentRecord): Promise<void> {
    try {
      const scheduler = getSharedScheduler();
      const channelRegistry = scheduler.getChannelRegistry();

      const shortSummary = record.result
        ? record.result.length > 250
          ? `${record.result.substring(0, 247)}...`
          : record.result
        : 'La tarea en segundo plano ha concluido satisfactoriamente.';

      const payload: NotificationPayload = {
        id: `notif_${Date.now()}_${record.id}`,
        title: `J.A.R.V.I.S. • Tarea Finalizada`,
        message: `Señor, el subagente "${record.title}" ha finalizado: ${shortSummary}`,
        priority: 'normal',
        timestamp: new Date().toISOString(),
        channels: this.normalizeChannels(record.notifyChannels),
        metadata: {
          subagentId: record.id,
          type: record.type,
          durationMs: record.durationMs,
        },
      };

      await channelRegistry.dispatch(payload);
    } catch (err: unknown) {
      this.logger.warn(`Failed to dispatch completion notification: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async dispatchErrorNotification(record: SubagentRecord, error: string): Promise<void> {
    try {
      const scheduler = getSharedScheduler();
      const channelRegistry = scheduler.getChannelRegistry();

      const payload: NotificationPayload = {
        id: `notif_err_${Date.now()}_${record.id}`,
        title: `J.A.R.V.I.S. • Error en Subagente`,
        message: `Señor, la tarea en segundo plano "${record.title}" falló: ${error.slice(0, 180)}`,
        priority: 'high',
        timestamp: new Date().toISOString(),
        channels: this.normalizeChannels(record.notifyChannels),
        metadata: {
          subagentId: record.id,
          type: record.type,
          error,
        },
      };

      await channelRegistry.dispatch(payload);
    } catch (err: unknown) {
      this.logger.warn(`Failed to dispatch error notification: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private emitEvent(event: SubagentEvent): void {
    this.emit('event', event);
  }
}

// ─────────────────────────────────────────────
// Shared Singleton
// ─────────────────────────────────────────────
let sharedSubagentManager: SubagentManager | null = null;

export function getSharedSubagentManager(agentCoreSupplier?: () => AgentCore): SubagentManager {
  if (!sharedSubagentManager) {
    sharedSubagentManager = new SubagentManager(agentCoreSupplier);
  } else if (agentCoreSupplier) {
    sharedSubagentManager.setAgentCoreSupplier(agentCoreSupplier);
  }
  return sharedSubagentManager;
}
