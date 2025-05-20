import { UserJiraCredentials } from './types.js';

const sessionSecrets = new Map<string, UserJiraCredentials>();

export function saveSessionSecret(sessionId: string, creds: UserJiraCredentials) {
  sessionSecrets.set(sessionId, creds);
}

export function getSessionSecret(sessionId: string): UserJiraCredentials | undefined {
  return sessionSecrets.get(sessionId);
}

export function deleteSessionSecret(sessionId: string) {
  sessionSecrets.delete(sessionId);
} 