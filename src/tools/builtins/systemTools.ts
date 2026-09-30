import { BaseTool } from '../Tool.js';
import { RiskLevel, ToolExecutionContext, ToolResult } from '../types.js';
import os from 'os';
import { execSync } from 'child_process';

export class GetCurrentTimeTool extends BaseTool {
  readonly name = 'get_current_time';
  readonly description = 'Obtiene la fecha, hora actual y zona horaria del sistema.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = [];
  readonly parameters = {
    type: 'object' as const,
    properties: {},
  };

  async execute(_args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
    const now = new Date();
    return {
      success: true,
      data: {
        iso: now.toISOString(),
        localeString: now.toLocaleString(),
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: now.getTime(),
      },
    };
  }
}

export class GetSystemInfoTool extends BaseTool {
  readonly name = 'get_system_info';
  readonly description = 'Obtiene información sobre el sistema operativo, CPU, memoria RAM, GPU y almacenamiento.';
  readonly riskLevel = RiskLevel.LOW;
  readonly requiredPermissions = [];
  readonly parameters = {
    type: 'object' as const,
    properties: {},
  };

  async execute(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const cpus = os.cpus();
    const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
    const freeMem = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
    const usedMem = Math.round((totalMem - freeMem) * 10) / 10;

    let gpuInfo = 'No detectada';
    try {
      if (process.platform === 'win32') {
        const out = execSync('powershell -Command "(Get-CimInstance Win32_VideoController).Name"', { encoding: 'utf-8', timeout: 3000 });
        gpuInfo = out.trim().split('\r\n').filter(Boolean).join(', ');
      }
    } catch {
      // GPU detection fallback
    }

    return {
      success: true,
      data: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        userInfo: os.userInfo().username,
        cpu: {
          model: cpus.length > 0 ? cpus[0].model.trim() : 'Unknown',
          cores: cpus.length,
        },
        memory: {
          totalGB: totalMem,
          freeGB: freeMem,
          usedGB: usedMem,
          usagePercentage: Math.round((usedMem / totalMem) * 100),
        },
        gpu: gpuInfo,
        uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10,
        workingDirectory: context.workspaceRoot,
      },
    };
  }
}
