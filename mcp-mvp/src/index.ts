#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

import './logger.js'; // This should be the very first import to ensure console is patched early.
import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createAssistant, createThread, sendMessage, createAssistantWithMcpServer, createDynamicAssistant } from './client/agents/assistant.js';
import { 
  getJiraIssueTool, 
  getJiraIssueExecutor,
  getDetailedJiraIssueTool,
  getDetailedJiraIssueExecutor,
  getJiraIssueCommentsTool,
  getJiraIssueCommentsExecutor,
  getJiraIssueTransitionsTool,
  getJiraIssueTransitionsExecutor,
  searchJiraIssuesTool,
  searchJiraIssuesExecutor,
  getJiraIssueWatchersTool,
  getJiraIssueWatchersExecutor,
  getJiraIssueAttachmentsTool,
  getJiraIssueAttachmentsExecutor,
  getJiraIssueSprintsTool,
  getJiraIssueSprintsExecutor,
  addJiraCommentTool,
  addJiraCommentExecutor
} from './jiraTool.js';
import { UserJiraCredentials, RequestContext } from './types.js';
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import dotenv from "dotenv";
import fetch from 'node-fetch';
import { callClaudeDirectAPI, handleToolExecution, convertMcpToolsToAnthropicFormat, formatMessagesForAnthropic } from './anthropicClient.js';
import crypto from 'crypto';
import { DynamicToolClient, extractContextFromMessage } from './client/dynamicTools.js';
import { registerSummarizeNotesPrompt, registerToolSelectionPrompt, registerNewsletterPrompt, registerReleaseNotePrompt } from './prompts/index.js';
import { DynamicPromptClient } from './client/dynamicPrompts.js';
import { OpenAI } from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { CustomAnthropicMessage, CustomContentBlock } from './anthropicClient.js';
import { v4 as uuidv4 } from 'uuid';
dotenv.config();

// Instância do OpenAI para chamar a API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Instância do Anthropic para chamar a API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

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

console.log('[MCP] Servidor iniciado com sucesso.');

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

// Register prompts (moved to prompts module)
registerSummarizeNotesPrompt(server, notes);
registerToolSelectionPrompt(server);
registerNewsletterPrompt(server);
registerReleaseNotePrompt(server);

// Module-scoped variable to hold context for the current /chat request (USE WITH EXTREME CAUTION - SEE COMMENTS)
let currentChatRequestContext: RequestContext | null = null;

// Helper function to safely extract RequestContext
// TRYING THE MODULE-SCOPED HACK HERE
function getRequestContextFromExtra(extra: any): RequestContext {
  if (currentChatRequestContext) {
    // console.warn('[getRequestContextFromExtra] Using currentChatRequestContext hack for user:', currentChatRequestContext.productLabUserId || 'N/A');
    return currentChatRequestContext;
  }
  // Fallback if the hack isn't set (e.g., for tools called in other ways, or if 'extra' eventually contains it)
  if (extra && typeof extra === 'object' && 'requestContext' in extra) {
    // console.warn('[getRequestContextFromExtra] Found requestContext in extra parameter.');
    return extra.requestContext as RequestContext;
  }
  // console.warn('[getRequestContextFromExtra] RequestContext not found. Jira tools might not use user-specific credentials if env vars are off.');
  return {}; 
}

// MODIFIED Jira tool registration for get_jira_issue
server.tool(
  getJiraIssueTool.name, 
  {
    issueKey: z.string().describe("The Jira issue key or ID (e.g., 'PROJ-123')")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return getJiraIssueExecutor(args, requestContext);
  }
);

// 1. Get Detailed Jira Issue
server.tool(
  getDetailedJiraIssueTool.name,
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
    fields: z.string().optional().describe("Comma-separated list of fields to return"),
    expand: z.string().optional().describe("Comma-separated list of entities to expand")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return getDetailedJiraIssueExecutor(args, requestContext);
  }
);

// 2. Get Jira Issue Comments
server.tool(
  getJiraIssueCommentsTool.name,
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
    startAt: z.number().optional().describe("The index of the first item to return"),
    maxResults: z.number().optional().describe("The maximum number of items to return"),
    orderBy: z.string().optional().describe("Order of returned comments (e.g., 'created', '-created')")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return getJiraIssueCommentsExecutor(args, requestContext);
  }
);

// 3. Get Jira Issue Transitions
server.tool(
  getJiraIssueTransitionsTool.name,
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
    expand: z.string().optional().describe("Expand operations for the returned transitions")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return getJiraIssueTransitionsExecutor(args, requestContext);
  }
);

// 4. Search Jira Issues with JQL
server.tool(
  searchJiraIssuesTool.name,
  {
    jql: z.string().describe("JQL search query (e.g., \"assignee = currentUser() AND status = 'In Progress'\")"),
    startAt: z.number().optional().describe("The index of the first item to return"),
    maxResults: z.number().optional().describe("The maximum number of items to return"),
    fields: z.string().optional().describe("Comma-separated list of fields to return"),
    expand: z.string().optional().describe("Comma-separated list of entities to expand")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return searchJiraIssuesExecutor(args, requestContext);
  }
);

// 5. Get Jira Issue Watchers
server.tool(
  getJiraIssueWatchersTool.name,
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return getJiraIssueWatchersExecutor(args, requestContext);
  }
);

// 6. Get Jira Issue Attachments
server.tool(
  getJiraIssueAttachmentsTool.name,
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return getJiraIssueAttachmentsExecutor(args, requestContext);
  }
);

// 7. Get Jira Issue Sprints
server.tool(
  getJiraIssueSprintsTool.name,
  {
    issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
  },
  async (args, extra: any) => {
    const requestContext = getRequestContextFromExtra(extra);
    return getJiraIssueSprintsExecutor(args, requestContext);
  }
);

// Example for addJiraCommentTool
if (addJiraCommentTool && addJiraCommentExecutor) {
  server.tool(
    addJiraCommentTool.name,
    {
      issueKey: z.string().describe("The key of the issue to comment on."),
      body: z.string().describe("The comment text.")
    },
    async (args, extra: any) => {
      const requestContext = getRequestContextFromExtra(extra);
      return addJiraCommentExecutor(args, requestContext);
    }
  );
}

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

// Endpoint para listar notas
app.get('/notas', (_req, res) => {
  try {
    const notasList = Object.entries(notes).map(([id, nota]) => ({
      id,
      title: nota.title,
      content: nota.content
    }));
    
    res.json(notasList);
  } catch (err) {
    console.error('Error listing notes:', err);
    res.status(500).json({ error: 'Erro ao listar notas.' });
  }
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

// Add tool metrics tracking object
const toolMetrics = {
  baseline: {
    requestCount: 0,
    totalTokens: 0,
    timeStamp: Date.now()
  },
  filtered: {
    requestCount: 0,
    totalTokens: 0,
    timeStamp: Date.now()
  },
  // Rough estimate of tokens for a tool definition
  estimateTokenCount: (tools: any[]): number => {
    let count = 0;
    for (const tool of tools) {
      // Approximate calculation: name + description + schema properties
      const nameTokens = tool.name.length / 4;
      const descTokens = (tool.description?.length || 0) / 4;
      const schemaTokens = JSON.stringify(tool.inputSchema || {}).length / 4;
      count += nameTokens + descTokens + schemaTokens;
    }
    return Math.ceil(count);
  },
  // Track the tokens used for tools in a request
  trackToolTokens: (tools: any[], phase: 'baseline' | 'filtered'): void => {
    const tokenEstimate = toolMetrics.estimateTokenCount(tools);
    toolMetrics[phase].requestCount++;
    toolMetrics[phase].totalTokens += tokenEstimate;
  },
  // Get current metrics report
  getMetricsReport: (): any => {
    const baseline = toolMetrics.baseline;
    const filtered = toolMetrics.filtered;
    
    const baselineAvg = baseline.requestCount > 0 
      ? Math.round(baseline.totalTokens / baseline.requestCount) 
      : 0;
      
    const filteredAvg = filtered.requestCount > 0 
      ? Math.round(filtered.totalTokens / filtered.requestCount) 
      : 0;
      
    const reduction = baselineAvg > 0 && filteredAvg > 0
      ? Math.round(((baselineAvg - filteredAvg) / baselineAvg) * 100)
      : 0;
      
    return {
      baseline: {
        requests: baseline.requestCount,
        totalTokens: baseline.totalTokens,
        avgTokensPerRequest: baselineAvg,
        since: new Date(baseline.timeStamp).toISOString()
      },
      filtered: {
        requests: filtered.requestCount,
        totalTokens: filtered.totalTokens,
        avgTokensPerRequest: filteredAvg,
        since: new Date(filtered.timeStamp).toISOString()
      },
      reduction: `${reduction}%`
    };
  },
  // Reset metrics
  resetMetrics: (): void => {
    toolMetrics.baseline = {
      requestCount: 0,
      totalTokens: 0,
      timeStamp: Date.now()
    };
    toolMetrics.filtered = {
      requestCount: 0,
      totalTokens: 0,
      timeStamp: Date.now()
    };
  }
};

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

app.post('/chat', (async (req: Request, res: Response): Promise<void> => {
  // Clear any previous request's context at the very start
  currentChatRequestContext = null; 

  const USE_ENV_FOR_JIRA_CREDENTIALS = process.env.USE_ENV_FOR_JIRA_CREDENTIALS === 'true';
  let activeRequestContext: RequestContext = {}; 

  if (!USE_ENV_FOR_JIRA_CREDENTIALS) {
    const userJiraCreds = req.body.jiraAuth as UserJiraCredentials | undefined;
    const productLabUserId = req.body.productLabUserId as string | undefined;

    if (!userJiraCreds || !userJiraCreds.baseUrl || !userJiraCreds.username || !userJiraCreds.apiToken) {
      console.error('[CHAT_ERROR] Dynamic Jira credentials required but not provided or incomplete.');
      res.status(400).json({
        error: "Jira_Credentials_Required",
        message: "User Jira credentials are required. Please ensure jiraAuth: { baseUrl, username, apiToken } is sent."
      });
      return;
    }
    activeRequestContext.userJiraCredentials = userJiraCreds;
    if (productLabUserId) {
      activeRequestContext.productLabUserId = productLabUserId;
    }
    console.log(`[CHAT_INFO] Using dynamic Jira credentials for ProductLab user: ${productLabUserId || 'N/A'}`);
  } else {
    console.log('[CHAT_INFO] Using environment Jira credentials (USE_ENV_FOR_JIRA_CREDENTIALS=true).');
  }

  // SET THE MODULE-SCOPED VARIABLE for this request
  currentChatRequestContext = activeRequestContext;

  // (req as any).requestContext = activeRequestContext; // This line is less relevant if using the module-scoped hack

  try {
    const selectedModel = req.body.model || 'openai';
    const userInput = req.body.message;
    console.error('[LOG][CHAT] Incoming request:', { model: selectedModel, message: userInput, productLabUserId: activeRequestContext.productLabUserId });
    
    if (!mcpClient) {
      const sseUrl = new URL('http://localhost:3333/mcp/sse');
      const transport = new SSEClientTransport(sseUrl);
      mcpClient = new Client({ name: 'openai-client', version: '0.1.0' });
      await mcpClient.connect(transport);
      console.error('[LOG][CHAT] MCP client connected');
    }
    
    let dynamicToolClient = new DynamicToolClient(mcpClient);
    let dynamicPromptClient = new DynamicPromptClient(mcpClient);
    let mcpTools;
    let toolSelectionMethod = '';
    const enableContextFiltering = process.env.ENABLE_CONTEXT_FILTERING === 'true';

    let promptMessages = null;
    let systemPrompt = null;

    console.error('[LOG][CHAT] Checking for prompt context...');
    const promptResult = await dynamicPromptClient.getPromptFromMessage(userInput, selectedModel);
    
    if (promptResult) {
      console.error(`[LOG][CHAT] [PROMPT_SELECTION] Detected prompt: ${promptResult.promptName}`);
      systemPrompt = promptResult.system;
      promptMessages = [
        ...(promptResult.promptContent || []),
        { 
          role: 'user',
          content: [{
            type: 'text',
            text: userInput
          }]
        }
      ];
      console.error('[LOG][DYNAMIC_PROMPT] Formatted messages:', JSON.stringify(promptMessages));
    } else {
      console.error('[LOG][CHAT] No specific prompt context detected, proceeding with normal flow');
    }

    if (enableContextFiltering) {
      console.error('[LOG][CHAT] Analyzing user input for context detection (keyword mapping)...');
      const contexts = extractContextFromMessage(userInput);
      if (contexts.length > 0) {
        toolSelectionMethod = 'keyword';
        console.error(`[LOG][CHAT] [TOOL_SELECTION] Method: keyword | Context detected: ${contexts.join(', ')}`);
        mcpTools = await dynamicToolClient.getToolsFromMessage(userInput);
        console.error(`[LOG][CHAT] Loaded ${mcpTools.tools.length} tools for detected context`);
      } else {
        toolSelectionMethod = 'contextual';
        console.error(`[LOG][CHAT] [TOOL_SELECTION] Method: contextual | No context detected, using LLM-assisted tool selection with model: ${selectedModel}`);
        const allTools = await dynamicToolClient.getTools({});
        const toolsText = allTools.tools.map((t: any) => `- ${t.name}: ${t.description}`).join('\n');
        const promptText = `\nUsuário enviou a seguinte mensagem:\n"${userInput}"\n\nLista de ferramentas disponíveis:\n${toolsText}\n\nQuais ferramentas são relevantes para atender ao pedido do usuário?\nResponda apenas com uma lista de nomes de ferramentas, separados por vírgula.`;
        let llmResponse = '';
        try {
          if (selectedModel === 'openai') {
            if (!assistant) {
              assistant = await createDynamicAssistant(mcpClient);
              console.error('[LOG][CHAT] OpenAI assistant created with MCP tools as functions');
            }
            if (!thread) {
              thread = await createThread();
              console.error('[LOG][CHAT] OpenAI thread created');
            }
            llmResponse = await sendMessage(mcpClient, thread.id, assistant.id, promptText);
            console.error('[LOG][CHAT] [TOOL_SELECTION] LLM (OpenAI) response for tool selection:', llmResponse);
          } else if (selectedModel === 'anthropic') {
            const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: promptText }] }];
            const response = await callClaudeDirectAPI(messages, [], undefined);
            llmResponse = response.content && Array.isArray(response.content) && response.content[0]?.type === 'text' ? response.content[0].text : '';
            console.error('[LOG][CHAT] [TOOL_SELECTION] LLM (Claude API Direct) response for tool selection:', llmResponse);
          } else if (selectedModel === 'bedrock') {
            const messages = [{ role: 'user', content: promptText }];
            const response = await callClaudeHaiku(messages, [], '');
            llmResponse = response?.content?.[0]?.text || '';
            console.error('[LOG][CHAT] [TOOL_SELECTION] LLM (Claude Bedrock) response for tool selection:', llmResponse);
          } else {
            throw new Error('Modelo não suportado para seleção contextual');
          }
        } catch (err) {
          console.error('[LOG][CHAT] [TOOL_SELECTION] Error calling LLM for tool selection:', err);
        }
        let suggestedToolNames: string[] = [];
        if (llmResponse && typeof llmResponse === 'string') {
          suggestedToolNames = llmResponse.split(',').map(s => s.trim()).filter(Boolean);
        }
        const relevantTools = allTools.tools.filter((t: any) => suggestedToolNames.includes(t.name));
        if (relevantTools.length > 0) {
          mcpTools = {
            tools: relevantTools,
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: crypto.randomUUID().toString(),
              filtered: true,
              originalCount: allTools.tools.length,
              returnedCount: relevantTools.length,
              reductionPercent: Math.round(((allTools.tools.length - relevantTools.length) / allTools.tools.length) * 100),
              reason: 'contextual_llm_selection'
            }
          };
          console.error(`[LOG][CHAT] [TOOL_SELECTION] LLM selected ${relevantTools.length} tools: ${relevantTools.map((t: any) => t.name).join(', ')}`);
        } else {
          toolSelectionMethod = 'contextual_none';
          mcpTools = {
            tools: [],
            metadata: {
              timestamp: new Date().toISOString(),
              requestId: crypto.randomUUID().toString(),
              filtered: true,
              originalCount: allTools.tools.length,
              returnedCount: 0,
              reductionPercent: 100,
              reason: 'contextual_llm_none_suggested'
            }
          };
          console.error('[LOG][CHAT] [TOOL_SELECTION] LLM did not suggest any tools, returning empty tool array');
        }
      }
    } else {
      toolSelectionMethod = 'all/unfiltered';
      console.error('[LOG][CHAT] [TOOL_SELECTION] Method: all/unfiltered | Context filtering disabled, loading all tools');
      mcpTools = await dynamicToolClient.getTools({});
      console.error(`[LOG][CHAT] Loaded ${mcpTools.tools.length} tools (unfiltered)`);
    }
    
    const toolsClaude = mcpTools.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || `MCP tool: ${tool.name}`,
      input_schema: tool.inputSchema
    }));
    
    if (mcpTools.tools.length > 0) {
      toolMetrics.trackToolTokens(mcpTools.tools, 'filtered');
    }
    
    if (selectedModel === 'openai') {
      if (!assistant) {
        assistant = await createDynamicAssistant(mcpClient);
        console.error('[LOG][CHAT] OpenAI assistant created with MCP tools as functions');
      }
      if (!thread) {
        thread = await createThread();
        console.error('[LOG][CHAT] OpenAI thread created');
      }
      
      try {
        let response;
        if (promptMessages) {
          console.error('[LOG][CHAT] Using detected prompt for OpenAI...');
          
          for (const promptMessage of promptMessages) {
            const role = promptMessage.role || 'user';
            let content = '';
            
            if (typeof promptMessage.content === 'string') {
              content = promptMessage.content;
            } else if (promptMessage.content.type === 'text') {
              content = promptMessage.content.text;
            } else {
              content = JSON.stringify(promptMessage.content);
            }
            
            await openai.beta.threads.messages.create(thread.id, {
              role: role as any,
              content: content
            });
          }
          
          const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: assistant.id
          });
          
          let completed = false;
          let runResult;
          
          while (!completed) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runResult = await openai.beta.threads.runs.retrieve(thread.id, run.id);
            console.log('[DEBUG][OPENAI][RUN STATUS]', runResult.status, runResult);

            if (runResult.status === 'requires_action' && runResult.required_action && runResult.required_action.submit_tool_outputs) {
              const toolCalls = runResult.required_action.submit_tool_outputs.tool_calls;
              const tool_outputs = [];
              for (const call of toolCalls) {
                const toolName = call.function.name;
                const args = JSON.parse(call.function.arguments);
                console.log('[DEBUG][OPENAI][TOOL OUTPUTS][CALL]', toolName, args, 'with context for (via hack):', currentChatRequestContext?.productLabUserId);
                
                const result = await mcpClient.callTool({ name: toolName, arguments: args });
                
                let output = '';
                if (result?.content && Array.isArray(result.content) && result.content[0]?.text) {
                  output = result.content[0].text;
                } else {
                  output = JSON.stringify(result);
                }
                tool_outputs.push({ tool_call_id: call.id, output });
              }
              console.log('[DEBUG][OPENAI][TOOL OUTPUTS][SUBMIT]', tool_outputs);
              const submitResult = await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, { tool_outputs });
              console.log('[DEBUG][OPENAI][TOOL OUTPUTS][RESPONSE]', submitResult);
            }

            if (runResult.status === 'completed' || 
                runResult.status === 'failed' || 
                runResult.status === 'cancelled') {
              completed = true;
            }
          }
          
          const messages = await openai.beta.threads.messages.list(thread.id, {
            order: 'desc',
            limit: 1
          });
          
          if (messages.data.length > 0) {
            const latestMessage = messages.data[0];
            if (latestMessage.content && latestMessage.content.length > 0) {
              const content = latestMessage.content[0];
              if (content.type === 'text') {
                response = content.text.value;
              } else {
                response = JSON.stringify(content);
              }
            }
          }
        } else {
          response = await sendMessage(mcpClient, thread.id, assistant.id, userInput);
        }
        
        console.error('[LOG][CHAT] OpenAI response received');
        res.json({ response });
        return;
      } catch (err) {
        console.error('[OpenAI] Error in sendMessage:', err);
        res.status(500).json({ error: 'Erro ao processar mensagem com OpenAI.' });
        return;
      }
    } else if (selectedModel === 'bedrock') {
      let messages = Array.isArray(req.body.history) ? req.body.history.slice() : [];
      
      if (promptMessages) {
        console.error('[LOG][CHAT] Using detected prompt for Bedrock Claude...');
        
        messages = promptMessages.map(pm => {
          if (typeof pm.content === 'string') {
            return { role: pm.role, content: pm.content };
          } else if (pm.content.type === 'text') {
            return { role: pm.role, content: pm.content.text };
          } else {
            return { role: pm.role, content: JSON.stringify(pm.content) };
          }
        });
      } else if (messages.length === 0) {
        messages = [{ role: "user", content: userInput }];
      } else if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
        messages.push({ role: "user", content: userInput });
      }
      
      let recursion = 0;
      const MAX_RECURSION = 5;
      let finished = false;
      let finalTexts: string[] = [];
      
      while (!finished && recursion < MAX_RECURSION) {
        let response;
        try {
          if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
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
              console.error('[LOG][CHAT] Tool use detected:', block, 'with context for (via hack):', currentChatRequestContext?.productLabUserId);
              try {
                const toolResult = await mcpClient.callTool({ name: block.name, arguments: block.input });
                console.error('[LOG][CHAT] MCP tool result:', toolResult);
                let toolResultContent = [];
                if (toolResult && Array.isArray(toolResult.content)) {
                  toolResultContent = toolResult.content.map((c: any) => ({ type: 'text', text: c.text || JSON.stringify(c) }));
                } else {
                  toolResultContent = [{ type: 'text', text: JSON.stringify(toolResult) }];
                }
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
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
          break;
        }
        recursion++;
      }
      const finalText = finalTexts.join('\n');
      console.error('[LOG][CHAT] Final response to frontend:', finalText);
      res.json({ response: finalText });
      return;
    } else if (selectedModel === 'anthropic') {
      console.error('[LOG][CHAT] Using direct Anthropic API integration');
      
      const userInputText = typeof req.body.message === 'string' ? req.body.message : JSON.stringify(req.body.message);

      let currentTurnMessages: CustomAnthropicMessage[] = [];
      const providedHistory = req.body.history || [];

      if (Array.isArray(providedHistory) && providedHistory.length > 0) {
        console.error('[LOG][ANTHROPIC] Initializing with history provided by client.');
        currentTurnMessages = JSON.parse(JSON.stringify(providedHistory));
      }

      currentTurnMessages.push({ 
        role: 'user' as const, 
        content: [{ type: 'text' as const, text: userInputText }] 
      });
      
      const clientId = req.body.sessionId || `jira-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      console.error(`[LOG][ANTHROPIC] Usando ID de sessão para cache: ${clientId}`);
      
      const anthropicTools = convertMcpToolsToAnthropicFormat(mcpTools.tools);
      let finished = false;
      let recursion = 0;
      const MAX_RECURSION = 5;
      let apiResponseObject: any;
      
      const toolCallTracker = new Set<string>(); 
      
      try {
        while (!finished && recursion < MAX_RECURSION) {
          console.error(`[LOG][ANTHROPIC] Chamada para Claude API (iteração ${recursion + 1}/${MAX_RECURSION})`);
          
          apiResponseObject = await callClaudeDirectAPI(
            currentTurnMessages,
            anthropicTools,
            clientId,
            systemPrompt as string | undefined
          );
          
          const assistantResponseContent: CustomContentBlock[] = (apiResponseObject.content || [])
            .map((block: any): CustomContentBlock | null => {
              if (block.type === 'text') return { type: 'text', text: block.text } as CustomContentBlock;
              if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input } as CustomContentBlock;
              return null;
            })
            .filter((block: any): block is CustomContentBlock => block !== null);

          if (assistantResponseContent.length > 0) {
            currentTurnMessages.push({
              role: 'assistant',
              content: assistantResponseContent,
            });
          } else if (apiResponseObject.stop_reason === 'end_turn' && !apiResponseObject.content?.some((b:any) => b.type === 'text')) {
            currentTurnMessages.push({role: 'assistant', content: [{type: 'text', text: ""}] });
          }

          if (apiResponseObject.stop_reason === 'tool_use') {
            finished = false;
            const toolUseBlocks = assistantResponseContent.filter(block => block.type === 'tool_use');
            
            if (!toolUseBlocks || toolUseBlocks.length === 0) {
              console.error("[LOG][ANTHROPIC] Stop reason is tool_use, but no tool_use blocks found in content. Breaking.");
              finished = true;
              break;
            }

            const toolResultsForThisTurn: CustomContentBlock[] = [];

            for (const toolUseBlock of toolUseBlocks) {
              if (!toolUseBlock.id || !toolUseBlock.name) {
                 console.error("[LOG][ANTHROPIC] Invalid tool_use block received:", toolUseBlock);
                 toolResultsForThisTurn.push({
                    type: 'tool_result',
                    tool_use_id: toolUseBlock.id || `error_unknown_tool_id_${uuidv4()}`,
                    content: "Error: Tool use block was malformed."
                 });
                 continue;
              }

              const toolCallSignature = `${toolUseBlock.name}_${JSON.stringify(toolUseBlock.input || {})}`;
              if (toolCallTracker.has(toolCallSignature)) {
                console.warn(`[LOG][ANTHROPIC] Duplicate tool call detected and blocked: ${toolUseBlock.name}`);
                toolResultsForThisTurn.push({
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: `Error: Tool ${toolUseBlock.name} was called again with the exact same parameters in this turn. This indicates a potential loop.`
                });
                continue; 
              }
              toolCallTracker.add(toolCallSignature);

              console.error(`[LOG][ANTHROPIC] Processando chamada de ferramenta: ${toolUseBlock.name}`);
              try {
                const executionResult = await mcpClient.callTool({ name: toolUseBlock.name, arguments: toolUseBlock.input });
                let resultStringContent: string;

                if (executionResult && executionResult.content && Array.isArray(executionResult.content) && executionResult.content.length > 0) {
                  resultStringContent = executionResult.content[0].text || JSON.stringify(executionResult.content[0]);
                } else if (typeof executionResult.content === 'string') {
                  resultStringContent = executionResult.content;
                } else {
                  resultStringContent = JSON.stringify(executionResult);
                }
                
                toolResultsForThisTurn.push({
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: resultStringContent
                });
              } catch (toolExecError: any) {
                console.error(`[ERROR][ANTHROPIC] Erro ao executar ferramenta ${toolUseBlock.name}:`, toolExecError);
                toolResultsForThisTurn.push({
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: `Error executing tool ${toolUseBlock.name}: ${toolExecError.message}`
                });
              }
            }

            if (toolResultsForThisTurn.length > 0) {
              currentTurnMessages.push({
                role: 'user',
                content: toolResultsForThisTurn,
              });
            }
            if (toolResultsForThisTurn.every(tr => (tr as any).is_error && toolCallTracker.has(`${(toolUseBlocks.find(tu => tu.id === tr.tool_use_id) || {}).name}_${JSON.stringify((toolUseBlocks.find(tu => tu.id === tr.tool_use_id) || {}).input || {})}`))) {
                console.warn("[LOG][ANTHROPIC] All tool calls in this step were duplicate errors. Breaking to prevent loop.");
                finished = true;
            }

          } else {
            finished = true;
            console.error(`[LOG][ANTHROPIC] Processamento concluído por Claude, motivo: ${apiResponseObject.stop_reason}`);
          }
          recursion++;
        }

        if (recursion >= MAX_RECURSION) {
          console.warn("[LOG][ANTHROPIC] Max recursion depth reached for tool processing.");
        }

        let finalResponseText = '';
        const lastAssistantMsg = currentTurnMessages.filter(m => m.role === 'assistant').pop();
        if (lastAssistantMsg && Array.isArray(lastAssistantMsg.content)) {
          finalResponseText = lastAssistantMsg.content
            .filter((c: CustomContentBlock) => c.type === 'text' && c.text)
            .map((c: CustomContentBlock) => c.text)
            .join('\n');
        } else if (lastAssistantMsg && typeof lastAssistantMsg.content === 'string') {
            finalResponseText = lastAssistantMsg.content;
        }
        
        if (!finalResponseText && apiResponseObject && apiResponseObject.stop_reason !== 'end_turn') {
            finalResponseText = "[O assistente terminou de usar ferramentas, mas não forneceu uma mensagem de texto final.]";
        }

        console.error('[LOG][CHAT] Final response to frontend:', { text: finalResponseText, historyLength: currentTurnMessages.length });
        res.json({ 
          response: finalResponseText,
          history: currentTurnMessages
        });
        return;

      } catch (err: any) {
        console.error('[ERROR][ANTHROPIC_CHAT_HANDLER]', err);
        if (err.status === 400 && err.error?.error?.message?.includes("unexpected `tool_use_id`")) {
             console.error('[LOG][ANTHROPIC] Detectado erro de estrutura (400) na API Anthropic. O histórico pode estar malformado.');
        }
        res.status(err.status || 500).json({ error: `Erro ao processar mensagem com Anthropic (Direto): ${err.message}` });
        return;
      }
    } else {
      console.error('[Server] Modelo não suportado:', selectedModel);
      res.status(400).json({ error: 'Modelo não suportado.' });
      return;
    }
  } catch (err: any) {
    console.error('[Server] Unhandled error in /chat:', err);
    res.status(500).json({ error: err.message });
    return;
  } finally {
    // CRITICAL: Clear the module-scoped variable after the request is processed
    currentChatRequestContext = null;
  }
}) as any); // Cast to any to bypass the stubborn linter error for now

// Add new endpoint for dynamic tool discovery
app.get('/tools', (req: Request, res: Response) => {
  try {
    const enableContextFiltering = process.env.ENABLE_CONTEXT_FILTERING === 'true';
    const context = req.query.context as string | undefined;
    const category = req.query.category as string | undefined;
    const userId = req.query.userId as string | undefined;
    
    console.error(`[LOG][TOOLS] Tool discovery request received: context=${context}, category=${category}, userId=${userId}`);
    
    const allTools: any[] = [];
    
    const toolNames = [
      'create_note',
      getJiraIssueTool.name,
      getDetailedJiraIssueTool.name,
      getJiraIssueCommentsTool.name,
      getJiraIssueTransitionsTool.name,
      searchJiraIssuesTool.name,
      getJiraIssueWatchersTool.name,
      getJiraIssueAttachmentsTool.name,
      getJiraIssueSprintsTool.name
    ];
    
    const defaultToolMetadata: Record<string, { description: string; contexts: string[]; categories: string[] }> = {
      'create_note': {
        description: 'Create a new text note with a title and content',
        contexts: ['notes', 'text', 'create', 'new', 'information storage'],
        categories: ['creation', 'notes']
      },
      [getJiraIssueTool.name]: {
        description: 'Get basic information about a Jira issue',
        contexts: ['jira', 'tickets', 'project management', 'issue tracking'],
        categories: ['jira', 'retrieval']
      },
      [getDetailedJiraIssueTool.name]: {
        description: 'Get detailed information about a Jira issue',
        contexts: ['jira', 'tickets', 'project management', 'issue tracking', 'details'],
        categories: ['jira', 'retrieval', 'details']
      },
      [getJiraIssueCommentsTool.name]: {
        description: 'Get comments from a Jira issue',
        contexts: ['jira', 'tickets', 'comments', 'communication', 'discussion'],
        categories: ['jira', 'comments', 'communication']
      },
      [getJiraIssueTransitionsTool.name]: {
        description: 'Get available transitions for a Jira issue',
        contexts: ['jira', 'workflow', 'status', 'transitions'],
        categories: ['jira', 'workflow', 'status']
      },
      [searchJiraIssuesTool.name]: {
        description: 'Search for Jira issues using JQL',
        contexts: ['jira', 'search', 'query', 'filter', 'find'],
        categories: ['jira', 'search', 'query']
      },
      [getJiraIssueWatchersTool.name]: {
        description: 'Get watchers of a Jira issue',
        contexts: ['jira', 'watchers', 'users', 'notifications'],
        categories: ['jira', 'users', 'watchers']
      },
      [getJiraIssueAttachmentsTool.name]: {
        description: 'Get attachments of a Jira issue',
        contexts: ['jira', 'attachments', 'files', 'documents'],
        categories: ['jira', 'attachments', 'files']
      },
      [getJiraIssueSprintsTool.name]: {
        description: 'Get sprints associated with a Jira issue',
        contexts: ['jira', 'sprints', 'agile', 'scrum'],
        categories: ['jira', 'sprints', 'agile']
      }
    };
    
    for (const name of toolNames) {
      const metadata = defaultToolMetadata[name] || { 
        description: `Tool: ${name}`,
        contexts: [],
        categories: []
      };
      
      allTools.push({
        name,
        description: metadata.description,
        inputSchema: {},
        contexts: metadata.contexts,
        categories: metadata.categories
      });
    }
    
    if (!enableContextFiltering) {
      console.error('[LOG][TOOLS] Context filtering disabled, returning all tools');
      res.json({
        tools: allTools,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
          filtered: false,
          originalCount: allTools.length,
          returnedCount: allTools.length,
          reductionPercent: 0,
          reason: 'context_filtering_disabled'
        }
      });
      return;
    }
    
    let filteredTools = allTools;
    if (enableContextFiltering && context) {
      filteredTools = allTools.filter(tool => {
        return tool.contexts.some((c: string) => 
          context.toLowerCase().split(',').some(contextPart => 
            c.toLowerCase().includes(contextPart.trim()) || 
            contextPart.trim().includes(c.toLowerCase())
          )
        );
      });
    }
    
    if (filteredTools.length === 0) {
      console.error(`[LOG][TOOLS] No matching tools found for context: ${context}`);
      res.json({
        tools: [],
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: crypto.randomUUID(),
          filtered: true,
          originalCount: allTools.length,
          returnedCount: 0,
          reductionPercent: 100,
          reason: 'no_matching_tools'
        }
      });
      return;
    }
    
    if (category) {
      filteredTools = filteredTools.filter(tool => {
        return tool.categories.some((c: string) => 
          c.toLowerCase().includes(category.toLowerCase()) ||
          category.toLowerCase().includes(c.toLowerCase())
        );
      });
    }
    
    
    // Track metrics
    if (filteredTools.length < allTools.length) {
      toolMetrics.trackToolTokens(filteredTools, 'filtered');
    } else {
      toolMetrics.trackToolTokens(filteredTools, 'baseline');
    }
    
    console.error(`[LOG][TOOLS] Returning ${filteredTools.length} tools out of ${allTools.length}`);
    
    // Return the filtered tools
    res.json({
      tools: filteredTools,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: crypto.randomUUID(),
        filtered: true,
        originalCount: allTools.length,
        returnedCount: filteredTools.length,
        reductionPercent: Math.round(((allTools.length - filteredTools.length) / allTools.length) * 100),
        appliedContext: context
      }
    });
  } catch (error) {
    console.error(`[ERROR][TOOLS] Error in tool discovery:`, error);
    res.status(500).json({
      error: 'Internal server error during tool discovery',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add endpoint to view current metrics
app.get('/tools/metrics', (req: Request, res: Response) => {
  res.json(toolMetrics.getMetricsReport());
});

// Add endpoint to reset metrics
app.post('/tools/metrics/reset', (req: Request, res: Response) => {
  toolMetrics.resetMetrics();
  res.json({ message: 'Metrics reset successfully' });
});

// Adicione o endpoint após o handler de '/chat'
app.get('/prompts/list', async (_req, res) => {
  try {
    // CORREÇÃO: Não usar mcpClient.prompts().list() porque a API pode não existir
    // Em vez disso, definir os prompts manualmente
    const formattedPrompts = [
      { 
        name: 'summarize_notes', 
        description: 'Resumir todas as notas do sistema, essa tool só deve ser usada se o usuário pedir para resumir notas',
        arguments: []
      },
      { 
        name: 'newsletter_post', 
        description: 'Criar um post de newsletter sobre novos recursos',
        arguments: [
          { name: 'feature', description: 'Description of the new feature' },
          { name: 'context', description: 'Additional context or target audience for the newsletter' }
        ]
      },
      { 
        name: 'release_note', 
        description: 'Criar uma nota de lançamento para uma versão',
        arguments: [
          { name: 'summary', description: 'Summary of the release or feature' },
          { name: 'details', description: 'Additional details, bug fixes, improvements, etc.' }
        ]
      },
      { 
        name: 'tool_selection', 
        description: 'Selecionar ferramentas adequadas para uma tarefa',
        arguments: [
          { name: 'userMessage', description: 'Mensagem do usuário' },
          { name: 'toolsText', description: 'Lista de ferramentas disponíveis em texto formatado' }
        ]
      }
    ];
    
    console.error('[LOG][PROMPTS] Serving hardcoded prompts list');
    res.json(formattedPrompts);
  } catch (err) {
    console.error('Error listing prompts:', err);
    res.status(500).json({ error: 'Erro ao listar prompts disponíveis.' });
  }
});

// Endpoint para obter e verificar um prompt específico
app.get('/prompts/:name', async (req, res) => {
  try {
    const promptName = req.params.name;
    const params = req.query;
    
    // Remove o tipo de qualquer parâmetro
    const cleanParams: Record<string, any> = {};
    Object.entries(params).forEach(([key, value]) => {
      cleanParams[key] = value;
    });
    
    console.error(`[LOG][PROMPTS] Getting prompt "${promptName}" with params:`, cleanParams);
    
    // CORREÇÃO: Implementação manual para cada tipo de prompt
    let promptResult;
    if (promptName === 'newsletter_post') {
      const feature = cleanParams.feature || 'Unnamed feature';
      const context = cleanParams.context || '';
      
      promptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `\nA new feature has been developed: "${feature}".\n${context ? `Context: ${context}` : ""}\nWrite a newsletter post announcing this feature. The post should be engaging, clear, and suitable for our audience.`
            }
          }
        ]
      };
    } else if (promptName === 'release_note') {
      const summary = cleanParams.summary || 'Unnamed release';
      const details = cleanParams.details || '';
      
      promptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `\nRelease Note:\nSummary: "${summary}"\n${details ? `Details: ${details}` : ""}\nWrite a clear and concise release note for this update. Use a professional tone and highlight the most important changes.`
            }
          }
        ]
      };
    } else if (promptName === 'summarize_notes') {
      promptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please summarize all the notes in the system."
            }
          }
        ]
      };
    } else if (promptName === 'tool_selection') {
      const userMessage = cleanParams.userMessage || '';
      const toolsText = cleanParams.toolsText || '';
      
      promptResult = {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `\nUsuário enviou a seguinte mensagem:\n"${userMessage}"\n\nLista de ferramentas disponíveis:\n${toolsText}\n\nQuais ferramentas são relevantes para atender ao pedido do usuário?\nResponda apenas com uma lista de nomes de ferramentas, separados por vírgula.`
            }
          }
        ]
      };
    } else {
      throw new Error(`Prompt "${promptName}" não encontrado`);
    }
    
    console.error(`[LOG][PROMPTS] Serving hardcoded prompt "${promptName}"`);
    res.json(promptResult);
  } catch (err) {
    console.error('Error getting prompt:', err);
    res.status(500).json({ error: 'Erro ao obter prompt.' });
  }
});

const port = 3333;
app.listen(port, () => {
  console.error(`DEBUG: [MAIN] MCP SSE/HTTP server listening on port ${port}`);
});
