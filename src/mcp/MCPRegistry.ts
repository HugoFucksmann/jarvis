import { MCPServerConfig } from './MCPClient.js';
import { buildMCPAdapters } from './MCPToolAdapter.js';
import { MCPClient } from './MCPClient.js';
import { MCPToolAdapter } from './MCPToolAdapter.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { Logger } from '../logger/Logger.js';

const logger = new Logger('MCPRegistry');

export class MCPRegistry {
  private clients = new Map<string, MCPClient>();
  private adapters = new Map<string, MCPToolAdapter[]>();

  public async init(
    configs: MCPServerConfig[],
    _registry?: ToolRegistry
  ): Promise<void> {
    for (const cfg of configs) {
      try {
        const { client, tools } = await buildMCPAdapters(cfg);
        this.clients.set(cfg.name, client);
        this.adapters.set(cfg.name, tools);

        logger.info(
          `MCP server "${cfg.name}" connected with ${tools.length} tools.`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to initialize MCP server "${cfg.name}": ${msg}`);
      }
    }
  }

  public getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  public getTools(serverName: string): MCPToolAdapter[] {
    return this.adapters.get(serverName) ?? [];
  }

  public getTool(
    serverName: string,
    toolName: string
  ): MCPToolAdapter | undefined {
    return this.getTools(serverName).find((tool) => tool.name === toolName);
  }

  public getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }

  public getAllTools(): MCPToolAdapter[] {
    return Array.from(this.adapters.values()).flat();
  }

  public async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.disconnect();
      } catch {
        // best effort
      }
    }

    this.clients.clear();
    this.adapters.clear();
  }
}