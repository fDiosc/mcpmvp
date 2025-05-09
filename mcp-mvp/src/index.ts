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
import { createAssistant, createThread, sendMessage, createAssistantWithMcpServer, createDynamicAssistant } from './client/agents/assistant.js';
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
import crypto from 'crypto';
import { DynamicToolClient, extractContextFromMessage } from './client/dynamicTools.js';
import { registerSummarizeNotesPrompt, registerToolSelectionPrompt, registerNewsletterPrompt, registerReleaseNotePrompt } from './prompts/index.js';
import { DynamicPromptClient } from './client/dynamicPrompts.js';
import { OpenAI } from "openai";
import Anthropic from "@anthropic-ai/sdk";
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

// Register prompts (moved to prompts module)
registerSummarizeNotesPrompt(server, notes);
registerToolSelectionPrompt(server);
registerNewsletterPrompt(server);
registerReleaseNotePrompt(server);

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
    
    // Create dynamic tool client if not already created
    let dynamicToolClient = new DynamicToolClient(mcpClient);
    // Create dynamic prompt client
    let dynamicPromptClient = new DynamicPromptClient(mcpClient);
    let mcpTools;
    let toolSelectionMethod = '';
    const enableContextFiltering = process.env.ENABLE_CONTEXT_FILTERING === 'true';

    // Verifica se temos um prompt específico a ser usado
    let promptMessages = null;
    let systemPrompt = null;

    // Verificar se temos um prompt contextual usando o cliente de prompts dinâmicos
    console.error('[LOG][CHAT] Checking for prompt context...');
    const promptResult = await dynamicPromptClient.getPromptFromMessage(userInput);
    
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

    // PASSO 2: Detecção de Contexto para Tools
    if (enableContextFiltering) {
      // 1. Tenta keyword mapping
      console.error('[LOG][CHAT] Analyzing user input for context detection (keyword mapping)...');
      const contexts = extractContextFromMessage(userInput);
      if (contexts.length > 0) {
        // Context detected, load respective tools
        toolSelectionMethod = 'keyword';
        console.error(`[LOG][CHAT] [TOOL_SELECTION] Method: keyword | Context detected: ${contexts.join(', ')}`);
        mcpTools = await dynamicToolClient.getToolsFromMessage(userInput);
        console.error(`[LOG][CHAT] Loaded ${mcpTools.tools.length} tools for detected context`);
      } else {
        // 2. Se não encontrou contexto, tenta seleção contextual via LLM
        toolSelectionMethod = 'contextual';
        console.error(`[LOG][CHAT] [TOOL_SELECTION] Method: contextual | No context detected, using LLM-assisted tool selection with model: ${selectedModel}`);
        // Busca todas as ferramentas disponíveis
        const allTools = await dynamicToolClient.getTools({});
        const toolsText = allTools.tools.map((t: any) => `- ${t.name}: ${t.description}`).join('\n');
        // Prompt para seleção contextual
        const promptText = `\nUsuário enviou a seguinte mensagem:\n"${userInput}"\n\nLista de ferramentas disponíveis:\n${toolsText}\n\nQuais ferramentas são relevantes para atender ao pedido do usuário?\nResponda apenas com uma lista de nomes de ferramentas, separados por vírgula.`;
        let llmResponse = '';
        try {
          if (selectedModel === 'openai') {
            // OpenAI: precisa de thread e assistant
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
            // Claude API Direct
            const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: promptText }] }];
            const response = await callClaudeDirectAPI(messages, [], undefined);
            llmResponse = response.content && Array.isArray(response.content) && response.content[0]?.type === 'text' ? response.content[0].text : '';
            console.error('[LOG][CHAT] [TOOL_SELECTION] LLM (Claude API Direct) response for tool selection:', llmResponse);
          } else if (selectedModel === 'bedrock') {
            // Claude Bedrock
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
        // Parseia a resposta do LLM para obter os nomes das ferramentas
        let suggestedToolNames: string[] = [];
        if (llmResponse && typeof llmResponse === 'string') {
          suggestedToolNames = llmResponse.split(',').map(s => s.trim()).filter(Boolean);
        }
        // Filtra as ferramentas sugeridas
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
          // Se o LLM não sugeriu nada, envie array vazio de ferramentas
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
      // Filtering disabled: always send all tools
      toolSelectionMethod = 'all/unfiltered';
      console.error('[LOG][CHAT] [TOOL_SELECTION] Method: all/unfiltered | Context filtering disabled, loading all tools');
      mcpTools = await dynamicToolClient.getTools({});
      console.error(`[LOG][CHAT] Loaded ${mcpTools.tools.length} tools (unfiltered)`);
    }
    
    // Format tools for Bedrock Claude
    const toolsClaude = mcpTools.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || `MCP tool: ${tool.name}`,
      input_schema: tool.inputSchema
    }));
    
    // Track tokens for metrics
    if (mcpTools.tools.length > 0) {
      toolMetrics.trackToolTokens(mcpTools.tools, 'filtered');
    }
    
    if (selectedModel === 'openai') {
      // OpenAI flow (using assistant and thread)
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
          // Se temos um prompt detectado, usamos ele
          console.error('[LOG][CHAT] Using detected prompt for OpenAI...');
          
          // Enviamos cada mensagem do prompt para o thread
          for (const promptMessage of promptMessages) {
            const role = promptMessage.role || 'user';
            let content = '';
            
            if (typeof promptMessage.content === 'string') {
              content = promptMessage.content;
            } else if (promptMessage.content.type === 'text') {
              content = promptMessage.content.text;
            } else {
              // Para outros tipos de conteúdo, convertemos para string
              content = JSON.stringify(promptMessage.content);
            }
            
            await openai.beta.threads.messages.create(thread.id, {
              role: role as any,
              content: content
            });
          }
          
          // Executamos o assistente no thread
          const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: assistant.id
          });
          
          // Aguardamos a conclusão
          let completed = false;
          let runResult;
          
          while (!completed) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runResult = await openai.beta.threads.runs.retrieve(thread.id, run.id);
            
            if (runResult.status === 'completed' || 
                runResult.status === 'failed' || 
                runResult.status === 'cancelled') {
              completed = true;
            }
          }
          
          // Obtemos as mensagens mais recentes
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
          // Fluxo normal sem prompt
          response = await sendMessage(mcpClient, thread.id, assistant.id, userInput);
        }
        
        console.error('[LOG][CHAT] OpenAI response received');
        res.json({ response });
      } catch (err) {
        console.error('[OpenAI] Error in sendMessage:', err);
        res.status(500).json({ error: 'Erro ao processar mensagem com OpenAI.' });
      }
    } else if (selectedModel === 'bedrock') {
      // Bedrock Claude flow: use history from frontend if provided
      let messages = Array.isArray(req.body.history) ? req.body.history.slice() : [];
      
      // Se detectamos um prompt, usamos ele
      if (promptMessages) {
        console.error('[LOG][CHAT] Using detected prompt for Bedrock Claude...');
        
        // Converte as mensagens do prompt para o formato esperado pelo Bedrock
        messages = promptMessages.map(pm => {
          if (typeof pm.content === 'string') {
            return { role: pm.role, content: pm.content };
          } else if (pm.content.type === 'text') {
            return { role: pm.role, content: pm.content.text };
          } else {
            // Para outros tipos de conteúdo, convertemos para string
            return { role: pm.role, content: JSON.stringify(pm.content) };
          }
        });
      } else if (messages.length === 0) {
        // Se não temos histórico nem prompt, usamos apenas a mensagem do usuário
        messages = [{ role: "user", content: userInput }];
      } else if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
        // Se a última mensagem no histórico não é do usuário, adicionamos a atual
        messages.push({ role: "user", content: userInput });
      }
      
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
      // Claude via API direta da Anthropic
      console.error('[LOG][CHAT] Using direct Anthropic API integration');
      
      // A mensagem a ser enviada depende se detectamos um prompt ou não
      let userMessage = { 
        role: 'user' as const, 
        content: [{ 
          type: 'text' as const, 
          text: userInput 
        }]
      };
      
      let messages = [];
      if (promptMessages) {
        console.error('[LOG][CHAT] Using detected prompt for Anthropic API');
        messages = promptMessages;
      } else {
        // Apenas a mensagem do usuário
        messages = [userMessage];
      }
      
      // Se o histórico foi fornecido, incorpore-o
      const providedHistory = req.body.history || [];
      if (providedHistory && Array.isArray(providedHistory) && providedHistory.length > 0) {
        // Use apenas o histórico existente se não for a primeira mensagem
        if (messages.length === 1 && messages[0].role === 'user') {
          // Insira o histórico antes da mensagem atual
          messages = [...providedHistory, ...messages];
          console.error(`[LOG][CHAT] Incorporated ${providedHistory.length} message(s) from history`);
        }
      }
      
      // Log das mensagens formatadas para depuração
      console.error('[LOG][CHAT] Anthropic messages:', JSON.stringify(messages));
      
      const clientId = req.body.sessionId || `${req.ip}-${req.headers['user-agent']}`;
      
      // Transforma as ferramentas MCP para o formato Anthropic
      const anthropicTools = convertMcpToolsToAnthropicFormat(mcpTools.tools);
      
      try {
        // Chama a API da Anthropic usando o helper existente
        let response = await callClaudeDirectAPI(
          messages, 
          anthropicTools, 
          clientId,
          systemPrompt as string | undefined
        );
        console.error('[LOG][CHAT] Anthropic API response received');
        
        // Verificar se temos uma execução de ferramenta a realizar
        if (response.stop_reason === 'tool_use' && response.content) {
          console.error('[LOG][TOOLS] Tool use detected, initiating tool execution flow');
          
          // Encontrar o bloco tool_use
          const toolUseBlock = response.content.find((block: any) => block.type === 'tool_use');
          if (toolUseBlock) {
            console.error(`[LOG][TOOLS] Tool to execute: ${toolUseBlock.name}`);
            
            // Cria uma função para executar a ferramenta usando o servidor MCP
            const executeTool = async (name: string, args: any) => {
              console.error(`[LOG][TOOLS] Executing tool: ${name} with args:`, args);
              try {
                // Encontra a ferramenta por nome
                const tool = mcpTools.tools.find((t: any) => t.name === name);
                if (!tool) {
                  throw new Error(`Tool not found: ${name}`);
                }
                
                // Executa a ferramenta usando o cliente MCP
                const result = await mcpClient.callTool({ name, arguments: args });
                console.error(`[LOG][TOOLS] Tool execution result:`, result);
                return result;
              } catch (error) {
                console.error(`[ERROR][TOOLS] Error executing tool ${name}:`, error);
                throw error;
              }
            };
            
            // Usa handleToolExecution para executar a ferramenta e atualizar o histórico
            const { messageHistory } = await handleToolExecution(
              toolUseBlock,
              executeTool,
              JSON.parse(JSON.stringify(messages)) // Deep copy para evitar mutações
            );
            
            // Continua a conversa com o resultado da ferramenta
            console.error(`[LOG][CHAT] Continuing conversation with tool result, history length: ${messageHistory.length}`);
            response = await callClaudeDirectAPI(
              messageHistory,
              anthropicTools,
              clientId,
              systemPrompt as string | undefined
            );
            
            // Atualiza o histórico para a próxima iteração
            messages = messageHistory;
          }
        }
        
        // Processa o histórico para retornar ao cliente
        const history = [...messages]; // Começa com o histórico existente
        
        // Extrai a resposta de texto
        let responseText = '';
        if (response && response.content && Array.isArray(response.content)) {
          const textBlocks = response.content.filter((block: any) => block.type === 'text');
          if (textBlocks.length > 0) {
            responseText = textBlocks.map((block: any) => block.text).join('\n');
          }
        }
        
        // Adiciona a resposta do assistente ao histórico (somente se não for ferramenta)
        if (responseText) {
          history.push({
            role: 'assistant',
            content: responseText
          });
        }
        
        // Retorna a resposta com o histórico atualizado
        res.json({ 
          response: responseText,
          history: history
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

// Add new endpoint for dynamic tool discovery
app.get('/tools', (req: Request, res: Response) => {
  try {
    const enableContextFiltering = process.env.ENABLE_CONTEXT_FILTERING === 'true';
    // Extract query parameters (for future filtering)
    const context = req.query.context as string | undefined;
    const category = req.query.category as string | undefined;
    const userId = req.query.userId as string | undefined;
    
    // Log the request
    console.error(`[LOG][TOOLS] Tool discovery request received: context=${context}, category=${category}, userId=${userId}`);
    
    // Get all tools from the MCP server
    // Since the McpServer API doesn't have a public way to directly access all tools,
    // we'll build the list from the available tool names in the server.
    const allTools: any[] = [];
    
    // Get all tools registered with the server by name and construct tool objects
    const toolNames = [
      'create_note',
      'get_jira_issue',
      'get_detailed_jira_issue',
      'get_jira_issue_comments',
      'get_jira_issue_transitions',
      'search_jira_issues',
      'get_jira_issue_watchers',
      'get_jira_issue_attachments',
      'get_jira_issue_sprints'
    ];
    
    // Add tool categories and contexts for filtering in Phase 2
    const toolMetadata: Record<string, { description: string, contexts: string[], categories: string[] }> = {
      'create_note': {
        description: 'Create a new note with title and content',
        contexts: ['notes', 'writing', 'document', 'text'],
        categories: ['creation', 'notes']
      },
      'get_jira_issue': {
        description: 'Get basic information about a Jira issue',
        contexts: ['jira', 'tickets', 'project management', 'issue tracking'],
        categories: ['jira', 'retrieval']
      },
      'get_detailed_jira_issue': {
        description: 'Get detailed information about a Jira issue',
        contexts: ['jira', 'tickets', 'project management', 'issue tracking', 'details'],
        categories: ['jira', 'retrieval', 'details']
      },
      'get_jira_issue_comments': {
        description: 'Get comments from a Jira issue',
        contexts: ['jira', 'tickets', 'comments', 'communication', 'discussion'],
        categories: ['jira', 'comments', 'communication']
      },
      'get_jira_issue_transitions': {
        description: 'Get available transitions for a Jira issue',
        contexts: ['jira', 'workflow', 'status', 'transitions'],
        categories: ['jira', 'workflow', 'status']
      },
      'search_jira_issues': {
        description: 'Search for Jira issues using JQL',
        contexts: ['jira', 'search', 'query', 'filter', 'find'],
        categories: ['jira', 'search', 'query']
      },
      'get_jira_issue_watchers': {
        description: 'Get watchers of a Jira issue',
        contexts: ['jira', 'watchers', 'users', 'notifications'],
        categories: ['jira', 'users', 'watchers']
      },
      'get_jira_issue_attachments': {
        description: 'Get attachments of a Jira issue',
        contexts: ['jira', 'attachments', 'files', 'documents'],
        categories: ['jira', 'attachments', 'files']
      },
      'get_jira_issue_sprints': {
        description: 'Get sprints associated with a Jira issue',
        contexts: ['jira', 'sprints', 'agile', 'scrum'],
        categories: ['jira', 'sprints', 'agile']
      }
    };
    
    // Build the tool objects with metadata
    for (const name of toolNames) {
      const metadata = toolMetadata[name] || { 
        description: `Tool: ${name}`,
        contexts: [],
        categories: []
      };
      
      allTools.push({
        name,
        description: metadata.description,
        inputSchema: {}, // We can't easily retrieve the actual input schema here
        contexts: metadata.contexts,
        categories: metadata.categories
      });
    }
    
    if (!enableContextFiltering) {
      // Filtering disabled: always return all tools
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
        // Match by context if provided
        return tool.contexts.some((c: string) => 
          context.toLowerCase().split(',').some(contextPart => 
            c.toLowerCase().includes(contextPart.trim()) || 
            contextPart.trim().includes(c.toLowerCase())
          )
        );
      });
    }
    
    // If no tools match the context, return empty array
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
    
    // Additional category filtering if specified
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
        description: 'Resumir todas as notas do sistema',
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
