import { LLMProvider } from '../llm/types.js';
import { OllamaProvider } from '../llm/OllamaProvider.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { PermissionManager } from '../tools/security/PermissionManager.js';
import { MemoryStore } from '../memory/MemoryStore.js';
import { AgentLoop } from './AgentLoop.js';
import { AgentEvent, AgentTaskRequest, AgentTaskResult } from './types.js';
import { config, updateModelConfig } from '../config/index.js';
import { Logger } from '../logger/Logger.js';
import { RiskLevel } from '../tools/types.js';
import { TaskHistory } from './TaskHistory.js';

// Import built-in tools
import { GetCurrentTimeTool, GetSystemInfoTool } from '../tools/builtins/systemTools.js';
import {
  ListFilesTool,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  SearchFilesTool,
  DeleteFileTool,
} from '../tools/builtins/fileTools.js';
import { RunCommandTool, GetProcessesTool } from '../tools/builtins/terminalTools.js';
import { OpenUrlTool, OpenApplicationTool } from '../tools/builtins/browserTools.js';
import { WebSearchTool } from '../tools/builtins/webSearchTools.js';
import { ManageMemoryTool } from '../tools/builtins/memoryTools.js';

export class AgentCore {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private memory: MemoryStore;
  private permissionManager: PermissionManager;
  private taskHistory: TaskHistory;
  private activeTasks: Map<string, AbortController> = new Map();
  private logger = new Logger('AgentCore');

  constructor() {
    this.logger.info('Initializing JARVIS Agent Core...');

    // 1. Initialize LLM Provider (Ollama local)
    this.llm = new OllamaProvider(config.ollama.baseUrl, config.ollama.model);

    // 2. Initialize Permission Manager
    this.permissionManager = new PermissionManager(config.security, config.workspaceRoot);

    // 3. Initialize Tool Registry
    this.tools = new ToolRegistry(this.permissionManager);

    // 4. Initialize Memory Store & Task History
    this.memory = new MemoryStore(config.workspaceRoot);
    this.taskHistory = new TaskHistory(config.workspaceRoot);

    // 5. Register all built-in tools
    this.registerBuiltinTools();

    this.logger.info(`Agent Core initialized with model: ${this.llm.getModel()} at ${config.workspaceRoot}`);
  }

  private registerBuiltinTools(): void {
    // System tools
    this.tools.registerTool(new GetCurrentTimeTool());
    this.tools.registerTool(new GetSystemInfoTool());

    // File tools
    this.tools.registerTool(new ListFilesTool());
    this.tools.registerTool(new ReadFileTool());
    this.tools.registerTool(new WriteFileTool());
    this.tools.registerTool(new EditFileTool());
    this.tools.registerTool(new SearchFilesTool());
    this.tools.registerTool(new DeleteFileTool());

    // Terminal tools
    this.tools.registerTool(new RunCommandTool());
    this.tools.registerTool(new GetProcessesTool());

    // Browser tools
    this.tools.registerTool(new OpenUrlTool());
    this.tools.registerTool(new OpenApplicationTool());

    // Web search
    if (config.features.webSearchEnabled) {
      this.tools.registerTool(new WebSearchTool());
    }

    // Persistent cross-chat memory tool
    this.tools.registerTool(new ManageMemoryTool());
  }

  public getLLM(): LLMProvider {
    return this.llm;
  }

  public getTools(): ToolRegistry {
    return this.tools;
  }

  public getMemory(): MemoryStore {
    return this.memory;
  }

  public getTaskHistory(): TaskHistory {
    return this.taskHistory;
  }

  public getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  public async setModel(modelName: string): Promise<void> {
    this.llm.setModel(modelName);
    updateModelConfig(modelName);
  }

  public cancelTask(taskId: string): boolean {
    const controller = this.activeTasks.get(taskId);
    if (controller) {
      this.logger.info(`Cancelling task ${taskId}`);
      controller.abort();
      this.activeTasks.delete(taskId);
      return true;
    }
    return false;
  }

  public async runTask(
    prompt: string,
    sessionId: string = 'default',
    callbacks?: {
      onEvent?: (event: AgentEvent) => void;
      requestApproval?: (toolName: string, args: Record<string, unknown>, risk: RiskLevel, reason: string) => Promise<boolean>;
    }
  ): Promise<AgentTaskResult> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const abortController = new AbortController();
    this.activeTasks.set(taskId, abortController);
    const toolsUsed: string[] = [];

    const agentLoop = new AgentLoop({
      llm: this.llm,
      tools: this.tools,
      memory: this.memory,
      workspaceRoot: config.workspaceRoot,
      maxIterations: config.agent.maxIterations,
      timeoutSeconds: config.agent.timeoutSeconds,
      onEvent: (event) => {
        if (event.type === 'tool_call_start') {
          if (!toolsUsed.includes(event.toolName)) {
            toolsUsed.push(event.toolName);
          }
        }
        callbacks?.onEvent?.(event);
      },
      requestApproval: callbacks?.requestApproval,
    });

    const taskRequest: AgentTaskRequest = {
      taskId,
      sessionId,
      prompt,
      signal: abortController.signal,
    };

    try {
      const result = await agentLoop.run(taskRequest);
      // Record task into persistent history
      this.taskHistory.recordTask({
        id: taskId,
        timestamp: new Date().toISOString(),
        prompt,
        success: result.success,
        toolCallsCount: result.toolCallsCount,
        toolsUsed,
        durationMs: result.durationMs,
        summary: result.response.slice(0, 160).replace(/\n/g, ' '),
      });
      return result;
    } finally {
      this.activeTasks.delete(taskId);
    }
  }
}
