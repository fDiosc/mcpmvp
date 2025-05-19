import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * Wrapper for MCP client that preserves session context during tool calls
 * This solves the issue of credentials being lost in the tool execution chain
 */
export class McpClientWrapper {
  private client: Client;
  private conversationId: string | null = null;
  
  constructor(client: Client) {
    this.client = client;
  }
  
  /**
   * Set the conversation ID to associate with this client
   * This helps identify which session the tools are being called from
   */
  setConversationId(id: string): void {
    this.conversationId = id;
  }
  
  /**
   * Call a tool while preserving session context that would normally be stripped
   * by the standard MCP client implementation
   */
  async callTool(params: { name: string; arguments: any; sessionContext?: any }) {
    // Do NOT strip or modify the original arguments, especially properties with underscore
    // The MCP SDK is stripping these properties somewhere internally, so we need to preserve them
    
    // Call the tool through MCP with the ORIGINAL arguments including underscore properties
    // Add the conversationId to the metadata if available
    const callParams: any = {
      name: params.name,
      arguments: params.arguments // Pass unmodified arguments
    };
    
    // Add conversationId to help the server identify the session
    if (this.conversationId) {
      if (!callParams._meta) {
        callParams._meta = {};
      }
      callParams._meta.conversationId = this.conversationId;
    }
    
    const result = await this.client.callTool(callParams);
    
    // Add session context to metadata for future reference if needed
    if (result._meta) {
      result._meta._sessionContext = params.sessionContext;
    } else {
      result._meta = { _sessionContext: params.sessionContext };
    }
    
    return result;
  }
} 