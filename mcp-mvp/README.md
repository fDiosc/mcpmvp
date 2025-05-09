# MCP MVP

A Model Context Protocol (MCP) server implementation with OpenAI and Claude integrations.

## Overview

This project implements a local Model Context Protocol (MCP) server that can be used with OpenAI assistants and Claude models. The server provides tools for creating notes and fetching Jira issues, and exposes them through the MCP protocol.

## Recent Updates

**May 2024: Improved Claude Integration & Prompt Caching**

- Added Anthropic prompt caching support for improved performance
- Fixed conversation context persistence across multi-tool interactions
- Enhanced error handling in tool execution flows
- Optimized cache control for larger conversations

**March 2024: Agentic Flow Architecture**

- Implemented an emergent agentic architecture with specialized "agent" functions:
  - Tool Selection Agent: Analyzes user queries to determine relevant tools
  - Prompt Detection Agent: Identifies if special prompts should be applied
  - Conversation Agent: Maintains the main conversation with selected tools
- Each agent maintains its own conversation context and operates independently
- Reduced token usage by only passing relevant tools to the main conversation

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
- Claude integration via direct Anthropic API with prompt caching
- Web interface for interacting with models
- Note creation and listing
- Jira issue retrieval and management
- Dynamic tool discovery for reduced token usage
- Agentic flow architecture for optimal context handling

## Architecture

The system implements a novel agentic architecture where:

### Agent Components

1. **Tool Selection Agent**
   - Analyzes user queries using a separate LLM call
   - Determines which tools are contextually relevant
   - Maintains a separate conversation context to focus on tool relevance

2. **Prompt Detection Agent**
   - Evaluates if user messages match special prompts
   - Helps format conversations for specific tasks
   - Uses lightweight model calls to minimize token usage

3. **Main Conversation Agent**
   - Maintains the complete conversation history
   - Uses only the tools selected by the Tool Selection Agent
   - Handles tool execution and result incorporation
   - Applies prompt caching for improved performance

### Communication Flow

```
User Query
   ↓
┌─────────────────┐     ┌─────────────────┐
│ Tool Selection  │     │ Prompt Detection│
│     Agent       │     │     Agent       │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └─────────┬─────────────┘
                   ↓
         ┌─────────────────────┐
         │  Main Conversation  │
         │       Agent         │
         └─────────┬───────────┘
                   ↓
         ┌─────────────────────┐
         │     Tool Execution  │
         │                     │
         └─────────┬───────────┘
                   ↓
              User Response
```

### Claude Prompt Caching

The system now leverages Anthropic's prompt caching feature to improve performance and reduce costs:

- Cache control markers are strategically placed in conversations
- Up to 4 cache control blocks are applied to optimize caching
- Messages over 2048 tokens benefit from cache optimization
- Conversation IDs are preserved to maintain cache validity
- Detailed logs track cache creation/reading efficiency

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
ENABLE_CONTEXT_FILTERING=true
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
3. **Claude (API Direct)**: Uses Anthropic's API directly with improved tool handling and prompt caching.

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

### Prompt Detection and Management

The system can detect when specialized prompts should be applied:

```typescript
import { DynamicPromptClient } from './client/dynamicPrompts.js';

// Create a dynamic prompt client
const promptClient = new DynamicPromptClient(mcpClient);

// Detect if a message matches a specific prompt
const promptResult = await promptClient.getPromptFromMessage(userMessage);
if (promptResult) {
  console.log(`Detected prompt: ${promptResult.promptName}`);
  // Use the formatted prompt messages
  const messages = promptResult.promptContent;
}
```

### Anthropic Prompt Caching

For conversations using the Claude API directly, the system implements prompt caching to improve performance:

```typescript
// API call with cache control headers
const response = await anthropic.messages.create(
  {
    model: "claude-3-5-haiku-20241022",
    messages: messagesWithCaching, // Messages with cache_control markers
    temperature: 0.7
  },
  {
    headers: {
      "anthropic-beta": "prompt-caching-2024-07-31",
      "anthropic-conversation-id": conversationId
    }
  }
);
```

## Troubleshooting

- If you see "Modelo não suportado" errors, check that your API keys are set properly in the `.env` file.
- If tool calls fail with Claude (Bedrock), try the Claude (API Direct) option which has improved handling of tool execution acknowledgments.
- For direct Anthropic API, ensure you're using a valid model ID (see supported models above).
- If caching isn't working properly, ensure conversations exceed the 2048 token minimum threshold.
- For tool selection issues, check the logs for the Tool Selection Agent responses.

## Development

- Source code is in TypeScript in the `src` directory
- Frontend interface is in `src/web/index.html`
- Build output goes to the `build` directory
- Run `npm run watch` for development with auto-compilation
