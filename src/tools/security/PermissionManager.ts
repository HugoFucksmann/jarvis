import { RiskLevel, AuditLogEntry, ITool } from '../types.js';
import { Logger } from '../../logger/Logger.js';
import fs from 'fs';
import path from 'path';

export interface PermissionPolicy {
  autoApproveLowRisk: boolean;
  autoApproveMediumRisk: boolean;
  autoApproveHighRisk: boolean;
}

export interface SecurityRules {
  autoApproveSafeCommands: boolean;
  restrictedCommandPatterns: string[];
  restrictedTools: string[];
}

export class PermissionManager {
  private policy: PermissionPolicy;
  private logger = new Logger('PermissionManager');
  private auditLog: AuditLogEntry[] = [];
  private auditFilePath: string;
  private permissionsFilePath: string;
  private securityRules: SecurityRules;

  constructor(policy: PermissionPolicy, workspaceRoot: string) {
    this.policy = policy;

    const jarvisDir = path.join(workspaceRoot, '.jarvis');
    const logsDir = path.join(jarvisDir, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    this.auditFilePath = path.join(logsDir, 'audit.jsonl');
    this.permissionsFilePath = path.join(jarvisDir, 'permissions.json');

    this.securityRules = this.loadSecurityRules();
  }

  /**
   * Load security rules from .jarvis/permissions.json or initialize with defaults
   */
  private loadSecurityRules(): SecurityRules {
    const defaultRules: SecurityRules = {
      autoApproveSafeCommands: true,
      restrictedCommandPatterns: [
        'del',
        'del /',
        'del /f',
        'del /s',
        'rmdir',
        'rm -rf',
        'rm -r',
        'remove-item',
        'unlink',
        'erase',
        'format',
        'diskpart',
        'reg delete',
        'drop table',
        'shutdown',
        'kill',
        'stop-process',
        'taskkill',
        'net user',
        'net localgroup',
        'mkfs',
        'fdisk',
      ],
      restrictedTools: ['delete_file'],
    };

    try {
      if (fs.existsSync(this.permissionsFilePath)) {
        const raw = fs.readFileSync(this.permissionsFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          autoApproveSafeCommands: parsed.autoApproveSafeCommands !== false,
          restrictedCommandPatterns: Array.isArray(parsed.restrictedCommandPatterns)
            ? parsed.restrictedCommandPatterns
            : defaultRules.restrictedCommandPatterns,
          restrictedTools: Array.isArray(parsed.restrictedTools)
            ? parsed.restrictedTools
            : defaultRules.restrictedTools,
        };
      } else {
        fs.writeFileSync(this.permissionsFilePath, JSON.stringify(defaultRules, null, 2), 'utf-8');
        return defaultRules;
      }
    } catch (err) {
      this.logger.error(`Error loading permissions.json: ${String(err)}. Using default rules.`);
      return defaultRules;
    }
  }

  /**
   * Save updated security rules to file
   */
  public saveSecurityRules(rules: Partial<SecurityRules>): SecurityRules {
    this.securityRules = {
      ...this.securityRules,
      ...rules,
    };

    try {
      fs.writeFileSync(this.permissionsFilePath, JSON.stringify(this.securityRules, null, 2), 'utf-8');
      this.logger.info('Security rules updated and persisted to .jarvis/permissions.json');
    } catch (err) {
      this.logger.error(`Error saving permissions.json: ${String(err)}`);
    }

    return this.securityRules;
  }

  public getSecurityRules(): SecurityRules {
    return this.securityRules;
  }

  /**
   * Determine the effective risk level for a tool execution.
   */
  public evaluateRisk(tool: ITool, args: Record<string, unknown>): { riskLevel: RiskLevel; reason: string } {
    // Check if tool itself is in restrictedTools list
    if (this.securityRules.restrictedTools.includes(tool.name)) {
      return {
        riskLevel: RiskLevel.HIGH,
        reason: `La herramienta "${tool.name}" está explícitamente en la lista de autorización requerida.`,
      };
    }

    // Dynamic evaluation for terminal commands
    if (tool.name === 'run_command' && typeof args.command === 'string') {
      const cmd = args.command.trim().toLowerCase();

      // Check if command matches any restricted pattern
      for (const pattern of this.securityRules.restrictedCommandPatterns) {
        const p = pattern.trim().toLowerCase();
        if (!p) continue;

        // Whole word or substring match
        let isMatch = false;
        if (p.includes(' ') || p.includes('-') || p.includes('/')) {
          isMatch = cmd.includes(p);
        } else {
          // Word boundary match (e.g. "del" should not match "delivery")
          const regex = new RegExp(`(^|\\s|[;&|])${p}($|\\s|[;&|])`, 'i');
          isMatch = regex.test(cmd);
        }

        if (isMatch) {
          return {
            riskLevel: RiskLevel.HIGH,
            reason: `El comando contiene la instrucción restringida: "${pattern}"`,
          };
        }
      }

      // If safe commands are auto-approved, treat normal commands as LOW risk
      if (this.securityRules.autoApproveSafeCommands) {
        return {
          riskLevel: RiskLevel.LOW,
          reason: 'Comando estándar auto-aprobado (no restringido).',
        };
      }
    }

    // Default to the tool's defined risk level
    return {
      riskLevel: tool.riskLevel,
      reason: `Nivel de riesgo estándar para ${tool.name}`,
    };
  }

  /**
   * Checks if execution is authorized or requests user approval
   */
  public async authorize(
    tool: ITool,
    args: Record<string, unknown>,
    requestUserApproval?: (toolName: string, args: Record<string, unknown>, risk: RiskLevel, reason: string) => Promise<boolean>
  ): Promise<{ authorized: boolean; reason?: string; mode: 'automatic' | 'manual' | 'rejected' }> {
    const { riskLevel, reason } = this.evaluateRisk(tool, args);

    // Check automatic policy
    if (riskLevel === RiskLevel.LOW && this.policy.autoApproveLowRisk) {
      return { authorized: true, mode: 'automatic' };
    }

    if (riskLevel === RiskLevel.MEDIUM && this.policy.autoApproveMediumRisk) {
      return { authorized: true, mode: 'automatic' };
    }

    if (riskLevel === RiskLevel.HIGH && this.policy.autoApproveHighRisk) {
      return { authorized: true, mode: 'automatic' };
    }

    // Manual approval required
    if (!requestUserApproval) {
      this.logger.warn(`No approval callback provided for ${riskLevel} risk tool: ${tool.name}. Rejecting.`);
      return {
        authorized: false,
        reason: `Execution requires approval for risk level [${riskLevel}]: ${reason}`,
        mode: 'rejected',
      };
    }

    this.logger.info(`Requesting user approval for ${tool.name} (Risk: ${riskLevel}): ${reason}`);
    const approved = await requestUserApproval(tool.name, args, riskLevel, reason);

    if (approved) {
      return { authorized: true, mode: 'manual' };
    } else {
      return { authorized: false, reason: 'Acción rechazada por el usuario', mode: 'rejected' };
    }
  }

  /**
   * Record audit log
   */
  public recordAudit(entry: AuditLogEntry): void {
    this.auditLog.push(entry);
    this.logger.audit(entry.toolName, {
      riskLevel: entry.riskLevel,
      approved: entry.approved,
      mode: entry.approvalMode,
      success: entry.success,
      error: entry.error,
    });

    try {
      fs.appendFileSync(this.auditFilePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to write to audit log file: ${String(err)}`);
    }
  }

  public getRecentAudit(limit: number = 50): AuditLogEntry[] {
    return this.auditLog.slice(-limit);
  }
}
