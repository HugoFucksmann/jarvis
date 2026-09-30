import { ITool, RiskLevel, ToolExecutionContext, ToolResult } from './types.js';
import { ToolFunctionDefinition } from '../llm/types.js';

export abstract class BaseTool implements ITool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly riskLevel: RiskLevel;
  abstract readonly requiredPermissions: string[];
  abstract readonly parameters: ToolFunctionDefinition['parameters'];

  abstract execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;

  toDefinition(): { type: 'function'; function: ToolFunctionDefinition } {
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
