import { UserSession } from './user-session.js';

export class SessionManager {
  private sessions: Map<string, UserSession> = new Map();
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos

  constructor() {
    // Iniciar limpeza periódica
    setInterval(() => this.cleanupSessions(), 10 * 60 * 1000);
  }

  getOrCreateSession(userId: string, productLabUserId?: string): UserSession {
    const sessionId = `session_${userId}`;
    if (this.sessions.has(sessionId)) {
      this.refreshSessionTimeout(sessionId);
      return this.sessions.get(sessionId)!;
    }
    const newSession = new UserSession(userId, productLabUserId);
    this.sessions.set(sessionId, newSession);
    this.refreshSessionTimeout(sessionId);
    return newSession;
  }

  private refreshSessionTimeout(sessionId: string): void {
    if (this.sessionTimeouts.has(sessionId)) {
      clearTimeout(this.sessionTimeouts.get(sessionId)!);
    }
    const timeout = setTimeout(() => {
      console.log(`[SESSION] Expiring inactive session: ${sessionId}`);
      this.sessions.get(sessionId)?.cleanup();
      this.sessions.delete(sessionId);
      this.sessionTimeouts.delete(sessionId);
    }, this.SESSION_TIMEOUT);
    this.sessionTimeouts.set(sessionId, timeout);
  }

  private cleanupSessions(): void {
    console.log(`[SESSION] Running session cleanup, current count: ${this.sessions.size}`);
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastAccessTime > this.SESSION_TIMEOUT) {
        console.log(`[SESSION] Cleaning up inactive session: ${sessionId}`);
        session.cleanup();
        this.sessions.delete(sessionId);
        if (this.sessionTimeouts.has(sessionId)) {
          clearTimeout(this.sessionTimeouts.get(sessionId)!);
          this.sessionTimeouts.delete(sessionId);
        }
      }
    }
  }
} 