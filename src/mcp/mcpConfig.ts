import { MCPServerConfig } from './MCPClient.js';

/**
 * Returns the list of MCP server configurations to connect to.
 *
 * SECURITY: OAuth credentials are read from environment variables here
 * and forwarded only to the child process. They are NEVER passed to the LLM
 * or exposed in tool definitions.
 *
 * To add a new MCP server, add a new entry to this array.
 */
export function getMCPServerConfigs(): MCPServerConfig[] {
  const configs: MCPServerConfig[] = [];

  // ─── Google Workspace (Gmail, Calendar, Drive) ────────────────────────────
  // Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
  // Run auth once with: npx mcp-google-multi auth --account default
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (googleClientId && googleClientSecret) {
    configs.push({
      name: 'google',
      command: 'npx',
      args: ['-y', 'mcp-google-multi'],
      env: {
        GOOGLE_CLIENT_ID: googleClientId,
        GOOGLE_CLIENT_SECRET: googleClientSecret,
        // Optional: restrict which services are loaded (comma-separated).
        // Remove or extend to add more Google services.
        MCP_GOOGLE_SERVICES: process.env.MCP_GOOGLE_SERVICES ?? 'gmail,calendar,drive',
      },
    });
  }

  // ─── Add more MCP servers here ────────────────────────────────────────────
  // Example:
  // if (process.env.GITHUB_TOKEN) {
  //   configs.push({
  //     name: 'github',
  //     command: 'npx',
  //     args: ['-y', '@modelcontextprotocol/server-github'],
  //     env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
  //   });
  // }

  return configs;
}
