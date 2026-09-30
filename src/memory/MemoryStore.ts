import { IMemoryStore, MemoryFact } from './types.js';
import { ShortTermMemory } from './ShortTermMemory.js';
import { LongTermMemory } from './LongTermMemory.js';
import { ChatMessage } from '../llm/types.js';

export class MemoryStore implements IMemoryStore {
  private shortTerm: ShortTermMemory;
  private longTerm: LongTermMemory;

  constructor(workspaceRoot: string) {
    this.shortTerm = new ShortTermMemory(30);
    this.longTerm = new LongTermMemory(workspaceRoot);
  }

  public async saveShortTermMessage(sessionId: string, message: ChatMessage): Promise<void> {
    this.shortTerm.addMessage(sessionId, message);
  }

  public async getShortTermMessages(sessionId: string, limit?: number): Promise<ChatMessage[]> {
    return this.shortTerm.getMessages(sessionId, limit);
  }

  public async clearShortTerm(sessionId: string): Promise<void> {
    this.shortTerm.clear(sessionId);
  }

  public async addLongTermFact(category: MemoryFact['category'], content: string): Promise<MemoryFact> {
    const fact = this.longTerm.addFact(category, content);
    if (!fact) {
      throw new Error('Fact rejected due to safety or duplication policy.');
    }
    return fact;
  }

  public async queryLongTermFacts(query?: string, category?: string): Promise<MemoryFact[]> {
    return this.longTerm.query(query, category);
  }

  public async deleteLongTermFact(id: string): Promise<boolean> {
    return this.longTerm.deleteFact(id);
  }

  public async getRawPersistentMemory(): Promise<string> {
    return this.longTerm.getRawContent();
  }

  public async saveRawPersistentMemory(content: string): Promise<void> {
    this.longTerm.saveRawContent(content);
  }

  public async appendPersistentNote(content: string, section?: string): Promise<void> {
    this.longTerm.appendNote(content, section);
  }

  // Prepared for Vector DB embeddings
  public async searchSimilar(query: string, limit: number = 5): Promise<MemoryFact[]> {
    return this.longTerm.query(query).slice(0, limit);
  }
}
