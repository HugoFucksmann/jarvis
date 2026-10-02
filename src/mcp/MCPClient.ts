import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Logger } from '../logger/Logger.js';

export interface MCPServerConfig {
  /** Unique name for this MCP server (e.g. "google") */
  name: string;
  /** Command to launch the MCP server process (e.g. "npx") */
  command: string;
  /** Arguments passed to the command */
  args: string[];
  /** Extra environment variables for the server process.
   *  NEVER include secrets that should reach the LLM — they stay here only. */
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Thin wrapper around the official MCP SDK Client.
 * Handles connection lifecycle and exposes tool discovery + invocation.
 */
export class MCPClient {
  private client: Client;
  private transport: StdioClientTransport;
  private logger: Logger;
  private connected = false;
  readonly serverName: string;

  constructor(config: MCPServerConfig) {
    this.serverName = config.name;
    this.logger = new Logger('MCPClient:' + config.name);

    // Build safe env: merge process.env but allow overrides from config.
    // Secrets (GOOGLE_CLIENT_ID, etc.) come from config.env — they are
    // passed only to the child process, never surfaced to the LLM.
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) childEnv[k] = v;
    }
    if (config.env) {
      Object.assign(childEnv, config.env);
    }

    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: childEnv,
    });

    this.client = new Client(
      { name: 'jarvis-mcp-client', version: '1.0.0' },
      { capabilities: {} }
    );
  }

  public async connect(): Promise<void> {
    if (this.connected) return;
    this.logger.info('Connecting to MCP server "' + this.serverName + '"...');
    await this.client.connect(this.transport);
    this.connected = true;
    this.logger.info('MCP server "' + this.serverName + '" connected.');
  }

  public async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
    this.logger.info('MCP server "' + this.serverName + '" disconnected.');
  }

  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Discover all tools exposed by the MCP server.
   * Does NOT include secrets or tokens in the returned schema.
   */
  public async listTools(): Promise<MCPTool[]> {
    this.ensureConnected();
    const response = await this.client.listTools();
    return response.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  /**
   * Call a tool on the MCP server.
   * Returns the raw content array from the MCP response.
   */
  public async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    this.ensureConnected();
    this.logger.info('Calling MCP tool "' + toolName + '" on server "' + this.serverName + '"');
    const result = await this.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('MCPClient "' + this.serverName + '" is not connected. Call connect() first.');
    }
  }
}

