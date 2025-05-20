import { SessionEnv } from './session-env.js';

export class SessionEnvManager {
  private sessions: Map<string, SessionEnv> = new Map();
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos
  private readonly MAX_SESSIONS = 1000;

  constructor() {
    setInterval(() => this.cleanupSessions(), 10 * 60 * 1000);
    console.log(`[SESSION_MANAGER] Initialized with timeout ${this.SESSION_TIMEOUT}ms`);
  }

  getOrCreateSession(userId?: string, productLabUserId?: string): SessionEnv {
    this.checkSessionLimits();
    if (userId) {
      const existingUserSessions = [...this.sessions.values()]
        .filter(s => s.userId === userId);
      if (existingUserSessions.length > 0) {
        const session = existingUserSessions[0];
        session.lastAccessTime = new Date();
        return session;
      }
    }
    const session = new SessionEnv(userId, productLabUserId);
    this.sessions.set(session.sessionId, session);
    this.setSessionTimeout(session.sessionId);
    return session;
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  private setSessionTimeout(sessionId: string) {
    if (this.sessionTimeouts.has(sessionId)) {
      clearTimeout(this.sessionTimeouts.get(sessionId)!);
    }
    this.sessionTimeouts.set(sessionId, setTimeout(() => {
      this.sessions.delete(sessionId);
      this.sessionTimeouts.delete(sessionId);
      console.log(`[SESSION_MANAGER] Session ${sessionId} expired and removed.`);
    }, this.SESSION_TIMEOUT));
  }

  private cleanupSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastAccessTime.getTime() > this.SESSION_TIMEOUT) {
        this.sessions.delete(sessionId);
        this.sessionTimeouts.delete(sessionId);
        console.log(`[SESSION_MANAGER] Session ${sessionId} cleaned up due to inactivity.`);
      }
    }
  }

  private checkSessionLimits() {
    if (this.sessions.size >= this.MAX_SESSIONS) {
      // Remove oldest session
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastAccessTime.getTime() - b.lastAccessTime.getTime())[0];
      if (oldest) {
        this.sessions.delete(oldest.sessionId);
        this.sessionTimeouts.delete(oldest.sessionId);
        console.log(`[SESSION_MANAGER] Max sessions reached. Oldest session ${oldest.sessionId} removed.`);
      }
    }
  }
}

export const sessionEnvManager = new SessionEnvManager(); 