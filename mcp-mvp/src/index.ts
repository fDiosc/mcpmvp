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
import express, { Request, Response, Express } from "express";
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
import { SessionManager } from './session-manager.js';
import { WorkerPool } from './worker-pool.js';
import { sessionCredentialsMap } from './user-session.js';
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

// Inicializar componentes principais
const sessionManager = new SessionManager();
const workerPool = new WorkerPool(5); // 5 workers concorrentes

const app: Express = express();

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

app.post('/chat', async (req, res) => {
  try {
    const userId = req.body.userId || req.body.productLabUserId || 'anonymous';
    const productLabUserId = req.body.productLabUserId;
    if (!userId) {
      return res.status(400).json({
        error: "Missing_User_ID",
        message: "User ID is required for chat requests"
      });
    }
    // Obter ou criar sessão do usuário
    const userSession = sessionManager.getOrCreateSession(userId, productLabUserId);
    // Atualizar credenciais Jira, se fornecidas
    if (req.body.jiraAuth) {
      userSession.setJiraCredentials(req.body.jiraAuth);
    }
    // Delegar processamento para um worker
    const result = await workerPool.processRequest(
      req.body.message,
      userSession,
      req.body.model || 'anthropic'
    );
    // Retornar resposta
    res.json({
      sessionId: userSession.conversationId,
      ...result
    });
      } catch (err) {
    console.error('[SERVER] Unhandled error in /chat:', err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

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

// Create a helper function to get credentials from context
function getCredentialsFromContext(context: any): any {
  const conversationId = context?._meta?.conversationId as string;
  let credentials = sessionCredentialsMap.get(context?.sessionId as string);
  
  // If no credentials from sessionId, try from conversationId
  if (!credentials && conversationId) {
    credentials = sessionCredentialsMap.get(conversationId);
    if (credentials) {
      console.log(`[JIRA-TOOL] Found credentials via conversationId: ${conversationId}`);
    }
  }
  
  return credentials;
}

// Registro das ferramentas do Jira deve aceitar o parâmetro extra/contexto normalmente
server.tool(getJiraIssueTool.name, { issueKey: z.string().describe("The Jira issue key or ID (e.g., 'PROJ-123')") }, async (args, context) => {
  // Try to get credentials from the session map using the sessionId or from metadata
  const credentials = getCredentialsFromContext(context);
  return getJiraIssueExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

server.tool(getDetailedJiraIssueTool.name, {
  issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
  fields: z.string().optional().describe("Comma-separated list of fields to return"),
  expand: z.string().optional().describe("Comma-separated list of entities to expand")
}, async (args, context) => {
  const credentials = getCredentialsFromContext(context);
  return getDetailedJiraIssueExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

server.tool(getJiraIssueCommentsTool.name, {
  issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
}, async (args, context) => {
  const credentials = getCredentialsFromContext(context);
  return getJiraIssueCommentsExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

server.tool(getJiraIssueTransitionsTool.name, {
  issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')"),
  expand: z.string().optional().describe("Expand operations for the returned transitions")
}, async (args, context) => {
  const credentials = getCredentialsFromContext(context);
  return getJiraIssueTransitionsExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

server.tool(searchJiraIssuesTool.name, {
  jql: z.string().describe("JQL search query (e.g., 'assignee = currentUser() AND status = In Progress')"),
  startAt: z.number().optional().describe("The index of the first item to return"),
  maxResults: z.number().optional().describe("The maximum number of items to return"),
  fields: z.string().optional().describe("Comma-separated list of fields to return"),
  expand: z.string().optional().describe("Comma-separated list of entities to expand")
}, async (args, context) => {
  const credentials = getCredentialsFromContext(context);
  return searchJiraIssuesExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

server.tool(getJiraIssueWatchersTool.name, {
  issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
}, async (args, context) => {
  const credentials = getCredentialsFromContext(context);
  return getJiraIssueWatchersExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

server.tool(getJiraIssueAttachmentsTool.name, {
  issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
}, async (args, context) => {
  const credentials = getCredentialsFromContext(context);
  return getJiraIssueAttachmentsExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

server.tool(getJiraIssueSprintsTool.name, {
  issueKey: z.string().describe("The key of the Jira issue (e.g., 'PROJ-123')")
}, async (args, context) => {
  const credentials = getCredentialsFromContext(context);
  return getJiraIssueSprintsExecutor({
    ...args,
    _jiraCredentials: credentials
  });
});

if (addJiraCommentTool && addJiraCommentExecutor) {
  server.tool(addJiraCommentTool.name, {
    issueKey: z.string().describe("The key of the issue to comment on."),
    body: z.string().describe("The comment text.")
  }, async (args, context) => {
    const credentials = getCredentialsFromContext(context);
    return addJiraCommentExecutor({
      ...args,
      _jiraCredentials: credentials
    });
  });
}

const port = 3333;
app.listen(port, () => {
  console.error(`DEBUG: [MAIN] MCP SSE/HTTP server listening on port ${port}`);
});
