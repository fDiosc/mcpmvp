#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createAssistant, createThread, sendMessage, createAssistantWithMcpServer } from './client/agents/assistant.js';
import { 
  getJiraIssueTool, 
  getJiraIssueInputSchema, 
  getJiraIssueExecutor,
  // Import new Jira tools
  getDetailedJiraIssueTool,
  getDetailedJiraIssueInputSchema,
  getDetailedJiraIssueExecutor,
  getJiraIssueCommentsTool,
  getJiraIssueCommentsInputSchema,
  getJiraIssueCommentsExecutor,
  getJiraIssueTransitionsTool,
  getJiraIssueTransitionsInputSchema,
  getJiraIssueTransitionsExecutor,
  searchJiraIssuesTool,
  searchJiraIssuesInputSchema,
  searchJiraIssuesExecutor,
  getJiraIssueWatchersTool,
  getJiraIssueWatchersInputSchema,
  getJiraIssueWatchersExecutor,
  getJiraIssueAttachmentsTool,
  getJiraIssueAttachmentsInputSchema,
  getJiraIssueAttachmentsExecutor,
  getJiraIssueSprintsTool,
  getJiraIssueSprintsInputSchema,
  getJiraIssueSprintsExecutor
} from './jiraTool.js';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import dotenv from "dotenv";
import fetch from 'node-fetch';
import { callClaudeDirectAPI, handleToolExecution, convertMcpToolsToAnthropicFormat, formatMessagesForAnthropic } from './anthropicClient.js';
dotenv.config();

/**
 * Type alias for a note object.
 */
type Note = { title: string, content: string };

/**
 * Simple in-memory storage for notes.
 * In a real implementation, this would likely be backed by a database.
 */
const notes: { [id: string]: Note } = {
  "1": { title: "First Note", content: "This is note 1" },
  "2": { title: "Second Note", content: "This is note 2" }
};

console.error('DEBUG: [INICIO] Servidor MCP carregado. PID:', process.pid);

// Crie o servidor MCP normalmente
const server = new McpServer({
  name: "mcp-mvp",
  version: "0.1.0"
});

// Ferramenta para criar nota
server.tool(
  "create_note", 
  {
    title: z.string().describe("Title of the note"),
    content: z.string().describe("Text content of the note")
  },
  async (args, _extra) => {
    console.error('[LOG][TOOL] create_note called:', args);
    const { title, content } = args;
    const id = String(Object.keys(notes).length + 1);
    notes[id] = { title, content };
    console.error('[LOG][TOOL] Nota criada:', { id, title, content });
    console.error('[LOG][TOOL] notes state after create:', notes);
    return {
      content: [{
        type: "text" as const,
        text: `Created note ${id}: ${title}`
      }]
    };
  }
);

// Recurso para listar todas as notas e ler uma nota específica
server.resource(
  "note",
  "note:///{noteId}",
  async (uri) => {
    // Manual parsing of the URI to extract the noteId
    const pathParts = uri.pathname.split('/').filter(Boolean);
    const noteId = pathParts.length > 0 ? pathParts[0] : null;
    
    if (noteId && notes[noteId]) {
      // Return a specific note
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text: notes[noteId].content
        }]
      };
    } else {
      // Return a listing of all notes
      return {
        contents: [],
        resources: Object.entries(notes).map(([id, note]) => ({
          uri: `note:///${id}`,
          mimeType: "text/plain",
          name: note.title,
          description: `A text note: ${note.title}`
        }))
      };
    }
  }
);

// Prompt para sumarizar notas
server.prompt(
  "summarize_notes",
  {},
  async (_args, _extra) => {
    const embeddedNotes = Object.entries(notes).map(([id, note]) => ({
      role: "user" as const,
      content: {
        type: "resource" as const,
        resource: {
          uri: `note:///${id}`,
          mimeType: "text/plain",
          text: note.content
        }
      }
    }));
    
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Please summarize the following notes:"
          }
        },
        ...embeddedNotes,
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Provide a concise summary of all the notes above."
          }
        }
      ]
    };
  }
);

// Existing Jira tool registration
server.tool(
  "get_jira_issue",
  {
    issueKey: z.string().describe("The Jira issue key or ID (e.g., 'PROJ-123')")
  },
  async ({ issueKey }) => {
    const jiraBaseUrl = process.env.JIRA_BASE_URL;
    const jiraUser = process.env.JIRA_USERNAME;
    const jiraToken = process.env.JIRA_API_TOKEN;
    // Log das variáveis de ambiente (token mascarado)
    console.error('[DEBUG][JIRA] JIRA_BASE_URL:', jiraBaseUrl);
    console.error('[DEBUG][JIRA] JIRA_USERNAME:', jiraUser);
    console.error('[DEBUG][JIRA] JIRA_API_TOKEN:', jiraToken ? jiraToken.slice(0, 4) + '...' : undefined);
    if (!jiraBaseUrl || !jiraUser || !jiraToken) {
      return {
        content: [{
          type: "text",
          text: `Jira credentials are not configured in the environment.`
        }]
      };
    }
    const url = `${jiraBaseUrl}/rest/api/3/issue/${issueKey}`;
    const auth = Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64');
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{
            type: "text",
            text: `Error fetching Jira issue: ${response.status} ${response.statusText}\n${errorText}`
          }]
        };
      }
      const data = await response.json();
      return {
        content: [{
          type: "text",
          text: `Issue ${data.key}: ${data.fields.summary}\nStatus: ${data.fields.status.name}`
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error fetching Jira issue: ${err}`
        }]
      };
    }
  }
);

// New Jira tools registration
// 1. Get Detailed Jira Issue
server.tool(
  "get_detailed_jira_issue",
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
    fields: z.string().optional().describe("Comma-separated list of fields to return"),
    expand: z.string().optional().describe("Comma-separated list of entities to expand")
  },
  getDetailedJiraIssueExecutor
);

// 2. Get Jira Issue Comments
server.tool(
  "get_jira_issue_comments",
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
    startAt: z.number().optional().describe("The index of the first item to return"),
    maxResults: z.number().optional().describe("The maximum number of items to return"),
    orderBy: z.string().optional().describe("Order of returned comments (e.g., 'created', '-created')")
  },
  getJiraIssueCommentsExecutor
);

// 3. Get Jira Issue Transitions
server.tool(
  "get_jira_issue_transitions",
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
    expand: z.string().optional().describe("Expand operations for the returned transitions")
  },
  getJiraIssueTransitionsExecutor
);

// 4. Search Jira Issues with JQL
server.tool(
  "search_jira_issues",
  {
    jql: z.string().describe("JQL search query (e.g., \"assignee = currentUser() AND status = 'In Progress'\")"),
    startAt: z.number().optional().describe("The index of the first item to return"),
    maxResults: z.number().optional().describe("The maximum number of items to return"),
    fields: z.string().optional().describe("Comma-separated list of fields to return"),
    expand: z.string().optional().describe("Comma-separated list of entities to expand")
  },
  searchJiraIssuesExecutor
);

// 5. Get Jira Issue Watchers
server.tool(
  "get_jira_issue_watchers",
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
  },
  getJiraIssueWatchersExecutor
);

// 6. Get Jira Issue Attachments
server.tool(
  "get_jira_issue_attachments",
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
  },
  getJiraIssueAttachmentsExecutor
);

// 7. Get Jira Issue Sprints
server.tool(
  "get_jira_issue_sprints",
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
  },
  getJiraIssueSprintsExecutor
);

const app = express();

// Armazena sessões SSE ativas
const sseSessions = new Map();

app.get("/mcp/sse", async (req: Request, res: Response) => {
  // Cria uma nova sessão SSE para cada conexão
  const transport = new SSEServerTransport("/mcp", res);
  sseSessions.set(transport.sessionId, transport);
  // Vincula eventos do servidor MCP ao transporte SSE
  server.connect(transport);
  res.on("close", () => {
    sseSessions.delete(transport.sessionId);
  });
});

app.post("/mcp", express.json(), async (req: Request, res: Response) => {
  // Identifica a sessão pelo sessionId na query
  const sessionId = req.query.sessionId;
  const transport = sseSessions.get(sessionId);
  if (!transport) {
    res.status(400).send("Invalid session");
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

// Endpoint HTTP para listar todas as notas
app.get('/notas', (req: Request, res: Response) => {
  res.json(Object.entries(notes).map(([id, note]) => ({ id, ...note })));
});

// Servir arquivos estáticos do diretório web
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'web')));

let mcpClient: any = null;
let assistant: any = null;
let thread: any = null;

app.use(express.json());

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

async function callClaudeHaiku(messages: any[], tools: any[], sessionIdentifier: string) {
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    messages,
    tools
  };
  try {
    const command = new InvokeModelCommand({
      modelId: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    });
    const response = await bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody;
  } catch (err) {
    console.error('[Bedrock Claude] Error during callClaudeHaiku:', err, '\nRequest body:', JSON.stringify(body));
    throw err;
  }
}

app.post('/chat', async (req: Request, res: Response) => {
  try {
    const selectedModel = req.body.model || 'openai';
    const userInput = req.body.message;
    console.error('[LOG][CHAT] Incoming request:', { model: selectedModel, message: userInput });
    if (!mcpClient) {
      const sseUrl = new URL('http://localhost:3333/mcp/sse');
      const transport = new SSEClientTransport(sseUrl);
      mcpClient = new Client({ name: 'openai-client', version: '0.1.0' });
      await mcpClient.connect(transport);
      console.error('[LOG][CHAT] MCP client connected');
    }
    // Fetch tools from MCP server and format for Bedrock Claude
    const mcpTools = await mcpClient.listTools();
    console.error('[LOG][CHAT] MCP tools listed:', mcpTools.tools);
    const toolsClaude = mcpTools.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || `MCP tool: ${tool.name}`,
      input_schema: tool.inputSchema
    }));
    
    if (selectedModel === 'openai') {
      // OpenAI flow (using assistant and thread)
      if (!assistant) {
        assistant = await createAssistantWithMcpServer('http://localhost:3333/mcp');
        console.error('[LOG][CHAT] OpenAI assistant created with MCP server');
      }
      if (!thread) {
        thread = await createThread();
        console.error('[LOG][CHAT] OpenAI thread created');
      }
      
      try {
        const response = await sendMessage(mcpClient, thread.id, assistant.id, userInput);
        console.error('[LOG][CHAT] OpenAI response received');
        res.json({ response });
      } catch (err) {
        console.error('[OpenAI] Error in sendMessage:', err);
        res.status(500).json({ error: 'Erro ao processar mensagem com OpenAI.' });
      }
    } else if (selectedModel === 'bedrock') {
      // Bedrock Claude flow: use history from frontend if provided
      let messages = Array.isArray(req.body.history) ? req.body.history.slice() : [{ role: "user", content: userInput }];
      let recursion = 0;
      const MAX_RECURSION = 5;
      let finished = false;
      let finalTexts: string[] = [];
      while (!finished && recursion < MAX_RECURSION) {
        let response;
        try {
          // Antes de chamar Claude, garanta que a última mensagem não é do assistente
          if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
            // Não é permitido enviar para Claude, finalize o loop
            break;
          }
          console.error('[LOG][CHAT] Calling Claude with:', { messages, toolsClaude });
          response = await callClaudeHaiku(messages, toolsClaude, '');
          console.error('[LOG][CHAT] Claude response:', response);
        } catch (err) {
          console.error('[Bedrock Claude] Error on Claude call:', err);
          res.status(500).json({ error: 'Erro ao chamar Claude (Bedrock).' });
          return;
        }
        finished = true;
        if (response.type === "message" && Array.isArray(response.content)) {
          for (const block of response.content) {
            if (block.type === "text") {
              finalTexts.push(block.text);
              messages.push({ role: "assistant", content: block.text });
            } else if (block.type === "tool_use") {
              console.error('[LOG][CHAT] Tool use detected:', block);
              try {
                const toolResult = await mcpClient.callTool({ name: block.name, arguments: block.input });
                console.error('[LOG][CHAT] MCP tool result:', toolResult);
                let toolResultContent = [];
                if (toolResult && Array.isArray(toolResult.content)) {
                  toolResultContent = toolResult.content.map((c: any) => ({ type: 'text', text: c.text || JSON.stringify(c) }));
                } else {
                  toolResultContent = [{ type: 'text', text: JSON.stringify(toolResult) }];
                }
                // PATCH: Envia o resultado da tool como mensagem 'user' com JSON estruturado
                let toolResultPayload;
                if (toolResult && typeof toolResult === 'object') {
                  toolResultPayload = JSON.stringify(toolResult);
                } else if (toolResultContent.length === 1 && toolResultContent[0].text) {
                  toolResultPayload = toolResultContent[0].text;
                } else {
                  toolResultPayload = JSON.stringify(toolResultContent);
                }
                messages.push({
                  role: 'user',
                  content: toolResultPayload
                });
                finalTexts.push(toolResultContent.map((c: any) => c.text).join('\n'));
                finished = false;
              } catch (err) {
                console.error('[Bedrock Claude] Error during tool call (recursion ' + recursion + '):', err);
                res.status(500).json({ error: 'Erro ao executar ferramenta MCP para Claude (Bedrock).' });
                return;
              }
            }
          }
          finished = !response.content.some((c: any) => c.type === "tool_use");
        } else {
          finished = true;
        }
        // Se a última mensagem for do assistente, não chame Claude novamente
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
          break;
        }
        recursion++;
      }
      const finalText = finalTexts.join('\n');
      console.error('[LOG][CHAT] Final response to frontend:', finalText);
      res.json({ response: finalText });
    } else if (selectedModel === 'anthropic') {
      // Direct Anthropic API flow
      console.error('[LOG][CHAT] Using direct Anthropic API integration');
      
      // Format messages for Anthropic API
      let messageHistory = Array.isArray(req.body.history) 
        ? formatMessagesForAnthropic(req.body.history) 
        : [];
      
      // Add current user message if not already in history
      if (messageHistory.length === 0 || 
          messageHistory[messageHistory.length - 1].role !== 'user' ||
          ((messageHistory[messageHistory.length - 1].content as any)[0]?.text !== userInput)) {
        messageHistory.push({
          role: 'user',
          content: [{ type: 'text', text: userInput }]
        });
      }
      
      // Convert MCP tools to Anthropic format
      const anthropicTools = convertMcpToolsToAnthropicFormat(mcpTools.tools);
      
      // Create a unique session identifier based on client IP and user agent
      const clientIp = req.ip || '127.0.0.1';
      const userAgent = req.get('user-agent') || 'unknown';
      const sessionIdentifier = `${clientIp}-${userAgent}`;
      
      try {
        // Process multi-turn conversation with tool calls
        let isToolCallPending = true;
        let recursionCount = 0;
        const MAX_RECURSIONS = 5;
        let responseText = '';
        
        // Keep processing tool calls until complete or max recursions reached
        while (isToolCallPending && recursionCount < MAX_RECURSIONS) {
          console.error(`[LOG][ANTHROPIC] Processing turn ${recursionCount + 1}, message history length: ${messageHistory.length}`);
          
          // Call Anthropic API with session identifier
          const claudeResponse = await callClaudeDirectAPI(messageHistory, anthropicTools, sessionIdentifier);
          
          // Extract text response
          const textContents = claudeResponse.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => {
              // Explicitly check and handle the item type
              if (item.type === 'text' && typeof item.text === 'string') {
                return item.text;
              }
              return '';
            });
          
          if (textContents.length > 0) {
            responseText = textContents.join('\n');
          }
          
          // Check for tool use
          const toolUse = claudeResponse.content.find(
            (item: any) => item.type === 'tool_use'
          );
          
          if (toolUse) {
            console.error('[LOG][ANTHROPIC] Tool use detected:', toolUse);
            // Make sure we pass the complete toolUse object, preserving the id
            // Execute the tool
            const executeTool = async (name: string, args: any) => {
              return await mcpClient.callTool({ name, arguments: args });
            };
            
            // Handle tool execution with proper message formatting
            const { messageHistory: updatedHistory } = await handleToolExecution(
              toolUse,
              executeTool,
              messageHistory
            );
            
            // Update message history
            messageHistory = updatedHistory;
            isToolCallPending = true;
            recursionCount++;
          } else {
            // No more tool calls, we're done
            isToolCallPending = false;
            
            // Add final assistant response to history
            if (textContents.length > 0) {
              messageHistory.push({
                role: 'assistant',
                content: [{ type: 'text', text: responseText }]
              });
            }
          }
        }
        
        console.error('[LOG][ANTHROPIC] Final response:', responseText);
        res.json({ 
          response: responseText,
          history: messageHistory // Return updated history for frontend to store
        });
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ERROR][ANTHROPIC] Error processing chat:', errorMessage);
        res.status(500).json({ error: `Error with Anthropic API: ${errorMessage}` });
      }
    } else {
      console.error('[Server] Modelo não suportado:', selectedModel);
      res.status(400).json({ error: 'Modelo não suportado.' });
    }
  } catch (err: any) {
    console.error('[Server] Unhandled error in /chat:', err);
    res.status(500).json({ error: err.message });
  }
});

const port = 3333;
app.listen(port, () => {
  console.error(`DEBUG: [MAIN] MCP SSE/HTTP server listening on port ${port}`);
});
