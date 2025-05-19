import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { DynamicToolClient } from './client/dynamicTools.js';
import { DynamicPromptClient } from './client/dynamicPrompts.js';
import { McpClientWrapper } from './client/mcpClientWrapper.js';
import { UserJiraCredentials } from './types.js';
import { v4 as uuidv4 } from 'uuid';

// Map to store user credentials that can be accessed by the MCP server
export const sessionCredentialsMap = new Map<string, UserJiraCredentials>();

export class UserSession {
  public readonly userId: string;
  public readonly productLabUserId?: string;
  public lastAccessTime: number = Date.now();
  private mcpClient: Client | null = null;
  private mcpWrapper: McpClientWrapper | null = null;
  private dynamicToolClient: DynamicToolClient | null = null;
  private dynamicPromptClient: DynamicPromptClient | null = null;
  public conversationId: string = uuidv4();
  public conversationHistory: any[] = [];
  public notes: Record<string, any> = {};
  public jiraCredentials: UserJiraCredentials | null = null;

  constructor(userId: string, productLabUserId?: string) {
    this.userId = userId;
    this.productLabUserId = productLabUserId;
    console.log(`[SESSION] Created new session for user: ${userId}, productLabId: ${productLabUserId || 'N/A'}`);
  }

  async getOrCreateMcpClient(): Promise<Client> {
    this.updateLastAccess();
    if (!this.mcpClient) {
      const sseUrl = new URL('http://localhost:3333/mcp/sse');
      const transport = new SSEClientTransport(sseUrl);
      this.mcpClient = new Client({ name: `user-${this.userId}-client`, version: '0.1.0' });
      await this.mcpClient.connect(transport);
      console.log(`[SESSION] MCP client connected for user: ${this.userId}`);
    }
    return this.mcpClient;
  }

  async getOrCreateMcpWrapper(): Promise<McpClientWrapper> {
    this.updateLastAccess();
    if (!this.mcpWrapper) {
      const mcpClient = await this.getOrCreateMcpClient();
      this.mcpWrapper = new McpClientWrapper(mcpClient);
    }
    return this.mcpWrapper;
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

  setJiraCredentials(credentials: UserJiraCredentials): void {
    this.updateLastAccess();
    this.jiraCredentials = credentials;
    console.log(`[SESSION] Jira credentials set for user: ${this.userId}`);
    
    // Also store the credentials in the global map so they're accessible to the MCP server
    sessionCredentialsMap.set(this.userId, credentials);
    sessionCredentialsMap.set(this.conversationId, credentials);
  }

  updateLastAccess(): void {
    this.lastAccessTime = Date.now();
  }

  cleanup(): void {
    console.log(`[SESSION] Cleaning up resources for user: ${this.userId}`);
    if (this.mcpClient) {
      try {
        this.mcpClient = null;
      } catch (err) {
        console.error(`[SESSION] Error disconnecting MCP client: ${err}`);
      }
    }
    this.mcpWrapper = null;
    this.dynamicToolClient = null;
    this.dynamicPromptClient = null;
    this.conversationHistory = [];
    this.notes = {};

    // Clean up stored credentials
    sessionCredentialsMap.delete(this.userId);
    sessionCredentialsMap.delete(this.conversationId);
  }
} 