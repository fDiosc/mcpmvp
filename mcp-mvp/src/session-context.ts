import { AsyncLocalStorage } from 'async_hooks';
import { SessionEnv } from './session-env.js';

export const sessionStorage = new AsyncLocalStorage<SessionEnv>();

export function getCurrentSession(): SessionEnv | undefined {
  return sessionStorage.getStore();
}

export function assertSession(): SessionEnv {
  const session = getCurrentSession();
  if (!session) {
    throw new Error('Contexto de sessão não disponível - verifique se está sendo executado dentro de AsyncLocalStorage');
  }
  return session;
}

export async function runWithSession<T>(
  session: SessionEnv,
  callback: () => Promise<T>
): Promise<T> {
  return sessionStorage.run(session, callback);
} 