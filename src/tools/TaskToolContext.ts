import { ToolDefinition } from '../llm/types.js';
import { ITool, ToolExecutionContext, ToolResult } from './types.js';
import { ToolRegistry } from './ToolRegistry.js';
import { MCPRegistry } from '../mcp/MCPRegistry.js';
import { Logger } from '../logger/Logger.js';

export class TaskToolContext {
    private tools = new Map<string, ITool>();
    private logger = new Logger('TaskToolContext');

    constructor(
        private readonly registry: ToolRegistry,
        private readonly mcpRegistry?: MCPRegistry
    ) { }

    public addTool(tool: ITool): void {
        this.tools.set(tool.name, tool);
        this.logger.debug(`Tool added to task context: ${tool.name}`);
    }

    public addToolByName(name: string): boolean {
        const tool = this.registry.getTool(name);
        if (!tool) {
            return false;
        }
        this.addTool(tool);
        return true;
    }

    public addToolsByName(names: string[]): void {
        for (const name of names) {
            this.addToolByName(name);
        }
    }

    public removeTool(name: string): boolean {
        return this.tools.delete(name);
    }

    public clear(): void {
        this.tools.clear();
    }

    public getDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map((tool) => tool.toDefinition());
    }

    public getTool(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    public getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    public get size(): number {
        return this.tools.size;
    }

    public async executeTool(
        name: string,
        args: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<ToolResult> {
        if (!this.tools.has(name)) {
            return {
                success: false,
                error: `Tool "${name}" is not available in the current task context.`,
            };
        }

        return this.registry.executeTool(name, args, context, this.tools);
    }

    // Métodos retrocompatibles
    public addRelevantLocalTools(_prompt: string): void {
        this.logger.debug(
            'addRelevantLocalTools called on TaskToolContext (deprecated: handled by ToolPlanner).'
        );
    }

    public addRelevantMCPTools(_prompt: string): void {
        this.logger.debug(
            'addRelevantMCPTools called on TaskToolContext (deprecated: handled by ToolPlanner).'
        );
    }

    public addDiscoveredMCPTools(
        _serverName: string,
        _result: ToolResult,
        _prompt: string
    ): void {
        this.logger.debug(
            'addDiscoveredMCPTools called on TaskToolContext (deprecated: handled by ToolPlanner).'
        );
    }
}