import { RiskLevel, AuditLogEntry, ITool } from '../types.js';
import { Logger } from '../../logger/Logger.js';
import fs from 'fs';
import path from 'path';

export interface PermissionPolicy {
  autoApproveLowRisk: boolean;
  autoApproveMediumRisk: boolean;
  autoApproveHighRisk: boolean;
}

export class PermissionManager {
  private policy: PermissionPolicy;
  private logger = new Logger('PermissionManager');
  private auditLog: AuditLogEntry[] = [];
  private auditFilePath: string;

  constructor(policy: PermissionPolicy, workspaceRoot: string) {
    this.policy = policy;
    const auditDir = path.join(workspaceRoot, '.jarvis', 'logs');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    this.auditFilePath = path.join(auditDir, 'audit.jsonl');
  }

  /**
   * Determine the effective risk level for a tool execution.
   * Can escalate risk depending on parameters (e.g. dangerous terminal commands).
   */
  public evaluateRisk(tool: ITool, args: Record<string, unknown>): { riskLevel: RiskLevel; reason: string } {
    let effectiveRisk = tool.riskLevel;
    let reason = `Standard risk level for ${tool.name}`;

    // Dynamic escalation for terminal commands
    if (tool.name === 'run_command' && typeof args.command === 'string') {
      const cmd = args.command.toLowerCase();
      const dangerousPatterns = [
        'rmdir', 'del /', 'del /f', 'del /s', 'rm -rf', 'format',
        'diskpart', 'reg delete', 'drop table', 'shutdown',
        'kill', 'stop-process', 'remove-item', 'net user',
      ];

      for (const pattern of dangerousPatterns) {
        if (cmd.includes(pattern)) {
          effectiveRisk = RiskLevel.HIGH;
          reason = `Command contains potentially destructive keyword: "${pattern}"`;
          break;
        }
      }
    }

    // Dynamic escalation for file modifications
    if (tool.name === 'delete_file') {
      effectiveRisk = RiskLevel.HIGH;
      reason = 'File deletion is a destructive operation';
    }

    return { riskLevel: effectiveRisk, reason };
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

    this.logger.info(`Requesting user approval for ${tool.name} (Risk: ${riskLevel})`);
    const approved = await requestUserApproval(tool.name, args, riskLevel, reason);

    if (approved) {
      return { authorized: true, mode: 'manual' };
    } else {
      return { authorized: false, reason: 'Action was denied by user', mode: 'rejected' };
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
