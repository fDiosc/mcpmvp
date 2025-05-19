import { UserSession } from './user-session.js';
import { callClaudeDirectAPI, convertMcpToolsToAnthropicFormat } from './anthropicClient.js';
import { DynamicToolClient } from './client/dynamicTools.js';
import { McpClientWrapper } from './client/mcpClientWrapper.js';

interface AgenticContext {
  session: UserSession;
  toolCallStack: any[];
  toolResultStack: any[];
  currentIteration: number;
  model: string;
  message: string;
}

export class AgenticWorker {
  public readonly id: number;
  public busy: boolean = false;
  private MAX_ITERATIONS: number = 10;

  constructor(id: number) {
    this.id = id;
  }

  async processAgenticCycle(message: string, session: UserSession, model: string): Promise<any> {
    console.log(`[WORKER-${this.id}] Starting agentic cycle for user ${session.userId}`);
    try {
      const agenticContext: AgenticContext = {
        session,
        toolCallStack: [],
        toolResultStack: [],
        currentIteration: 0,
        model,
        message
      };
      const mcpClient = await session.getOrCreateMcpClient();
      const mcpWrapper = await session.getOrCreateMcpWrapper();
      
      // Make sure session is linked to the MCP conversation ID
      // This ensures that when the server executes tools, it can find the right credentials
      mcpWrapper.setConversationId(session.conversationId);
      
      const toolClient = await session.getToolClient();
      const tools = await toolClient.getToolsFromMessage(message);
      console.log(`[WORKER-${this.id}] Loaded ${tools.tools.length} tools for context`);
      if (!session.conversationHistory || session.conversationHistory.length === 0) {
        session.conversationHistory = [];
      }
      session.conversationHistory.push({
        role: 'user',
        content: [{ type: 'text', text: message }]
      });
      let llmResponse;
      if (model === 'anthropic') {
        const anthropicTools = convertMcpToolsToAnthropicFormat(tools.tools);
        llmResponse = await callClaudeDirectAPI(
          session.conversationHistory,
          anthropicTools,
          session.conversationId
        );
        let finished = false;
        while (!finished && agenticContext.currentIteration < this.MAX_ITERATIONS) {
          agenticContext.currentIteration++;
          console.log(`[WORKER-${this.id}] Agentic iteration ${agenticContext.currentIteration}`);
          if (llmResponse.stop_reason === 'tool_use' &&
              llmResponse.content &&
              llmResponse.content.some((block: any) => block.type === 'tool_use')) {
            const assistantResponseContent = llmResponse.content.map((block: any) => {
              if (block.type === 'text') return { type: 'text', text: block.text };
              if (block.type === 'tool_use') return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input
              };
              return null;
            }).filter(Boolean);
            session.conversationHistory.push({
              role: 'assistant',
              content: assistantResponseContent
            });
            const toolUseBlocks = llmResponse.content.filter((block: any) => block.type === 'tool_use');
            const toolResultsForThisTurn: any[] = [];
            for (const toolUseBlock of toolUseBlocks) {
              console.log(`[WORKER-${this.id}] Executing tool: ${toolUseBlock.name}`);
              try {
                const executionResult = await mcpWrapper.callTool({
                  name: toolUseBlock.name,
                  arguments: {
                    ...toolUseBlock.input,
                    _jiraCredentials: session.jiraCredentials,
                    _productLabUserId: session.productLabUserId
                  },
                  sessionContext: {
                    session
                  }
                });
                
                let resultStringContent = '';
                if (executionResult && executionResult.toolResult) {
                  resultStringContent = typeof executionResult.toolResult === 'string' 
                    ? executionResult.toolResult 
                    : JSON.stringify(executionResult.toolResult);
                } else if (executionResult && executionResult.content) {
                  if (Array.isArray(executionResult.content) && executionResult.content.length > 0) {
                    resultStringContent = executionResult.content[0].text ||
                                         JSON.stringify(executionResult.content[0]);
                  } else if (typeof executionResult.content === 'string') {
                    resultStringContent = executionResult.content;
                  }
                } else {
                  resultStringContent = JSON.stringify(executionResult);
                }
                toolResultsForThisTurn.push({
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: resultStringContent
                });
              } catch (toolExecError: any) {
                console.error(`[WORKER-${this.id}] Tool execution error:`, toolExecError);
                toolResultsForThisTurn.push({
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: `Error executing tool ${toolUseBlock.name}: ${toolExecError.message}`
                });
              }
            }
            if (toolResultsForThisTurn.length > 0) {
              session.conversationHistory.push({
                role: 'user',
                content: toolResultsForThisTurn
              });
              llmResponse = await callClaudeDirectAPI(
                session.conversationHistory,
                anthropicTools,
                session.conversationId
              );
            } else {
              finished = true;
            }
          } else {
            finished = true;
            if (llmResponse.content && Array.isArray(llmResponse.content)) {
              const finalContent = llmResponse.content.map((block: any) => {
                if (block.type === 'text') return { type: 'text', text: block.text };
                return null;
              }).filter(Boolean);
              if (finalContent.length > 0) {
                session.conversationHistory.push({
                  role: 'assistant',
                  content: finalContent
                });
              }
            }
          }
        }
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
        console.log(`[WORKER-${this.id}] Completed agentic cycle with ${agenticContext.currentIteration} iterations`);
        return {
          response: finalResponseText,
          history: session.conversationHistory
        };
      } else if (model === 'openai') {
        // Implementar processamento para OpenAI
        // ...similar ao código acima, mas adaptado para a API OpenAI
        throw new Error('OpenAI agentic cycle not implemented yet.');
      } else {
        throw new Error(`Unsupported model: ${model}`);
      }
    } catch (error) {
      console.error(`[WORKER-${this.id}] Error processing agentic cycle:`, error);
      throw error;
    }
  }

  release(): void {
    this.busy = false;
  }
} 