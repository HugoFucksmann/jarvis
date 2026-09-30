import fs from 'fs';
import path from 'path';
import { MemoryFact } from './types.js';
import { Logger } from '../logger/Logger.js';

/**
 * LongTermMemory — Unified persistent memory manager backed exclusively
 * by `.jarvis/MEMORY.md`. Eliminates split-brain inconsistency with separate JSON files.
 */
export class LongTermMemory {
  private filePath: string;
  private logger = new Logger('LongTermMemory');

  constructor(workspaceRoot: string) {
    const jarvisDir = path.join(workspaceRoot, '.jarvis');
    if (!fs.existsSync(jarvisDir)) {
      fs.mkdirSync(jarvisDir, { recursive: true });
    }
    this.filePath = path.join(jarvisDir, 'MEMORY.md');
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    if (!fs.existsSync(this.filePath)) {
      const initialContent = `# J.A.R.V.I.S. — Memoria General Persistente\n\n`;
      fs.writeFileSync(this.filePath, initialContent, 'utf-8');
      this.logger.info(`Initialized persistent memory at ${this.filePath}`);
    }
  }

  public getRawContent(): string {
    try {
      if (fs.existsSync(this.filePath)) {
        return fs.readFileSync(this.filePath, 'utf-8');
      }
    } catch (err) {
      this.logger.error(`Failed to read MEMORY.md: ${String(err)}`);
    }
    return '';
  }

  public saveRawContent(content: string): void {
    try {
      fs.writeFileSync(this.filePath, content, 'utf-8');
      this.logger.debug(`Saved MEMORY.md (${content.length} chars)`);
    } catch (err) {
      this.logger.error(`Failed to save MEMORY.md: ${String(err)}`);
    }
  }

  public appendNote(note: string, section?: string): void {
    const trimmed = note.trim();
    if (!trimmed) return;
    let current = this.getRawContent();
    if (!current.trim()) {
      current = '# J.A.R.V.I.S. — Memoria General Persistente\n';
    }

    if (section) {
      const sectionHeader = `### ${section}`;
      if (current.includes(sectionHeader)) {
        current = current.replace(sectionHeader, `${sectionHeader}\n- ${trimmed}`);
      } else {
        current += `\n${sectionHeader}\n- ${trimmed}\n`;
      }
    } else {
      current += `\n- ${trimmed}\n`;
    }
    this.saveRawContent(current);
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
      this.logger.warn('Blocked attempt to store potentially sensitive information in memory.');
      return null;
    }

    const sectionName =
      category === 'preference'
        ? 'Preferencias'
        : category === 'project'
        ? 'Proyectos'
        : category === 'environment'
        ? 'Entorno'
        : 'Notas';

    this.appendNote(content, sectionName);

    const fact: MemoryFact = {
      id: `fact_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      category,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.logger.info(`Stored persistent memory under [${sectionName}]: ${content.substring(0, 60)}...`);
    return fact;
  }

  public query(queryText?: string, category?: string): MemoryFact[] {
    const content = this.getRawContent();
    const lines = content.split('\n');
    const facts: MemoryFact[] = [];
    let currentCategory: MemoryFact['category'] = 'general';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('###')) {
        const lowerHeader = line.toLowerCase();
        if (lowerHeader.includes('pref')) currentCategory = 'preference';
        else if (lowerHeader.includes('proy') || lowerHeader.includes('proj')) currentCategory = 'project';
        else if (lowerHeader.includes('entorn') || lowerHeader.includes('env')) currentCategory = 'environment';
        else currentCategory = 'general';
        continue;
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const text = line.substring(2).trim();
        if (text) {
          facts.push({
            id: `line_${i}`,
            category: currentCategory,
            content: text,
            createdAt: '',
            updatedAt: '',
          });
        }
      }
    }

    let result = facts;
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
    if (id.startsWith('line_')) {
      const lineIdx = parseInt(id.replace('line_', ''), 10);
      const content = this.getRawContent();
      const lines = content.split('\n');
      if (lineIdx >= 0 && lineIdx < lines.length) {
        lines.splice(lineIdx, 1);
        this.saveRawContent(lines.join('\n'));
        return true;
      }
    }
    return false;
  }

  public getAll(): MemoryFact[] {
    return this.query();
  }
}
