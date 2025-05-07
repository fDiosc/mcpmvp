# MCP MVP

A Model Context Protocol (MCP) server implementation with OpenAI and Claude integrations.

## Overview

This project implements a local Model Context Protocol (MCP) server that can be used with OpenAI assistants and Claude models. The server provides tools for creating notes and fetching Jira issues, and exposes them through the MCP protocol.

## Recent Updates

**October 2023: Context-Based Tool Loading**

- Implemented smart context detection from user messages
- Tools are now only loaded when relevant context is detected
- If no context is detected, no tools are loaded at all
- Results in significant token savings and improved response times
- Full documentation in [Dynamic Tools Documentation](docs/dynamicTools.md)

## Features

- Local MCP server with SSE transport
- OpenAI assistants integration (using the official OpenAI SDK)
- Claude integration via AWS Bedrock
- Claude integration via direct Anthropic API
- Web interface for interacting with models
- Note creation and listing
- Jira issue retrieval
- Dynamic tool discovery for reduced token usage

## Setup

### Prerequisites

- Node.js 18+
- OpenAI API key
- AWS credentials (for Bedrock)
- Anthropic API key (for direct Anthropic API)
- Jira credentials (optional)

### Environment Variables

Create a `.env` file with:

```
OPENAI_API_KEY=your_openai_key
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=your_aws_region
ANTHROPIC_API_KEY=your_anthropic_key
JIRA_BASE_URL=your_jira_url
JIRA_USERNAME=your_jira_username
JIRA_API_TOKEN=your_jira_token
```

### Installation

```
npm install
npm run build
```

### Running

```
node build/index.js
```

Then visit http://localhost:3333 in your browser.

## Web Interface

The web interface provides:

- Chat functionality with model selection (OpenAI, Claude Bedrock, or Claude Direct API)
- Conversation history tracking
- Note listing and update
- Tool execution through conversation

## Model Options

1. **OpenAI**: Uses OpenAI's assistants API with native thread management.
2. **Claude (Bedrock)**: Uses Claude via AWS Bedrock, with history managed in browser.
3. **Claude (API Direct)**: Uses Anthropic's API directly with improved tool handling.

### Supported Claude Models

| Model | Anthropic API | AWS Bedrock | 
|-------|---------------|-------------|
| Claude 3.7 Sonnet | claude-3-7-sonnet-20250219 | anthropic.claude-3-7-sonnet-20250219-v1:0 |
| Claude 3.5 Haiku | claude-3-5-haiku-20241022 | anthropic.claude-3-5-haiku-20241022-v1:0 |
| Claude 3.5 Sonnet v2 | claude-3-5-sonnet-20241022 | anthropic.claude-3-5-sonnet-20241022-v2:0 |
| Claude 3.5 Sonnet | claude-3-5-sonnet-20240620 | anthropic.claude-3-5-sonnet-20240620-v1:0 |
| Claude 3 Opus | claude-3-opus-20240229 | anthropic.claude-3-opus-20240229-v1:0 |
| Claude 3 Sonnet | claude-3-sonnet-20240229 | anthropic.claude-3-sonnet-20240229-v1:0 |
| Claude 3 Haiku | claude-3-haiku-20240307 | anthropic.claude-3-haiku-20240307-v1:0 |

## Dynamic Tool Discovery

The server includes an intelligent context-based tool discovery feature to reduce token usage when working with large tool sets. The system now implements the following behavior:

1. If no context is detected in a message, no tools are loaded, regardless of whether it's the first message or later in a conversation.
2. As soon as the model detects an intent/context, it will load only the tools relevant to that context.

### Context Detection

The system automatically analyzes user messages to identify relevant contexts:

- **Jira context**: Detected when messages contain terms like "ticket", "issue", "sprint", or Jira issue keys (e.g., "PROJ-123")
- **Notes context**: Detected for terms like "note", "memo", "write", "document"
- **Agile context**: Detected for terms like "sprint", "agile", "scrum", "kanban"
- **Other contexts**: Communication, search, documents, and users

### Using Dynamic Tools

1. **API Endpoints**:
   - GET `/tools` - Fetches tools based on detected context
   - GET `/tools/metrics` - View token usage metrics
   - POST `/tools/metrics/reset` - Reset metrics

2. **Query Parameters**:
   - `context` - The current conversation context (e.g., "jira", "notes")
   - `category` - Tool category (e.g., "retrieval", "creation")
   - `userId` - User identifier for personalized access

3. **Client Library**:
   ```typescript
   import { DynamicToolClient } from './client/dynamicTools.js';
   
   // Create a dynamic tools client
   const dynamicClient = new DynamicToolClient(mcpClient);
   
   // Automatic context detection from user message
   const tools = await dynamicClient.getToolsFromMessage(userMessage);
   
   // Or manually specify context
   const jiraTools = await dynamicClient.getTools({ context: 'jira' });
   ```

4. **Testing**:
   ```bash
   # Run the TypeScript test
   npm run test:dynamic-tools
   
   # View metrics
   npm run tools:metrics
   
   # Reset metrics
   npm run tools:reset-metrics
   ```

### Benefits

- **Reduced Token Usage**: By only sending relevant tools to the model, token usage is significantly reduced
- **Improved Response Time**: Models process requests faster with fewer tools
- **Context-Aware Responses**: Tools are only presented when relevant to the user's intent
- **Zero-Tool Mode**: When no context is detected, the model operates without tools, saving tokens

For complete implementation details, refer to the source code in `src/client/dynamicTools.ts` and the endpoint in `src/index.ts`.

## Troubleshooting

- If you see "Modelo não suportado" errors, check that your API keys are set properly in the `.env` file.
- If tool calls fail with Claude (Bedrock), try the Claude (API Direct) option which has improved handling of tool execution acknowledgments.
- For direct Anthropic API, ensure you're using a valid model ID (see supported models above).

## Development

- Source code is in TypeScript in the `src` directory
- Frontend interface is in `src/web/index.html`
- Build output goes to the `build` directory
- Run `npm run watch` for development with auto-compilation
