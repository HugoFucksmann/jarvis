import { ITool } from '../types.js';
import { GetCurrentTimeTool, GetSystemInfoTool } from './systemTools.js';
import {
  ListFilesTool,
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  SearchFilesTool,
  DeleteFileTool,
} from './fileTools.js';
import { RunCommandTool, GetProcessesTool } from './terminalTools.js';
import { OpenUrlTool, OpenApplicationTool } from './browserTools.js';
import { WebSearchTool } from './webSearchTools.js';
import { ManageMemoryTool } from './memoryTools.js';
import {
  ClipboardTool,
  VolumeControlTool,
  NotificationTool,
  SystemPowerTool,
} from './systemControlTools.js';
import { InputSimulationTool } from './guiAutomationTools.js';
import { WindowControlTool } from './windowControlTools.js';
import { config } from '../../config/index.js';

export function getBuiltinTools(): ITool[] {
  const tools: ITool[] = [
    // System tools
    new GetCurrentTimeTool(),
    new GetSystemInfoTool(),

    // File tools
    new ListFilesTool(),
    new ReadFileTool(),
    new WriteFileTool(),
    new EditFileTool(),
    new SearchFilesTool(),
    new DeleteFileTool(),

    // Terminal tools
    new RunCommandTool(),
    new GetProcessesTool(),

    // Browser & Applications tools
    new OpenUrlTool(),
    new OpenApplicationTool(),

    // System Control & OS Hardware tools
    new ClipboardTool(),
    new VolumeControlTool(),
    new NotificationTool(),
    new SystemPowerTool(),

    // GUI Automation & Window Management tools (Phase 2)
    new InputSimulationTool(),
    new WindowControlTool(),

    // Persistent cross-chat memory tool
    new ManageMemoryTool(),
  ];

  if (config.features.webSearchEnabled) {
    tools.push(new WebSearchTool());
  }

  return tools;
}
