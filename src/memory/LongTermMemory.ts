import fs from 'fs';
import path from 'path';
import { MemoryFact } from './types.js';
import { Logger } from '../logger/Logger.js';

export class LongTermMemory {
  private facts: MemoryFact[] = [];
  private filePath: string;
  private logger = new Logger('LongTermMemory');

  constructor(workspaceRoot: string) {
    const memoryDir = path.join(workspaceRoot, '.jarvis', 'memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    this.filePath = path.join(memoryDir, 'facts.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.facts = JSON.parse(raw);
        this.logger.debug(`Loaded ${this.facts.length} long-term facts.`);
      }
    } catch (err) {
      this.logger.error(`Failed to load long-term facts: ${String(err)}`);
      this.facts = [];
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.facts, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to save long-term facts: ${String(err)}`);
    }
  }

  /**
   * Sanitizes text to prevent storing credentials or sensitive data
   */
  private isSensitive(text: string): boolean {
    const sensitivePatterns = [
      /bearer\s+[a-zA-Z0-9_\-\.]+/i,
      /api[_\-]?key\s*[:=]\s*[a-zA-Z0-9_\-]+/i,
      /password\s*[:=]\s*\S+/i,
      /secret\s*[:=]\s*\S+/i,
      /ghp_[a-zA-Z0-9]+/i,
    ];
    return sensitivePatterns.some((p) => p.test(text));
  }

  public addFact(category: MemoryFact['category'], content: string): MemoryFact | null {
    if (this.isSensitive(content)) {
      this.logger.warn('Blocked attempt to store potentially sensitive information in long-term memory.');
      return null;
    }

    // Check for duplicates
    const existing = this.facts.find((f) => f.content.toLowerCase() === content.toLowerCase());
    if (existing) {
      existing.updatedAt = new Date().toISOString();
      this.save();
      return existing;
    }

    const newFact: MemoryFact = {
      id: `fact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      category,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.facts.push(newFact);
    this.save();
    this.logger.info(`Stored new long-term fact: [${category}] ${content.substring(0, 60)}...`);
    return newFact;
  }

  public query(queryText?: string, category?: string): MemoryFact[] {
    let result = [...this.facts];

    if (category) {
      result = result.filter((f) => f.category === category);
    }

    if (queryText && queryText.trim()) {
      const terms = queryText.toLowerCase().split(/\s+/);
      result = result.filter((f) => {
        const lower = f.content.toLowerCase();
        return terms.some((t) => lower.includes(t));
      });
    }

    return result;
  }

  public deleteFact(id: string): boolean {
    const initialLen = this.facts.length;
    this.facts = this.facts.filter((f) => f.id !== id);
    if (this.facts.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public getAll(): MemoryFact[] {
    return [...this.facts];
  }
}
