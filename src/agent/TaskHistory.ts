import fs from 'fs';
import path from 'path';

export interface TaskRecord {
  id: string;
  timestamp: string;
  prompt: string;
  success: boolean;
  toolCallsCount: number;
  toolsUsed: string[];
  durationMs: number;
  summary: string;
}

export class TaskHistory {
  private filePath: string;
  private tasks: TaskRecord[] = [];

  constructor(workspaceRoot: string) {
    const jarvisDir = path.join(workspaceRoot, '.jarvis');
    if (!fs.existsSync(jarvisDir)) {
      fs.mkdirSync(jarvisDir, { recursive: true });
    }
    this.filePath = path.join(jarvisDir, 'tasks.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.tasks = JSON.parse(raw);
      }
    } catch {
      this.tasks = [];
    }
  }

  private save(): void {
    try {
      // Keep up to 100 recent tasks
      if (this.tasks.length > 100) {
        this.tasks = this.tasks.slice(-100);
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.tasks, null, 2), 'utf-8');
    } catch {
      // ignore write errors
    }
  }

  public recordTask(task: TaskRecord): void {
    // Avoid duplicate immediate entries
    const last = this.tasks[this.tasks.length - 1];
    if (last && last.prompt === task.prompt && Date.now() - new Date(last.timestamp).getTime() < 3000) {
      return;
    }
    this.tasks.push(task);
    this.save();
  }

  public getRecentTasks(limit: number = 30): TaskRecord[] {
    return [...this.tasks].reverse().slice(0, limit);
  }

  public clearTasks(): void {
    this.tasks = [];
    this.save();
  }
}
