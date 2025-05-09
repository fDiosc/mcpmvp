import Anthropic from '@anthropic-ai/sdk';
import { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

// Initialize Anthropic client
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// Conversation store to maintain conversation IDs
const conversationStore: Map<string, { id: string, lastAccessed: Date }> = new Map();

// Function to get or create conversation ID
function getConversationId(sessionIdentifier: string): string {
  // Clean up expired conversations (older than 30 minutes)
  const now = new Date();
  for (const [key, data] of conversationStore.entries()) {
    const timeDiff = now.getTime() - data.lastAccessed.getTime();
    if (timeDiff > 30 * 60 * 1000) { // 30 minutes in milliseconds
      console.log(`[LOG][ANTHROPIC] Removing expired conversation: ${key}`);
      conversationStore.delete(key);
    }
  }

  // Get or create conversation for this session
  if (!conversationStore.has(sessionIdentifier)) {
    const newId = uuidv4();
    console.log(`[LOG][ANTHROPIC] Creating new conversation ID: ${newId} for session: ${sessionIdentifier}`);
    conversationStore.set(sessionIdentifier, { id: newId, lastAccessed: now });
    return newId;
  }

  // Update last accessed time and return existing ID
  const conversation = conversationStore.get(sessionIdentifier)!;
  conversation.lastAccessed = now;
  console.log(`[LOG][ANTHROPIC] Using existing conversation ID: ${conversation.id} for session: ${sessionIdentifier}`);
  return conversation.id;
}

// Add the CustomAnthropicMessageRole type definition above the custom types
type CustomAnthropicMessageRole = 'user' | 'assistant';

// Define custom types for working with Anthropic's API
export interface CustomContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string; // For tool_use blocks from Anthropic API
  tool_use_id?: string; // For tool_result blocks referencing a tool_use
  name?: string;
  input?: object;
  content?: string;
  cache_control?: { type: "ephemeral" };
}

export interface CustomAnthropicMessage {
  role: CustomAnthropicMessageRole;
  content: string | CustomContentBlock[];
}

export interface CustomToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Calls the Claude API directly
 * @param messages The messages to send to Claude
 * @param tools The tools available to Claude
 * @param sessionId The session ID for tracking
 * @param systemPrompt Optional system prompt to pass as a top-level parameter
 */
export async function callClaudeDirectAPI(
  messages: any[], 
  tools: any[] = [], 
  sessionId: string = 'default-session',
  systemPrompt?: string
): Promise<any> {
  try {
    console.error('[LOG][ANTHROPIC] Calling Claude API with messages and tools');
    
    // Generate a session ID if not provided
    const currentSessionId = sessionId || 'default-session';
    const conversationId = getConversationId(currentSessionId);
    
    // Convert our messages to a simpler format that's compatible with the Anthropic API
    const formattedMessages: MessageParam[] = messages.map((msg: any) => {
      // Handle string content
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content
        };
      }
      
      // Handle array content (blocks)
      if (Array.isArray(msg.content)) {
        return {
          role: msg.role,
          content: msg.content.map((block: any) => {
            if (block.type === 'text') {
              return {
                type: 'text' as const,
                text: block.text || ''
              };
            }
            if (block.type === 'tool_use') {
              return {
                type: 'tool_use' as const,
                id: block.id || uuidv4(),
                name: block.name || '',
                input: block.input || {}
              };
            }
            if (block.type === 'tool_result') {
              return {
                type: 'tool_result' as const,
                tool_use_id: block.tool_use_id || '',
                content: block.content || ''
              };
            }
            
            // Default fallback
            return {
              type: 'text' as const,
              text: JSON.stringify(block)
            };
          })
        };
      }
      
      // Default fallback for unknown message formats
      return {
        role: msg.role,
        content: 'Unknown message format'
      };
    });
    
    // Apply cache control if needed
    let messagesWithCaching = formattedMessages;
    messagesWithCaching = applyPromptCaching(formattedMessages);
    
    // Convert tools to the expected format
    const formattedTools = tools.map(tool => ({
      name: tool.name || '',
      description: tool.description || '',
      input_schema: {
        type: "object",
        properties: tool.input_schema?.properties || {},
        required: tool.input_schema?.required || []
      }
    }));
    
    // Log token count estimate (simplified)
    const inputJson = JSON.stringify(messagesWithCaching) + JSON.stringify(formattedTools);
    const estimatedTokens = Math.ceil(inputJson.length / 4); // Very rough estimate
    console.error(`[LOG][CACHE] Estimated input tokens: ~${estimatedTokens} (min cacheable threshold: 2048)`);
    
    // Make API call with type assertions to ensure compatibility
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
    
    // Log token usage and cache effectiveness
    logTokenUsage(response);
    
    console.error('[LOG][ANTHROPIC] Claude API response received');
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("[ERROR][ANTHROPIC] Error calling Anthropic API:", errorMessage);
    throw error;
  }
}

// Helper function to roughly estimate token count
function estimateTokenCount(messages: CustomAnthropicMessage[], tools: CustomToolDefinition[]): number {
  // Very rough estimate - 1 token ~= 4 chars for English text
  let totalChars = 0;
  
  // Count message chars
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          totalChars += block.text.length;
        } else if (block.type === 'tool_result' && block.content) {
          totalChars += block.content.length;
        } else if (block.type === 'tool_use') {
          totalChars += JSON.stringify(block.input || {}).length;
          totalChars += (block.name || '').length;
        }
      }
    }
  }
  
  // Count tool chars
  for (const tool of tools) {
    totalChars += tool.name.length;
    totalChars += tool.description.length;
    totalChars += JSON.stringify(tool.input_schema).length;
  }
  
  // Very rough conversion - just for estimation
  return Math.round(totalChars / 4);
}

// Function to log token usage and cache effectiveness
function logTokenUsage(response: any) {
  console.log('[LOG][TOKENS] ============= TOKEN USAGE =============');
  console.log(`[LOG][TOKENS] Input tokens: ${response.usage?.input_tokens || 'N/A'}`);
  console.log(`[LOG][TOKENS] Output tokens: ${response.usage?.output_tokens || 'N/A'}`);
  
  // Check if we meet minimum cacheable threshold
  const totalInputTokens = response.usage?.input_tokens || 0;
  if (totalInputTokens < 2048) {
    console.log(`[LOG][CACHE] WARNING: Total input tokens (${totalInputTokens}) below minimum cacheable threshold for Haiku (2048 tokens)`);
  } else {
    console.log(`[LOG][CACHE] Input tokens (${totalInputTokens}) meet minimum cacheable threshold (2048)`);
  }
  
  // Log cache-specific information if available
  if (response.usage?.cache_creation_input_tokens) {
    console.log(`[LOG][CACHE] Cache creation tokens: ${response.usage.cache_creation_input_tokens}`);
    console.log('[LOG][CACHE] New cache entry created');
    console.log(`[LOG][CACHE] Cache overhead: ${Math.round((response.usage.cache_creation_input_tokens / totalInputTokens) * 100)}% (expected: 25%)`);
  }
  
  if (response.usage?.cache_read_input_tokens) {
    console.log(`[LOG][CACHE] Cache read tokens: ${response.usage.cache_read_input_tokens}`);
    console.log('[LOG][CACHE] Successfully read from cache');
    
    // Calculate approximate savings
    const inputTokens = response.usage?.input_tokens || 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens || 0;
    const savings = inputTokens > 0 ? ((cacheReadTokens / inputTokens) * 100).toFixed(2) : 'N/A';
    
    console.log(`[LOG][CACHE] Cache efficiency: ${savings}%`);
    console.log(`[LOG][CACHE] Approximate cost reduction: ${Math.round(100 - (10 * cacheReadTokens / inputTokens))}% (expected: 90%)`);
  }
  
  if (!response.usage?.cache_creation_input_tokens && !response.usage?.cache_read_input_tokens) {
    console.log('[LOG][CACHE] No cache activity detected. Possible reasons:');
    console.log('[LOG][CACHE] - Input below minimum threshold (needs 2048+ tokens for Haiku)');
    console.log('[LOG][CACHE] - Cache control not properly applied');
    console.log('[LOG][CACHE] - API beta feature not enabled correctly');
    console.log('[LOG][CACHE] - Content changes breaking cache');
  }
  
  console.log('[LOG][TOKENS] =======================================');
}

// Function to apply prompt caching to messages
function applyPromptCaching(messages: MessageParam[]): MessageParam[] {
  if (messages.length <= 1) {
    return messages;
  }
  
  // Make a deep copy to avoid modifying the original
  const result = JSON.parse(JSON.stringify(messages));
  
  // IMPORTANT: Anthropic only allows up to 4 cache_control blocks
  // Since we're not using padding, we can use all 4 blocks strategically
  // Strategy: First message, middle, recent history, and latest user message
  
  // Cache counter to track how many we've added (max 4)
  let cacheControlCount = 0;
  
  // 1. Apply cache control to first message (if it exists and we have room)
  if (result.length > 0 && result[0].role === 'user' && cacheControlCount < 4) {
    if (typeof result[0].content === 'string') {
      result[0].content = [{ 
        type: 'text' as const, 
        text: result[0].content,
        cache_control: { type: "ephemeral" }
      }];
      cacheControlCount++;
    } else if (Array.isArray(result[0].content)) {
      if (result[0].content.length > 0) {
        result[0].content[0] = {
          ...result[0].content[0],
          cache_control: { type: "ephemeral" }
        };
        cacheControlCount++;
      }
    }
  }
  
  // 2. If we have 6+ messages, apply cache to a middle message (if we have room)
  if (result.length >= 6 && cacheControlCount < 4) {
    const middleIndex = Math.floor(result.length / 2);
    if (result[middleIndex].role === 'user') {
      if (typeof result[middleIndex].content === 'string') {
        result[middleIndex].content = [{ 
          type: 'text' as const, 
          text: result[middleIndex].content,
          cache_control: { type: "ephemeral" }
        }];
        cacheControlCount++;
      } else if (Array.isArray(result[middleIndex].content)) {
        if (result[middleIndex].content.length > 0) {
          result[middleIndex].content[0] = {
            ...result[middleIndex].content[0],
            cache_control: { type: "ephemeral" }
          };
          cacheControlCount++;
        }
      }
    }
  }
  
  // 3. Apply cache control to second-to-last user message (if we have room)
  if (cacheControlCount < 4) {
    const lastUserMsgIndex = findLastIndex(result, (msg: any) => msg.role === 'user');
    const secondToLastUserMsgIndex = findLastIndex(
      result.slice(0, lastUserMsgIndex), 
      (msg: any) => msg.role === 'user'
    );
    
    // If we have at least two user messages, add cache control to the second-to-last one
    if (secondToLastUserMsgIndex >= 0) {
      const actualIndex = secondToLastUserMsgIndex;
      if (typeof result[actualIndex].content === 'string') {
        result[actualIndex].content = [{ 
          type: 'text' as const, 
          text: result[actualIndex].content,
          cache_control: { type: "ephemeral" }
        }];
        cacheControlCount++;
      } else if (Array.isArray(result[actualIndex].content)) {
        // Apply to at most one item to conserve our cache_control quota
        if (result[actualIndex].content.length > 0) {
          result[actualIndex].content[0] = {
            ...result[actualIndex].content[0],
            cache_control: { type: "ephemeral" }
          };
          cacheControlCount++;
        }
      }
    }
  }
  
  // 4. Apply cache to latest user message if we still have quota
  if (cacheControlCount < 4) {
    const lastUserMsgIndex = findLastIndex(result, (msg: any) => msg.role === 'user');
    if (lastUserMsgIndex >= 0) {
      if (typeof result[lastUserMsgIndex].content === 'string') {
        result[lastUserMsgIndex].content = [{ 
          type: 'text' as const, 
          text: result[lastUserMsgIndex].content,
          cache_control: { type: "ephemeral" }
        }];
        cacheControlCount++;
      } else if (Array.isArray(result[lastUserMsgIndex].content)) {
        // Only apply if not already applied
        if (result[lastUserMsgIndex].content.length > 0) {
          const hasCache = result[lastUserMsgIndex].content.some(
            (block: any) => block.cache_control && block.cache_control.type === 'ephemeral'
          );
          
          if (!hasCache) {
            result[lastUserMsgIndex].content[0] = {
              ...result[lastUserMsgIndex].content[0],
              cache_control: { type: "ephemeral" }
            };
            cacheControlCount++;
          }
        }
      }
    }
  }
  
  console.log(`[LOG][CACHE] Applied ${cacheControlCount} cache control blocks (max 4 allowed)`);
  return result;
}

// Fix the findLastIndex function with proper type safety
function findLastIndex<T>(array: T[], predicate: (value: T) => boolean): number {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i])) {
      return i;
    }
  }
  return -1;
}

// Função utilitária para converter snake_case para camelCase
function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel);
  } else if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        snakeToCamel(v)
      ])
    );
  }
  return obj;
}

// Function to handle tool execution and format responses properly
export async function handleToolExecution(
  toolUse: any, 
  executeTool: (name: string, args: any) => Promise<any>, 
  messageHistory: CustomAnthropicMessage[]
) {
  const { name, input } = toolUse;
  // Use the original id from the model if available, otherwise generate a new one
  const toolUseId = toolUse.id || uuidv4();
  
  console.log(`[LOG][ANTHROPIC] Executing tool: ${name}`);
  
  try {
    // Normaliza argumentos para camelCase
    const normalizedInput = snakeToCamel(input);
    // Execute the tool with the provided input
    const toolResult = await executeTool(name, normalizedInput);
    console.log(`[LOG][ANTHROPIC] Tool result received`);
    
    // Format the tool result in the way Claude expects
    const resultContent = toolResult?.content?.[0]?.text || JSON.stringify(toolResult);
    
    // Add assistant message with tool use - using id for tool_use blocks
    messageHistory.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name,
          input
        }
      ]
    });
    
    // Add user message with tool result - using tool_use_id for tool_result blocks
    messageHistory.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: resultContent
        }
      ]
    });
    
    return { messageHistory, toolResult };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[ERROR][ANTHROPIC] Error executing tool ${name}:`, errorMessage);
    
    // Add an error result message
    messageHistory.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: `Error executing tool: ${errorMessage}`
        }
      ]
    });
    
    return { messageHistory, error };
  }
}

// Function to convert MCP tools to Anthropic tool format
export function convertMcpToolsToAnthropicFormat(mcpTools: any[]): CustomToolDefinition[] {
  return mcpTools.map(tool => ({
    name: tool.name,
    description: tool.description || `MCP tool: ${tool.name}`,
    input_schema: {
      type: "object",
      properties: tool.inputSchema.properties || {},
      required: tool.inputSchema.required || []
    }
  }));
}

// Function to convert plain text messages to properly formatted Anthropic messages
export function formatMessagesForAnthropic(messages: any[]): { messages: CustomAnthropicMessage[], system?: string } {
  // Primeiro, filtra mensagens vazias ou inválidas
  const validMessages = messages.filter(msg => {
    // Verifica se a mensagem tem role e content
    if (!msg || typeof msg !== 'object' || !msg.role) {
      return false;
    }
    
    // Verifica strings vazias no content
    if (typeof msg.content === 'string') {
      return msg.content.trim() !== '';
    }
    
    // Verifica arrays vazios no content
    if (Array.isArray(msg.content)) {
      if (msg.content.length === 0) return false;
      
      // Verifica cada item do array de content
      return msg.content.some((item: any) => {
        if (item && item.type === 'text') {
          return item.text && item.text.trim() !== '';
        }
        return false;
      });
    }
    
    // Verifica objetos de content
    if (msg.content && typeof msg.content === 'object') {
      if (msg.content.type === 'text') {
        return msg.content.text && msg.content.text.trim() !== '';
      }
    }
    
    return false;
  });

  // Extrai mensagens do sistema (deve ser passada como parâmetro de nível superior)
  let systemContent: string | undefined;
  const nonSystemMessages: CustomAnthropicMessage[] = [];

  for (const msg of validMessages) {
    if (msg.role === 'system') {
      // Extrair conteúdo do sistema
      if (typeof msg.content === 'string') {
        systemContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Pega apenas o texto dos objetos de conteúdo
        const textParts = msg.content
          .filter((item: any) => item && item.type === 'text' && item.text)
          .map((item: any) => item.text);
        if (textParts.length > 0) {
          systemContent = textParts.join('\n');
        }
      } else if (msg.content && msg.content.type === 'text') {
        systemContent = msg.content.text;
      }
    } else {
      // Processar mensagens não-sistema
      if (typeof msg.content === 'string') {
        nonSystemMessages.push({
          role: msg.role as CustomAnthropicMessageRole,
          content: [{
            type: 'text',
            text: msg.content
          }]
        });
      } else if (Array.isArray(msg.content)) {
        const contents = msg.content
          .filter((item: any) => item && item.type === 'text' && item.text)
          .map((item: any) => ({
            type: 'text' as const,
            text: item.text
          }));
        
        if (contents.length > 0) {
          nonSystemMessages.push({
            role: msg.role as CustomAnthropicMessageRole,
            content: contents
          });
        }
      } else if (msg.content && msg.content.type === 'text') {
        nonSystemMessages.push({
          role: msg.role as CustomAnthropicMessageRole,
          content: [{
            type: 'text',
            text: msg.content.text
          }]
        });
      }
    }
  }

  return {
    messages: nonSystemMessages,
    system: systemContent
  };
} 