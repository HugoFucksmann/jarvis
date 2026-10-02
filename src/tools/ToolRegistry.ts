import { ITool, ToolResult, ToolExecutionContext, RiskLevel } from './types.js';
import { ToolDefinition } from '../llm/types.js';
import { PermissionManager } from './security/PermissionManager.js';
import { Logger } from '../logger/Logger.js';

export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();
  private permissionManager: PermissionManager;
  private logger = new Logger('ToolRegistry');

  constructor(permissionManager: PermissionManager) {
    this.permissionManager = permissionManager;
  }

  public registerTool(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Overwriting tool registration for: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);

    this.logger.debug(
      `Registered tool: ${tool.name} [Risk: ${tool.riskLevel}]`
    );
  }

  public getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns definitions for every globally registered tool.
   *
   * Kept for compatibility. AgentLoop should NOT use this directly
   * when sending tools to the LLM.
   */
  public getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) =>
      tool.toDefinition()
    );
  }

  /**
   * Returns definitions for a selected subset of tools.
   */
  public getDefinitionsForTools(toolNames: string[]): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];

    for (const name of toolNames) {
      const tool = this.tools.get(name);

      if (tool) {
        definitions.push(tool.toDefinition());
      }
    }

    return definitions;
  }

  public async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    scopedTools?: Map<string, ITool>
  ): Promise<ToolResult> {
    const startTime = Date.now();

    const tool =
      scopedTools?.get(name) ??
      this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" is not registered in the system.`,
      };
    }

    const { riskLevel } =
      this.permissionManager.evaluateRisk(tool, args);

    const authResult =
      await this.permissionManager.authorize(
        tool,
        args,
        context.requestApproval
      );

    if (!authResult.authorized) {
      this.permissionManager.recordAudit({
        timestamp: new Date().toISOString(),
        toolName: name,
        riskLevel,
        parameters: args,
        approved: false,
        approvalMode: authResult.mode,
        success: false,
        error: authResult.reason || 'Unauthorized',
        executionTimeMs: Date.now() - startTime,
      });

      return {
        success: false,
        error: `Permission Denied: ${authResult.reason || 'Action denied by user policy'
          }`,
      };
    }

    try {
      this.logger.info(
        `Executing tool: ${name}`,
        { riskLevel }
      );

      const result = await tool.execute(args, context);
      const executionTime = Date.now() - startTime;

      this.permissionManager.recordAudit({
        timestamp: new Date().toISOString(),
        toolName: name,
        riskLevel,
        parameters: args,
        approved: true,
        approvalMode: authResult.mode,
        success: result.success,
        error: result.error,
        executionTimeMs: executionTime,
      });

      return result;
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? err.message
          : String(err);

      const executionTime = Date.now() - startTime;

      this.logger.error(
        `Error executing tool ${name}: ${errMsg}`
      );

      this.permissionManager.recordAudit({
        timestamp: new Date().toISOString(),
        toolName: name,
        riskLevel,
        parameters: args,
        approved: true,
        approvalMode: authResult.mode,
        success: false,
        error: errMsg,
        executionTimeMs: executionTime,
      });

      return {
        success: false,
        error: `Execution error in ${name}: ${errMsg}`,
      };
    }
  }
}