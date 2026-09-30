import { ChatMessage } from '../llm/types.js';

export interface MemoryFact {
  id: string;
  category: 'preference' | 'project' | 'environment' | 'general';
  content: string;
  createdAt: string;
  updatedAt: string;
  confidence?: number;
}

export interface IMemoryStore {
  saveShortTermMessage(sessionId: string, message: ChatMessage): Promise<void>;
  getShortTermMessages(sessionId: string, limit?: number): Promise<ChatMessage[]>;
  clearShortTerm(sessionId: string): Promise<void>;

  addLongTermFact(category: MemoryFact['category'], content: string): Promise<MemoryFact>;
  queryLongTermFacts(query?: string, category?: string): Promise<MemoryFact[]>;
  deleteLongTermFact(id: string): Promise<boolean>;

  // Vector embedding hook for future RAG extension
  searchSimilar?(query: string, limit?: number): Promise<MemoryFact[]>;
}
