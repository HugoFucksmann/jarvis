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
import { TakeScreenshotTool, AnalyzeImageTool } from './visionTools.js';
import { MediaControlTool } from './mediaTools.js';
import { ScheduleTaskTool } from './schedulerTools.js';
import {
  DelegateSubagentTool,
  ListSubagentsTool,
  GetSubagentOutputTool,
  CancelSubagentTool,
} from './subagentTools.js';
import { BrowseWebTool } from './browserNavigationTools.js';
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
    new BrowseWebTool(),

    // System Control & OS Hardware tools
    new ClipboardTool(),
    new VolumeControlTool(),
    new NotificationTool(),
    new SystemPowerTool(),

    // GUI Automation & Window Management tools (Phase 2)
    new InputSimulationTool(),
    new WindowControlTool(),

    // Visual Perception & Screen Capture tools (Phase 3)
    new TakeScreenshotTool(),
    new AnalyzeImageTool(),

    // Media & Music Control tools (Phase 6 - Spotify & YouTube)
    new MediaControlTool(),

    // Scheduler, Reminders & Sticky Notes (Phase 7)
    new ScheduleTaskTool(),

    // Background Subagents & Asynchronous Workers (Phase 8)
    new DelegateSubagentTool(),
    new ListSubagentsTool(),
    new GetSubagentOutputTool(),
    new CancelSubagentTool(),

    // Persistent cross-chat memory tool
    new ManageMemoryTool(),
  ];

  if (config.features.webSearchEnabled) {
    tools.push(new WebSearchTool());
  }

  return tools;
}
