Implementação de Sessões Isoladas para MCP Server
Visão Geral
Este documento descreve a implementação de um sistema de isolamento de contexto para o MCP Server, resolvendo problemas de concorrência e vazamento de dados entre usuários através de um mecanismo de "ambiente de sessão" personalizado para cada requisição.
Contexto do Problema
O servidor MCP atual sofre com problemas de concorrência devido ao uso de variáveis globais como currentChatRequestContext, resultando em:

Vazamento de dados entre sessões de usuários
Falhas durante ciclos agênticos (quando LLMs fazem múltiplas chamadas sequenciais)
Problemas de escalabilidade e confiabilidade

A solução proposta implementa isolamento completo do contexto usando AsyncLocalStorage e um sistema de gerenciamento de sessões, sem a complexidade de uma arquitetura de worker pool.
Arquitetura da Solução
┌───────────────────────────────────────────────────────────────┐
│                      MCP Express Server                        │
│                                                               │
│  ┌─────────────────┐      ┌──────────────────────────────┐    │
│  │                 │      │                              │    │
│  │  Endpoints      │      │  AsyncLocalStorage           │    │
│  │  /chat, etc     │◄────►│  (Contexto de Execução)      │    │
│  │                 │      │                              │    │
│  └────────┬────────┘      └─────────────┬────────────────┘    │
│           │                             │                     │
│           ▼                             │                     │
│  ┌─────────────────┐                    │                     │
│  │                 │                    │                     │
│  │  Session Env    │◄───────────────────┘                     │
│  │  Manager        │                                          │
│  │                 │                                          │
│  └────────┬────────┘                                          │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐      ┌─────────────────┐                 │
│  │                 │      │                 │                 │
│  │  Session A      │      │  Session B      │                 │
│  │  - Credenciais  │      │  - Credenciais  │                 │
│  │  - Histórico    │      │  - Histórico    │       ...       │
│  │  - MCP Client   │      │  - MCP Client   │                 │
│  │  - Threads      │      │  - Threads      │                 │
│  │                 │      │                 │                 │
│  └─────────────────┘      └─────────────────┘                 │
│                                                               │
└───────────────────────────────────────────────────────────────┘
Componentes Principais

SessionEnv: Encapsula todos os dados de uma sessão de usuário
SessionEnvManager: Gerencia o ciclo de vida das sessões
AsyncLocalStorage: Proporciona isolamento de contexto durante operações assíncronas

Implementação Detalhada
1. Classe SessionEnv
typescript// src/session-env.ts
import { v4 as uuidv4 } from 'uuid';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { DynamicToolClient } from './client/dynamicTools.js';
import { DynamicPromptClient } from './client/dynamicPrompts.js';
import { UserJiraCredentials } from './types.js';

export class SessionEnv {
  // Identificadores
  public readonly sessionId: string;
  public readonly anthropicConversationId: string;
  public readonly createdAt: Date;
  public lastAccessTime: Date;

  // Informações do usuário
  public userId?: string;
  public productLabUserId?: string;
  
  // Credenciais e configurações
  public jiraCredentials?: UserJiraCredentials;
  
  // Estado da conversação
  public conversationHistory: any[] = [];
  
  // Recursos MCP
  private mcpClient: Client | null = null;
  private dynamicToolClient: DynamicToolClient | null = null;
  private dynamicPromptClient: DynamicPromptClient | null = null;
  private assistant: any = null;
  private thread: any = null;
  
  // Estado de aplicação
  public notes: Record<string, any> = {};
  
  constructor(userId?: string, productLabUserId?: string) {
    this.sessionId = uuidv4();
    this.anthropicConversationId = uuidv4(); // ID estável para Anthropic
    this.createdAt = new Date();
    this.lastAccessTime = new Date();
    this.userId = userId;
    this.productLabUserId = productLabUserId;
    this.notes = {}; // Clone do estado global "notes" isolado para esta sessão
    
    console.log(`[SESSION] Created new session ${this.sessionId} for user ${userId || 'anonymous'}`);
  }
  
  updateLastAccess(): void {
    this.lastAccessTime = new Date();
  }
  
  async getOrCreateMcpClient(): Promise<Client> {
    this.updateLastAccess();
    
    if (!this.mcpClient) {
      try {
        const sseUrl = new URL('http://localhost:3333/mcp/sse');
        const transport = new SSEClientTransport(sseUrl);
        this.mcpClient = new Client({ 
          name: `user-${this.userId || this.sessionId}-client`, 
          version: '0.1.0' 
        });
        await this.mcpClient.connect(transport);
        console.log(`[SESSION] MCP client connected for session ${this.sessionId}`);
      } catch (error) {
        console.error(`[SESSION] Error connecting MCP client:`, error);
        throw error;
      }
    }
    
    return this.mcpClient;
  }
  
  async getToolClient(): Promise<DynamicToolClient> {
    this.updateLastAccess();
    
    if (!this.dynamicToolClient) {
      const mcpClient = await this.getOrCreateMcpClient();
      this.dynamicToolClient = new DynamicToolClient(mcpClient);
    }
    
    return this.dynamicToolClient;
  }
  
  async getPromptClient(): Promise<DynamicPromptClient> {
    this.updateLastAccess();
    
    if (!this.dynamicPromptClient) {
      const mcpClient = await this.getOrCreateMcpClient();
      this.dynamicPromptClient = new DynamicPromptClient(mcpClient);
    }
    
    return this.dynamicPromptClient;
  }
  
  async getOrCreateAssistant(): Promise<any> {
    this.updateLastAccess();
    
    if (!this.assistant) {
      const mcpClient = await this.getOrCreateMcpClient();
      this.assistant = await createDynamicAssistant(mcpClient);
      console.log(`[SESSION] Assistant created for session ${this.sessionId}`);
    }
    
    return this.assistant;
  }
  
  async getOrCreateThread(): Promise<any> {
    this.updateLastAccess();
    
    if (!this.thread) {
      this.thread = await createThread();
      console.log(`[SESSION] Thread created for session ${this.sessionId}`);
    }
    
    return this.thread;
  }
  
  setJiraCredentials(credentials: UserJiraCredentials): void {
    this.updateLastAccess();
    this.jiraCredentials = credentials;
    console.log(`[SESSION] Jira credentials set for session ${this.sessionId}`);
  }
  
  getJiraCredentials(): UserJiraCredentials | undefined {
    this.updateLastAccess();
    return this.jiraCredentials;
  }
  
  addToHistory(message: any): void {
    this.updateLastAccess();
    this.conversationHistory.push(message);
  }
  
  getRequestContext(): any {
    // Cria um objeto compatível com o RequestContext atual
    return {
      userJiraCredentials: this.jiraCredentials,
      productLabUserId: this.productLabUserId,
      sessionId: this.sessionId,
      anthropicConversationId: this.anthropicConversationId
    };
  }
  
  cleanup(): void {
    console.log(`[SESSION] Cleaning up resources for session ${this.sessionId}`);
    
    try {
      // Limpar conexões e recursos
      if (this.mcpClient) {
        this.mcpClient.close()
          .catch(err => console.error(`[SESSION] Error closing MCP client:`, err));
        this.mcpClient = null;
      }
      
      this.dynamicToolClient = null;
      this.dynamicPromptClient = null;
      this.assistant = null;
      this.thread = null;
      this.conversationHistory = [];
    } catch (error) {
      console.error(`[SESSION] Error during cleanup:`, error);
    }
  }
}
2. Classe SessionEnvManager
typescript// src/session-env-manager.ts
import { SessionEnv } from './session-env';

export class SessionEnvManager {
  private sessions: Map<string, SessionEnv> = new Map();
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos
  private readonly MAX_SESSIONS = 1000; // Limitar número máximo de sessões
  
  constructor() {
    // Iniciar limpeza periódica
    setInterval(() => this.cleanupSessions(), 10 * 60 * 1000);
    console.log(`[SESSION_MANAGER] Initialized with timeout ${this.SESSION_TIMEOUT}ms`);
  }
  
  getOrCreateSession(userId?: string, productLabUserId?: string): SessionEnv {
    this.checkSessionLimits();
    
    // Se temos um userId, procurar sessões existentes deste usuário
    if (userId) {
      const existingUserSessions = [...this.sessions.values()]
        .filter(s => s.userId === userId);
      
      if (existingUserSessions.length > 0) {
        // Sessão existente encontrada - pegar a mais recente
        const session = existingUserSessions.sort(
          (a, b) => b.lastAccessTime.getTime() - a.lastAccessTime.getTime()
        )[0];
        
        session.updateLastAccess();
        this.refreshSessionTimeout(session.sessionId);
        console.log(`[SESSION_MANAGER] Reusing existing session ${session.sessionId} for user ${userId}`);
        return session;
      }
    }
    
    // Criar nova sessão
    const newSession = new SessionEnv(userId, productLabUserId);
    this.sessions.set(newSession.sessionId, newSession);
    this.refreshSessionTimeout(newSession.sessionId);
    
    console.log(`[SESSION_MANAGER] Created new session ${newSession.sessionId}`);
    return newSession;
  }
  
  getSessionById(sessionId: string): SessionEnv | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updateLastAccess();
      this.refreshSessionTimeout(sessionId);
      console.log(`[SESSION_MANAGER] Retrieved session ${sessionId}`);
    } else {
      console.log(`[SESSION_MANAGER] Session ${sessionId} not found`);
    }
    return session;
  }
  
  private refreshSessionTimeout(sessionId: string): void {
    // Cancelar timeout existente, se houver
    if (this.sessionTimeouts.has(sessionId)) {
      clearTimeout(this.sessionTimeouts.get(sessionId)!);
    }
    
    // Definir novo timeout
    const timeout = setTimeout(() => {
      console.log(`[SESSION_MANAGER] Expiring inactive session: ${sessionId}`);
      this.sessions.get(sessionId)?.cleanup();
      this.sessions.delete(sessionId);
      this.sessionTimeouts.delete(sessionId);
    }, this.SESSION_TIMEOUT);
    
    this.sessionTimeouts.set(sessionId, timeout);
  }
  
  private cleanupSessions(): void {
    console.log(`[SESSION_MANAGER] Running session cleanup, current count: ${this.sessions.size}`);
    const now = new Date();
    const expiredSessions: string[] = [];
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const ageMs = now.getTime() - session.lastAccessTime.getTime();
      if (ageMs > this.SESSION_TIMEOUT) {
        expiredSessions.push(sessionId);
      }
    }
    
    for (const sessionId of expiredSessions) {
      console.log(`[SESSION_MANAGER] Cleaning up inactive session: ${sessionId}`);
      this.sessions.get(sessionId)?.cleanup();
      this.sessions.delete(sessionId);
      
      if (this.sessionTimeouts.has(sessionId)) {
        clearTimeout(this.sessionTimeouts.get(sessionId)!);
        this.sessionTimeouts.delete(sessionId);
      }
    }
    
    console.log(`[SESSION_MANAGER] Cleanup complete, removed ${expiredSessions.length} expired sessions`);
  }
  
  private checkSessionLimits(): void {
    // Se atingiu o limite, remover as sessões mais antigas
    if (this.sessions.size >= this.MAX_SESSIONS) {
      console.warn(`[SESSION_MANAGER] Session limit (${this.MAX_SESSIONS}) reached, removing oldest sessions`);
      
      // Ordenar sessões por último acesso
      const sortedSessions = [...this.sessions.entries()]
        .sort(([, a], [, b]) => a.lastAccessTime.getTime() - b.lastAccessTime.getTime());
      
      // Remover 10% das sessões mais antigas ou pelo menos uma
      const removeCount = Math.max(1, Math.floor(this.MAX_SESSIONS * 0.1));
      const sessionsToRemove = sortedSessions.slice(0, removeCount);
      
      for (const [sessionId, session] of sessionsToRemove) {
        console.log(`[SESSION_MANAGER] Removing old session: ${sessionId}`);
        session.cleanup();
        this.sessions.delete(sessionId);
        
        if (this.sessionTimeouts.has(sessionId)) {
          clearTimeout(this.sessionTimeouts.get(sessionId)!);
          this.sessionTimeouts.delete(sessionId);
        }
      }
    }
  }
  
  getAllSessions(): SessionEnv[] {
    return [...this.sessions.values()];
  }
  
  getSessionCount(): number {
    return this.sessions.size;
  }
}

// Singleton para uso global
export const sessionEnvManager = new SessionEnvManager();
3. Implementação do AsyncLocalStorage
typescript// src/session-context.ts
import { AsyncLocalStorage } from 'async_hooks';
import { SessionEnv } from './session-env';

// Criar AsyncLocalStorage para manter o contexto da sessão
export const sessionStorage = new AsyncLocalStorage<SessionEnv>();

// Funções utilitárias para acessar o contexto atual
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

// Função para executar operações em contexto de sessão
export async function runWithSession<T>(
  session: SessionEnv, 
  callback: () => Promise<T>
): Promise<T> {
  return sessionStorage.run(session, callback);
}
4. Modificação do Endpoint /chat
typescript// Trecho para substituir no index.ts
import { sessionEnvManager } from './session-env-manager';
import { sessionStorage, runWithSession } from './session-context';
import { SessionEnv } from './session-env';

// Substituir endpoint /chat atual
app.post('/chat', async (req: Request, res: Response) => {
  try {
    // Extrair informações do usuário
    const userId = req.body.userId;
    const productLabUserId = req.body.productLabUserId;
    const sessionId = req.body.sessionId;
    const message = req.body.message;
    const model = req.body.model || 'anthropic';
    
    if (!message) {
      return res.status(400).json({ 
        error: "Missing_Message",
        message: "Message is required"
      });
    }
    
    // Obter ou criar sessão
    let session: SessionEnv;
    
    if (sessionId) {
      // Tentar recuperar sessão existente
      const existingSession = sessionEnvManager.getSessionById(sessionId);
      if (!existingSession) {
        return res.status(404).json({
          error: "Session_Not_Found",
          message: "Session not found with provided ID"
        });
      }
      session = existingSession;
    } else {
      // Criar nova sessão
      if (!userId) {
        return res.status(400).json({ 
          error: "Missing_User_ID",
          message: "Either sessionId or userId is required"
        });
      }
      session = sessionEnvManager.getOrCreateSession(userId, productLabUserId);
    }
    
    // Atualizar credenciais Jira, se fornecidas
    if (req.body.jiraAuth) {
      session.setJiraCredentials(req.body.jiraAuth);
    }
    
    // Transferir histórico, se fornecido
    if (Array.isArray(req.body.history) && req.body.history.length > 0) {
      session.conversationHistory = req.body.history;
    }
    
    // Executar processamento no contexto da sessão isolada
    return await runWithSession(session, async () => {
      try {
        console.log(`[CHAT] Processing request for model: ${model}, session: ${session.sessionId}`);
        
        let response;
        
        // Processar com base no modelo selecionado
        if (model === 'anthropic') {
          response = await processAnthropicRequest(message, session);
        } else if (model === 'openai') {
          response = await processOpenAIRequest(message, session);
        } else if (model === 'bedrock') {
          response = await processBedrockRequest(message, session);
        } else {
          return res.status(400).json({ error: 'Modelo não suportado.' });
        }
        
        // Retornar resposta com ID da sessão
        return res.json({
          response: response,
          sessionId: session.sessionId,
          history: session.conversationHistory
        });
      } catch (error: any) {
        console.error('[CHAT] Error processing request:', error);
        return res.status(500).json({ 
          error: error.message,
          sessionId: session.sessionId // Manter o ID da sessão mesmo em caso de erro
        });
      }
    });
  } catch (error: any) {
    console.error('[CHAT] Unhandled error:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Implementar funções de processamento para cada modelo
async function processAnthropicRequest(message: string, session: SessionEnv) {
  // Obter ferramentas com base no contexto
  const toolClient = await session.getToolClient();
  const tools = await toolClient.getToolsFromMessage(message);
  const anthropicTools = convertMcpToolsToAnthropicFormat(tools.tools);
  
  // Adicionar mensagem do usuário ao histórico
  if (session.conversationHistory.length === 0 || 
      session.conversationHistory[session.conversationHistory.length - 1].role !== 'user') {
    session.addToHistory({
      role: 'user',
      content: [{ type: 'text', text: message }]
    });
  }
  
  // Chamar API Anthropic
  const response = await callClaudeDirectAPI(
    session.conversationHistory,
    anthropicTools,
    session.anthropicConversationId
  );
  
  // Processar resposta e executar ferramentas, se necessário
  let finished = false;
  let recursion = 0;
  const MAX_RECURSION = 5;
  let apiResponseObject = response;
  
  while (!finished && recursion < MAX_RECURSION) {
    recursion++;
    console.log(`[ANTHROPIC] Ciclo agêntico iteração ${recursion}/${MAX_RECURSION}`);
    
    // Verificar se há tool_use na resposta
    if (apiResponseObject.stop_reason === 'tool_use' && 
        apiResponseObject.content && 
        apiResponseObject.content.some((block: any) => block.type === 'tool_use')) {
      
      // Processar uso de ferramentas e continuar o ciclo...
      // ... código existente adaptado para usar session ...
      
      // Exemplo parcial:
      const toolUseBlocks = apiResponseObject.content.filter((block: any) => block.type === 'tool_use');
      
      for (const toolUseBlock of toolUseBlocks) {
        // Executar ferramenta com contexto atual
        const mcpClient = await session.getOrCreateMcpClient();
        
        try {
          const toolResult = await mcpClient.callTool({
            name: toolUseBlock.name,
            arguments: toolUseBlock.input
          });
          
          // Processar resultado e adicionar ao histórico...
        } catch (error) {
          console.error(`[TOOL_ERROR] Error executing tool ${toolUseBlock.name}:`, error);
          // Tratar erro da ferramenta...
        }
      }
      
      // Continuar o ciclo com nova chamada à API...
    } else {
      finished = true;
      
      // Adicionar resposta final ao histórico
      if (apiResponseObject.content && Array.isArray(apiResponseObject.content)) {
        const assistantContent = apiResponseObject.content.map((block: any) => {
          if (block.type === 'text') return { type: 'text', text: block.text };
          // Mapear outros tipos, se necessário...
          return null;
        }).filter(Boolean);
        
        if (assistantContent.length > 0) {
          session.addToHistory({
            role: 'assistant',
            content: assistantContent
          });
        }
      }
    }
  }
  
  // Extrair e retornar resposta final
  let finalResponseText = '';
  
  const lastAssistantMsg = [...session.conversationHistory]
    .reverse()
    .find(m => m.role === 'assistant');
  
  if (lastAssistantMsg && Array.isArray(lastAssistantMsg.content)) {
    finalResponseText = lastAssistantMsg.content
      .filter((c: any) => c.type === 'text' && c.text)
      .map((c: any) => c.text)
      .join('\n');
  }
  
  console.log(`[ANTHROPIC] Completed processing with ${recursion} iterations`);
  return finalResponseText;
}

async function processOpenAIRequest(message: string, session: SessionEnv) {
  // Obter ou criar assistant e thread específicos para a sessão
  const assistant = await session.getOrCreateAssistant();
  const thread = await session.getOrCreateThread();
  
  // Processar requisição OpenAI...
  // ... código existente adaptado para usar session ...
  
  return "Implementação OpenAI..."; // Placeholder
}

async function processBedrockRequest(message: string, session: SessionEnv) {
  // Processar requisição AWS Bedrock...
  // ... código existente adaptado para usar session ...
  
  return "Implementação Bedrock..."; // Placeholder
}
5. Modificação da Função callClaudeDirectAPI
typescript// anthropicClient.ts - modificar a função callClaudeDirectAPI
import { assertSession } from './session-context';

export async function callClaudeDirectAPI(
  messages: any[], 
  tools: any[] = [], 
  clientId?: string,
  systemPrompt?: string
): Promise<any> {
  try {
    // Tentar obter sessão do contexto atual
    let conversationId = clientId;
    
    try {
      const session = assertSession();
      // Usar ID da sessão atual, se disponível
      conversationId = session.anthropicConversationId;
      console.log(`[ANTHROPIC] Using conversation ID from current session: ${conversationId}`);
    } catch (error) {
      // Se não estiver em um contexto de sessão, usar o clientId fornecido
      console.log(`[ANTHROPIC] No session context available, using provided clientId: ${clientId}`);
    }
    
    // Restante do código existente...
    
    // Usar o conversation ID na chamada à API
    const response = await anthropic.messages.create(
      {
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1024,
        messages: messagesWithCaching,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        tools: formattedTools as any,
        temperature: 0.7
      },
      {
        headers: {
          "anthropic-beta": "prompt-caching-2024-07-31",
          "anthropic-conversation-id": conversationId
        }
      }
    );
    
    // Restante do código existente...
    
    return response;
  } catch (error) {
    console.error('[ANTHROPIC] Error calling Claude API:', error);
    throw error;
  }
}
6. Modificação das Ferramentas Jira
typescript// jiraTool.ts - adaptar funções executoras
import { assertSession } from './session-context';

export async function getJiraIssueExecutor(args: any, context?: any): Promise<any> {
  try {
    // Tentar múltiplas estratégias para obter credenciais
    let jiraCredentials;
    
    // Estratégia 1: Do contexto da sessão atual
    try {
      const session = assertSession();
      jiraCredentials = session.getJiraCredentials();
      
      if (jiraCredentials) {
        console.log(`[JIRA] Using credentials from current session ${session.sessionId}`);
      }
    } catch (error) {
      // Não estamos em um contexto de sessão
    }
    
    // Estratégia 2: Do contexto passado (compatibilidade)
    if (!jiraCredentials && context?.userJiraCredentials) {
      jiraCredentials = context.userJiraCredentials;
      console.log(`[JIRA] Using credentials from passed context`);
    }
    
    // Estratégia 3: Ambiente (fallback)
    if (!jiraCredentials && process.env.USE_ENV_FOR_JIRA_CREDENTIALS === 'true') {
      jiraCredentials = getDefaultCredentials();
      console.log(`[JIRA] Using credentials from environment`);
    }
    
    if (!jiraCredentials) {
      throw new Error('Jira credentials not available');
    }
    
    // Resto do código existente...
    
    // Executar a operação Jira com as credenciais obtidas
    const result = await fetchJiraIssue(args.issueKey, jiraCredentials);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error: any) {
    console.error(`[JIRA_ERROR] getJiraIssue error:`, error);
    return {
      content: [{
        type: 'text',
        text: `Error getting Jira issue: ${error.message}`
      }]
    };
  }
}

// Aplicar estratégia semelhante às outras funções executoras...
7. Adaptação do Sistema de Monitoramento (opcional)
typescript// monitoring.ts
import { sessionEnvManager } from './session-env-manager';

// Endpoint para monitoramento do estado de sessões
app.get('/admin/sessions', (req, res) => {
  const allSessions = sessionEnvManager.getAllSessions();
  const sessionsInfo = allSessions.map(session => ({
    sessionId: session.sessionId,
    userId: session.userId,
    createdAt: session.createdAt,
    lastAccessTime: session.lastAccessTime,
    hasJiraCredentials: !!session.jiraCredentials,
    historyLength: session.conversationHistory.length
  }));
  
  res.json({
    totalCount: sessionsInfo.length,
    sessions: sessionsInfo
  });
});

// Endpoint para limpar sessões expiradas manualmente
app.post('/admin/sessions/cleanup', (req, res) => {
  const beforeCount = sessionEnvManager.getSessionCount();
  sessionEnvManager.cleanupSessions();
  const afterCount = sessionEnvManager.getSessionCount();
  
  res.json({
    success: true,
    beforeCount,
    afterCount,
    removed: beforeCount - afterCount
  });
});
Código Adicional e Detalhes de Implementação
1. Inicialização do Servidor
Adicione este código ao início do arquivo index.ts para inicializar o sistema de sessões:
typescript// index.ts - no início do arquivo após imports
import { sessionEnvManager } from './session-env-manager';
import { sessionStorage } from './session-context';

console.log(`[SERVER] Initializing MCP server with session isolation...`);

// Log periódico de estatísticas de sessão
setInterval(() => {
  const sessionCount = sessionEnvManager.getSessionCount();
  console.log(`[SERVER] Current active sessions: ${sessionCount}`);
}, 5 * 60 * 1000); // A cada 5 minutos
2. Migração de Ferramentas MCP
Para todas as ferramentas MCP registradas, atualize o handler para buscar credenciais do contexto da sessão:
typescript// index.ts - atualizar registros de ferramentas
server.tool(
  getJiraIssueTool.name, 
  {
    issueKey: z.string().describe("The Jira issue key or ID (e.g., 'PROJ-123')")
  },
  async (args, extra: any) => {
    // Não usar mais getRequestContextFromExtra(extra)
    // Em vez disso:
    return getJiraIssueExecutor(args);
    // O executor buscará o contexto usando assertSession()
  }
);

// Repetir para todas as outras ferramentas
3. Adaptação da DynamicToolClient
Modifique a classe DynamicToolClient para integrar com o sistema de sessões:
typescript// client/dynamicTools.ts - modificar a classe
import { assertSession } from '../session-context';

export class DynamicToolClient {
  // ...código existente...
  
  async getToolsFromMessage(message: string, additionalOptions: Partial<ToolFilterOptions> = {}) {
    // Tentar obter contexto da sessão atual
    try {
      const session = assertSession();
      console.log(`[DYNAMIC-TOOLS] Getting tools for session ${session.sessionId}`);
      
      // Extrair contextos do mensaje
      const contexts = extractContextFromMessage(message);
      
      // Se não encontrou contextos, retornar array vazio
      if (contexts.length === 0) {
        console.error('[LOG][DYNAMIC-TOOLS] No context detected in message, returning empty tools array');
        return { 
          tools: [],
          metadata: {
            timestamp: new Date().toISOString(),
            requestId: crypto.randomUUID().toString(),
            filtered: false,
            originalCount: 0,
            returnedCount: 0,
            reductionPercent: 0,
            reason: 'no_context_detected'
          }
        };
      }
      
      // Get tools for each context and merge results
      const contextString = contexts.join(',');
      console.log(`[INFO][DYNAMIC-TOOLS] Extracted contexts: ${contextString}`);
      
      // Create options with the extracted context
      const options: ToolFilterOptions = {
        ...additionalOptions,
        context: contextString
      };
      
      return this.getTools(options);
    } catch (error) {
      // Se não estiver em um contexto de sessão, usar o comportamento atual
      console.log(`[DYNAMIC-TOOLS] No session context available, using default behavior`);
      return super.getToolsFromMessage(message, additionalOptions);
    }
  }
  
  // ...resto do código existente...
}
4. Implementação do Mapeamento de IDs
Para garantir compatibilidade com o código existente que depende de IDs de conversação:
typescript// id-mapping.ts
import { sessionEnvManager } from './session-env-manager';

// Mapa: Anthropic Conversation ID -> Session ID
const anthropicToSessionMap = new Map<string, string>();

// Registrar um mapeamento
export function registerConversationMapping(anthropicId: string, sessionId: string) {
  anthropicToSessionMap.set(anthropicId, sessionId);
}

// Obter sessão por ID de conversação
export function getSessionByAnthropicId(anthropicId: string) {
  const sessionId = anthropicToSessionMap.get(anthropicId);
  if (!sessionId) return undefined;
  return sessionEnvManager.getSessionById(sessionId);
}

// Remover mapeamento (ao limpar sessões)
export function removeConversationMapping(anthropicId: string) {
  anthropicToSessionMap.delete(anthropicId);
}
5. Adaptação do Processamento de Notificações SSE
Atualize o código que lida com notificações SSE para usar o contexto da sessão:
typescript// index.ts - atualizar handler SSE
app.get("/mcp/sse", async (req: Request, res: Response) => {
  // Extrair informações do usuário via query params
  const userId = req.query.userId as string;
  const sessionId = req.query.sessionId as string;
  
  // Obter ou criar sessão
  let session;
  if (sessionId) {
    session = sessionEnvManager.getSessionById(sessionId);
    if (!session) {
      res.status(404).send("Session not found");
      return;
    }
  } else if (userId) {
    session = sessionEnvManager.getOrCreateSession(userId);
  } else {
    // Criar sessão anônima se nem userId nem sessionId fornecidos
    session = sessionEnvManager.getOrCreateSession();
  }
  
  // Criar transporte SSE no contexto da sessão
  await runWithSession(session, async () => {
    const transport = new SSEServerTransport("/mcp", res);
    // Associar sessão ID ao transporte para referência futura
    (transport as any).sessionId = session.sessionId;
    
    sseSessions.set(transport.sessionId, transport);
    
    // Vincular eventos do servidor MCP ao transporte SSE
    server.connect(transport);
    
    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
    });
  });
});
6. Adaptação da Integração OpenAI
Adapte o código de processamento OpenAI para usar sessões isoladas:
typescript// Trecho para processamento OpenAI no handler /chat
async function processOpenAIRequest(message: string, session: SessionEnv) {
  try {
    // Obter ou criar assistant e thread
    const assistant = await session.getOrCreateAssistant();
    const thread = await session.getOrCreateThread();
    
    // Se não tiver histórico, apenas adicionar a mensagem atual
    if (session.conversationHistory.length === 0) {
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: message
      });
    } 
    // Se tiver histórico, sincronizar com o thread
    else {
      // Primeiro, limpar mensagens existentes para evitar duplicação
      const existingMessages = await openai.beta.threads.messages.list(thread.id);
      
      // Sincronizar mensagens do histórico para o thread
      for (const historyMsg of session.conversationHistory) {
        if (historyMsg.role === 'user') {
          let content = '';
          
          if (typeof historyMsg.content === 'string') {
            content = historyMsg.content;
          } else if (Array.isArray(historyMsg.content)) {
            // Extrair texto de blocos de conteúdo
            content = historyMsg.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
          }
          
          if (content) {
            await openai.beta.threads.messages.create(thread.id, {
              role: 'user',
              content: content
            });
          }
        }
      }
      
      // Adicionar a mensagem atual, se ainda não estiver no histórico
      const lastMsg = session.conversationHistory[session.conversationHistory.length - 1];
      if (lastMsg.role !== 'user' || 
          !lastMsg.content.some((c: any) => c.type === 'text' && c.text === message)) {
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: message
        });
      }
    }
    
    // Executar o assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id
    });
    
    // Aguardar conclusão
    let completed = false;
    let runResult;
    
    while (!completed) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runResult = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      
      if (runResult.status === 'requires_action' && 
          runResult.required_action && 
          runResult.required_action.submit_tool_outputs) {
        
        const toolCalls = runResult.required_action.submit_tool_outputs.tool_calls;
        const tool_outputs = [];
        
        // Executar ferramentas no contexto da sessão atual
        for (const call of toolCalls) {
          const toolName = call.function.name;
          const args = JSON.parse(call.function.arguments);
          
          console.log(`[OPENAI] Tool call: ${toolName}`);
          
          try {
            // Obter cliente MCP da sessão
            const mcpClient = await session.getOrCreateMcpClient();
            const result = await mcpClient.callTool({ 
              name: toolName, 
              arguments: args 
            });
            
            let output = '';
            if (result?.content && Array.isArray(result.content) && result.content[0]?.text) {
              output = result.content[0].text;
            } else {
              output = JSON.stringify(result);
            }
            
            tool_outputs.push({ tool_call_id: call.id, output });
          } catch (error) {
            console.error(`[OPENAI] Tool execution error:`, error);
            tool_outputs.push({ 
              tool_call_id: call.id, 
              output: `Error: ${error.message}` 
            });
          }
        }
        
        // Submeter resultados das ferramentas
        await openai.beta.threads.runs.submitToolOutputs(
          thread.id, 
          run.id, 
          { tool_outputs }
        );
      }
      
      if (runResult.status === 'completed' || 
          runResult.status === 'failed' || 
          runResult.status === 'cancelled') {
        completed = true;
      }
    }
    
    // Obter a resposta final
    const messages = await openai.beta.threads.messages.list(thread.id, {
      order: 'desc',
      limit: 1
    });
    
    let response = '';
    
    if (messages.data.length > 0) {
      const latestMessage = messages.data[0];
      
      if (latestMessage.content && latestMessage.content.length > 0) {
        const content = latestMessage.content[0];
        
        if (content.type === 'text') {
          response = content.text.value;
          
          // Adicionar resposta ao histórico da sessão
          session.addToHistory({
            role: 'assistant',
            content: [{ type: 'text', text: response }]
          });
        }
      }
    }
    
    console.log(`[OPENAI] Processing complete for session ${session.sessionId}`);
    return response;
  } catch (error) {
    console.error(`[OPENAI] Error processing request:`, error);
    throw error;
  }
}
7. Implementação do Endpoint de Saúde e Admin
Adicione endpoints para diagnóstico e administração do sistema de sessões:
typescript// index.ts - adicionar endpoints de diagnóstico
app.get('/health', (req, res) => {
  const sessionCount = sessionEnvManager.getSessionCount();
  const uptime = process.uptime();
  
  res.json({
    status: 'ok',
    version: '0.2.0',
    activeSessions: sessionCount,
    uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
    memoryUsage: process.memoryUsage()
  });
});

// Endpoint de diagnóstico de sessão
app.get('/admin/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessionEnvManager.getSessionById(sessionId);
  
  if (!session) {
    return res.status(404).json({
      error: 'Session not found'
    });
  }
  
  // Criar objeto com informações seguras da sessão
  const sessionInfo = {
    sessionId: session.sessionId,
    userId: session.userId,
    productLabUserId: session.productLabUserId,
    createdAt: session.createdAt,
    lastAccessTime: session.lastAccessTime,
    historyLength: session.conversationHistory.length,
    hasJiraCredentials: !!session.jiraCredentials,
    hasMcpClient: !!(session as any).mcpClient,
    anthropicConversationId: session.anthropicConversationId
  };
  
  res.json(sessionInfo);
});

// Endpoint para resetar uma sessão específica
app.post('/admin/sessions/:sessionId/reset', (req, res) => {
  const { sessionId } = req.params;
  const session = sessionEnvManager.getSessionById(sessionId);
  
  if (!session) {
    return res.status(404).json({
      error: 'Session not found'
    });
  }
  
  // Limpar e recriar a sessão
  session.cleanup();
  session.conversationHistory = [];
  
  res.json({
    status: 'ok',
    message: `Session ${sessionId} has been reset`
  });
});
Considerações Finais de Implementação
Estratégia de Migração Gradual
Para minimizar riscos, recomendo uma migração gradual:

Fase 1: Implementar classes de sessão e manter compatibilidade com o código existente

Adicionar SessionEnv e SessionEnvManager
Configurar AsyncLocalStorage
Adaptar /chat para usar sessões, mas manter suporte ao método antigo


Fase 2: Migrar ferramentas e processamento de modelos

Adaptar callClaudeDirectAPI e executores de ferramentas Jira
Implementar processamento específico para cada modelo


Fase 3: Remover código legado

Remover variáveis globais de contexto
Eliminar hacks de compartilhamento de contexto
Finalizar testes de integração



Estratégia de Rollback
Inclua um mecanismo de retorno rápido ao sistema antigo:
typescript// Variável de ambiente para controlar o uso do novo sistema
const USE_SESSION_ISOLATION = process.env.USE_SESSION_ISOLATION === 'true';

// No endpoint /chat
app.post('/chat', async (req, res) => {
  if (USE_SESSION_ISOLATION) {
    // Usar o novo sistema de sessões
    // ...código de sessão isolada...
  } else {
    // Usar o sistema antigo
    // ...código legado...
  }
});
Isso permite desativar a nova implementação rapidamente se surgirem problemas inesperados.
Monitoramento e Diagnóstico
Para facilitar a depuração durante e após a migração:

Adicione logs detalhados com identificadores de sessão
Implemente métricas de uso de memória e contagem de sessões
Configure alertas para crescimento anormal no número de sessões
Adicione um endpoint de diagnóstico para inspecionar sessões ativas
Teste de sessões individuais:

Criar um teste que verifica se sessões diferentes mantêm estado isolado
Verificar se credenciais não vazam entre sessões


Teste de ciclo agêntico:

Criar um teste que executa um ciclo agêntico completo com múltiplas chamadas de ferramentas
Verificar se o contexto é mantido em todo o ciclo


Teste de concorrência:

Simular requisições simultâneas de múltiplos usuários
Verificar se não há vazamento de dados entre requisições


Teste de recuperação de sessão:

Iniciar uma sessão, armazenar o ID
Reconectar usando o ID e verificar se o estado é mantido


Teste de compatibilidade:

Verificar se a integração com Anthropic mantém prompt caching
Verificar se a API OpenAI funciona corretamente com a nova arquitetura



Considerações Importantes
Gerenciamento de Memória
O sistema de sessões mantém estado em memória, o que pode levar a crescimento de RAM com o tempo. Isso é mitigado por:

Limpeza automática de sessões inativas
Limite máximo configurável de sessões
Estratégia de remoção de sessões mais antigas quando o limite é atingido

Compatibilidade com Código Existente
Para garantir compatibilidade com o código existente:

A classe SessionEnv implementa getRequestContext() para emular o formato atual
As funções executoras de ferramentas tentam múltiplas estratégias para obter credenciais
O endpoint /chat aceita tanto sessionId quanto userId para identificação

Escalabilidade
Para clusters ou instalações distribuídas:

O SessionEnvManager pode ser estendido para usar um store distribuído (Redis, Memcached)
IDs de sessão usam UUID para garantir unicidade entre instâncias
A limpeza de sessões é projetada para funcionar em ambiente distribuído

Resultados Esperados
A implementação desta arquitetura de isolamento de sessões deve resultar em:

Eliminação de falhas de concorrência: Cada requisição opera em seu próprio contexto isolado
Prevenção de vazamento de dados: Credenciais e estado permanecem isolados por usuário
Maior confiabilidade: Eliminação de condições de corrida durante ciclos agênticos
Melhor depuração: Logs consistentes relacionados à sessão de usuário
Escalabilidade aprimorada: Suporte a mais usuários simultâneos sem problemas de concorrência

Benefícios Adicionais

Persistência de sessão: Usuários podem reconectar a sessões existentes
Monitoramento melhorado: Visibilidade do estado de todas as sessões ativas
Limpeza automatizada: Evita vazamentos de memória com expiração de sessões inativas
Isolamento de falhas: Problemas em uma sessão não afetam outras

Conclusão
A arquitetura de isolamento de sessão resolve fundamentalmente os problemas de concorrência no servidor MCP, proporcionando um ambiente isolado para cada usuário e cada requisição. O uso de AsyncLocalStorage no Node.js simplifica o acesso ao contexto da sessão sem passar parâmetros explicitamente entre funções.
Esta implementação não apenas resolve os problemas atuais, mas também estabelece uma base sólida para futuras melhorias, como persistência de sessão em banco de dados, balanceamento de carga entre instâncias, e monitoramento aprimorado.
Recomenda-se implementar esta solução de forma incremental, começando com os componentes principais (SessionEnv, SessionEnvManager) e depois adaptando gradualmente o código existente para usar o novo sistema de sessões.