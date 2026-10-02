import { MCPClient, MCPServerConfig, MCPTool } from './MCPClient.js';
import { ITool, RiskLevel, ToolExecutionContext, ToolResult } from '../tools/types.js';
import { ToolFunctionDefinition } from '../llm/types.js';
import { Logger } from '../logger/Logger.js';

const logger = new Logger('MCPToolAdapter');

export class MCPToolAdapter implements ITool {
  readonly name: string;
  readonly description: string;
  readonly riskLevel = RiskLevel.MEDIUM;
  readonly requiredPermissions: string[] = [];
  readonly parameters: ToolFunctionDefinition['parameters'];

  private client: MCPClient;
  private rawName: string;

  constructor(client: MCPClient, mcpTool: MCPTool) {
    this.client = client;
    this.rawName = mcpTool.name;
    this.name = client.serverName + '__' + mcpTool.name;
    this.description = '[MCP:' + client.serverName + '] ' + mcpTool.description;
    this.parameters = (mcpTool.inputSchema as ToolFunctionDefinition['parameters']) ?? {
      type: 'object',
      properties: {},
    };
  }

  public getRawName(): string {
    return this.rawName;
  }

  public getServerName(): string {
    return this.client.serverName;
  }

  public async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const result = await this.client.callTool(this.rawName, args);

      const mcpResult = result as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      const text =
        mcpResult.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n') ?? JSON.stringify(result);

      if (mcpResult.isError) {
        logger.warn('MCP tool "' + this.name + '" returned an error: ' + text);
        return { success: false, error: text };
      }

      return { success: true, data: text };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('MCPToolAdapter "' + this.name + '" execution error: ' + msg);
      return { success: false, error: msg };
    }
  }

  public toDefinition(): { type: 'function'; function: ToolFunctionDefinition } {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}

export async function buildMCPAdapters(
  config: MCPServerConfig
): Promise<{ client: MCPClient; tools: MCPToolAdapter[] }> {
  const client = new MCPClient(config);
  await client.connect();
  const mcpTools = await client.listTools();
  logger.info('MCP server "' + config.name + '" exposed ' + mcpTools.length + ' tools.');
  const tools = mcpTools.map((t) => new MCPToolAdapter(client, t));
  return { client, tools };
}