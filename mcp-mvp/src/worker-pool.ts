import { AgenticWorker } from './agentic-worker.js';
import { UserSession } from './user-session.js';

export class WorkerPool {
  private workers: AgenticWorker[] = [];
  private maxConcurrentWorkers: number;

  constructor(size: number) {
    this.maxConcurrentWorkers = size;
    for (let i = 0; i < size; i++) {
      this.workers.push(new AgenticWorker(i));
    }
    console.log(`[WORKER_POOL] Initialized with ${size} workers`);
  }

  async processRequest(message: string, session: UserSession, model: string): Promise<any> {
    const worker = await this.getAvailableWorker();
    console.log(`[WORKER_POOL] Allocated worker ${worker.id} for user ${session.userId}`);
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Worker timeout exceeded')), 120000); // 2 minutos
      });
      const workerPromise = worker.processAgenticCycle(message, session, model);
      return await Promise.race([workerPromise, timeoutPromise]);
    } catch (error) {
      console.error(`[WORKER_POOL] Error in worker ${worker.id}:`, error);
      throw error;
    } finally {
      worker.release();
      console.log(`[WORKER_POOL] Released worker ${worker.id} back to pool`);
    }
  }

  private async getAvailableWorker(): Promise<AgenticWorker> {
    const availableWorker = this.workers.find(worker => !worker.busy);
    if (availableWorker) {
      availableWorker.busy = true;
      return availableWorker;
    }
    console.log('[WORKER_POOL] All workers busy, waiting for one to become available');
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const worker = this.workers.find(w => !w.busy);
        if (worker) {
          clearInterval(checkInterval);
          worker.busy = true;
          resolve(worker);
        }
      }, 100);
    });
  }
} 