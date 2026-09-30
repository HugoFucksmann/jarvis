import { ChatMessage } from '../llm/types.js';

export class ShortTermMemory {
  private sessions: Map<string, ChatMessage[]> = new Map();
  private maxMessagesPerSession: number;

  constructor(maxMessagesPerSession: number = 30) {
    this.maxMessagesPerSession = maxMessagesPerSession;
  }

  public addMessage(sessionId: string, message: ChatMessage): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    const history = this.sessions.get(sessionId)!;
    history.push(message);

    // Prune oldest non-system messages if length exceeds max
    if (history.length > this.maxMessagesPerSession) {
      // Keep system messages intact if at index 0
      if (history[0].role === 'system') {
        const systemMsg = history[0];
        const trimmed = history.slice(history.length - this.maxMessagesPerSession + 1);
        this.sessions.set(sessionId, [systemMsg, ...trimmed]);
      } else {
        this.sessions.set(sessionId, history.slice(-this.maxMessagesPerSession));
      }
    }
  }

  public getMessages(sessionId: string, limit?: number): ChatMessage[] {
    const list = this.sessions.get(sessionId) || [];
    if (limit && limit > 0) {
      return list.slice(-limit);
    }
    return [...list];
  }

  public clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
