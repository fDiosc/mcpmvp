import { v4 as uuidv4 } from 'uuid';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { DynamicToolClient } from './client/dynamicTools.js';
import { DynamicPromptClient } from './client/dynamicPrompts.js';
import { UserJiraCredentials } from './types.js';
import { createDynamicAssistant, createThread } from './client/agents/assistant.js';

export class SessionEnv {
  public readonly sessionId: string;
  public readonly anthropicConversationId: string;
  public readonly createdAt: Date;
  public lastAccessTime: Date;
  public userId?: string;
  public productLabUserId?: string;
  public jiraCredentials?: UserJiraCredentials;
  public conversationHistory: any[] = [];
  private mcpClient: Client | null = null;
  private dynamicToolClient: DynamicToolClient | null = null;
  private dynamicPromptClient: DynamicPromptClient | null = null;
  private assistant: any = null;
  private thread: any = null;
  public notes: Record<string, any> = {};

  constructor(userId?: string, productLabUserId?: string) {
    this.sessionId = uuidv4();
    this.anthropicConversationId = uuidv4();
    this.createdAt = new Date();
    this.lastAccessTime = new Date();
    this.userId = userId;
    this.productLabUserId = productLabUserId;
    this.notes = {};
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