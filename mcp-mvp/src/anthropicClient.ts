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

// Define custom types for working with Anthropic's API
export interface CustomContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string; // For tool_use blocks from Anthropic API
  tool_use_id?: string; // For tool_result blocks referencing a tool_use
  name?: string;
  input?: object;
  content?: string;
}

export interface CustomAnthropicMessage {
  role: "user" | "assistant";
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

// Main function to call Claude API with messages and tools
export async function callClaudeDirectAPI(messages: CustomAnthropicMessage[], tools: CustomToolDefinition[]) {
  try {
    console.log('[LOG][ANTHROPIC] Calling Claude API with messages and tools');
    
    // Convert our custom types to Anthropic SDK types
    const formattedMessages: MessageParam[] = messages.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content
        };
      } else {
        return {
          role: msg.role,
          content: msg.content.map(block => {
            if (block.type === 'text') {
              return {
                type: 'text',
                text: block.text || ''
              };
            } else if (block.type === 'tool_use') {
              return {
                type: 'tool_use',
                id: block.id || block.tool_use_id || uuidv4(),
                name: block.name || '',
                input: block.input || {}
              };
            } else if (block.type === 'tool_result') {
              return {
                type: 'tool_result',
                tool_use_id: block.tool_use_id || block.id || '',
                content: block.content || ''
              };
            }
            // Default fallback
            return {
              type: 'text',
              text: JSON.stringify(block)
            };
          }) as ContentBlockParam[]
        };
      }
    });

    const formattedTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties: tool.input_schema.properties || {},
        required: tool.input_schema.required || []
      }
    }));
    
    const response = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      messages: formattedMessages,
      tools: formattedTools as any,
      temperature: 0.7,
    });
    
    console.log('[LOG][ANTHROPIC] Claude API response received');
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("[ERROR][ANTHROPIC] Error calling Anthropic API:", errorMessage);
    throw error;
  }
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
    // Execute the tool with the provided input
    const toolResult = await executeTool(name, input);
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
export function formatMessagesForAnthropic(messages: any[]): CustomAnthropicMessage[] {
  return messages.map(msg => {
    // Case 1: If it's already in the correct format with content array, use it directly
    if (typeof msg === 'object' && msg.role && Array.isArray(msg.content) &&
        msg.content.every((item: any) => typeof item === 'object' && item.type)) {
      
      // Fix any tool_use blocks that might be using tool_use_id instead of id
      if (msg.content.some((item: any) => item.type === 'tool_use')) {
        return {
          role: msg.role,
          content: msg.content.map((item: any) => {
            if (item.type === 'tool_use') {
              return {
                type: 'tool_use',
                id: item.id || item.tool_use_id || uuidv4(),
                name: item.name || '',
                input: item.input || {}
              };
            } else if (item.type === 'tool_result') {
              return {
                type: 'tool_result',
                tool_use_id: item.tool_use_id || item.id || '',
                content: item.content || ''
              };
            }
            return item;
          })
        };
      }
      
      return msg;
    }
    
    // Case 2: If it has content as a string
    if (typeof msg === 'object' && msg.role && typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: [{ type: 'text', text: msg.content }]
      };
    }
    
    // Case 3: If it has content with nested text property (handle malformed content)
    if (typeof msg === 'object' && msg.role && 
        Array.isArray(msg.content) && 
        msg.content[0] && 
        msg.content[0].text && 
        typeof msg.content[0].text === 'object') {
      // Fix the nested text object
      return {
        role: msg.role,
        content: msg.content.map((item: any) => {
          if (item.text && typeof item.text === 'object' && item.text.text) {
            return {
              type: 'text',
              text: item.text.text
            };
          }
          return item;
        })
      };
    }
    
    // Case 4: Handle content with type but missing text or incorrect property structure
    if (typeof msg === 'object' && msg.role && 
        Array.isArray(msg.content) && 
        msg.content.some((item: any) => item.type === 'text' || item.type === 'tool_use' || item.type === 'tool_result')) {
      return {
        role: msg.role,
        content: msg.content.map((item: any) => {
          if (item.type === 'text') {
            return {
              type: 'text',
              text: typeof item.text === 'string' ? item.text : JSON.stringify(item.text || '')
            };
          } else if (item.type === 'tool_use') {
            return {
              type: 'tool_use',
              id: item.id || item.tool_use_id || uuidv4(),
              name: item.name || '',
              input: item.input || {}
            };
          } else if (item.type === 'tool_result') {
            return {
              type: 'tool_result',
              tool_use_id: item.tool_use_id || item.id || '',
              content: item.content || ''
            };
          }
          return item;
        })
      };
    }
    
    // Default case - create a simple message
    return {
      role: msg.role || 'user',
      content: [{ type: 'text', text: typeof msg.content === 'string' ? msg.content : '' }]
    };
  });
} 