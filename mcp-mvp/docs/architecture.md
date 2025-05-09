# MCP MVP Architecture

## Overview

The MCP MVP implements a multi-model architecture that integrates with OpenAI and Claude through multiple interfaces. The system has evolved to use a specialized agentic architecture to improve performance, reduce token usage, and maintain better conversation context.

## Agentic Architecture

The system implements a novel agentic flow architecture where specialized "agent" functions handle different aspects of the conversation:

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

### Agent Components

1. **Tool Selection Agent**
   - Makes a separate LLM call to determine which tools are relevant for a given user query
   - Uses a specialized prompt that focuses on determining tool relevance
   - Maintains its own conversation history for context consistency
   - Implemented in `src/index.ts` using `app.post('/chat')` route handlers that make specific LLM calls for tool selection

2. **Prompt Detection Agent**
   - Analyzes messages to detect if they match specialized prompt patterns
   - Uses a lightweight model and specialized detection logic
   - Implemented in `src/client/dynamicPrompts.ts` using separate LLM calls

3. **Main Conversation Agent**
   - Handles the primary conversation with the user
   - Only receives tools selected by the Tool Selection Agent
   - Includes conversation history and appropriate caching mechanisms
   - Implemented through the primary LLM call handlers

4. **Tool Execution Component**
   - Processes tool execution requests from the model
   - Formats results to be incorporated back into the conversation
   - Handles error cases and provides feedback to the model
   - Implemented in `src/anthropicClient.ts` via `handleToolExecution()`

## Anthropic Integration

### Direct API Integration

The Claude integration uses direct API calls to Anthropic with specialized prompt handling:

1. **Conversation Management**
   - Conversations are tracked using unique IDs stored in a `conversationStore`
   - Sessions expire after 30 minutes (configurable) to maintain fresh context
   - Each session maintains its own conversation context

2. **Prompt Caching Implementation**

The system leverages Anthropic's prompt caching feature for improved performance:

```typescript
// API call with cache control headers
const response = await anthropic.messages.create(
  {
    model: "claude-3-5-haiku-20241022",
    messages: messagesWithCaching,
    tools: formattedTools,
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

Key components of the caching implementation:

- **Cache Control Markers**: The system adds up to 4 cache control blocks strategically placed in the conversation
- **Conversation IDs**: Each session maintains a unique conversation ID to preserve cache validity
- **Token Threshold**: Messages must exceed 2048 tokens to benefit from caching
- **Cache Application Strategy**:
  1. First user message in conversation
  2. Middle of conversation (when more than 6 messages)
  3. Second-to-last user message
  4. Latest user message

### Tool Execution Flow

1. The model identifies the need to use a tool and returns a `tool_use` block
2. The system extracts the tool name and input parameters
3. The MCP client executes the appropriate tool
4. Results are formatted and added to the conversation history
5. The model continues the conversation with the new context

## Dynamic Tool Discovery

The system implements context-aware tool discovery:

1. **Context Detection**:
   - User messages are analyzed to identify relevant contexts
   - Default contexts include: jira, notes, agile, communication

2. **Tool Selection Process**:
   - If context filtering is enabled, only tools matching the detected context are provided
   - Tool selection is made via a specialized LLM prompt
   - Results are filtered to ensure only available tools are selected

3. **Metrics Tracking**:
   - The system tracks token usage for different methods of tool selection
   - Metrics APIs allow for analyzing efficiency and optimizing token usage

## Prompt Detection

The prompt detection system:

1. Analyzes user messages to identify if they match specialized prompt patterns
2. Uses a lightweight LLM call with a tailored detection prompt
3. Returns structured prompt content when a match is found
4. Incorporates the prompt into the main conversation flow

## Model Integrations

The system supports three primary model integration paths:

1. **OpenAI Assistants**:
   - Uses the official OpenAI SDK
   - Creates dynamic assistants with updated tools
   - Handles thread management and tool execution

2. **Claude via Bedrock**:
   - Integrates with AWS Bedrock for Claude access
   - Manages conversation history in the browser
   - Handles formatting for Bedrock's API expectations

3. **Claude via Direct API**:
   - Uses Anthropic's API directly
   - Implements prompt caching for improved performance
   - Includes enhanced tool handling with conversation maintenance

## Key Components

### Backend API Routes

- `/chat`: Main endpoint for conversation processing
- `/tools`: API for dynamic tool discovery
- `/tools/metrics`: Metrics collection and reporting
- `/prompts`: Prompt registration and execution

### Client Components

- `anthropicClient.ts`: Claude API integration including prompt caching
- `dynamicTools.ts`: Context-based tool discovery
- `dynamicPrompts.ts`: Prompt detection and application
- `client/agents`: Model-specific integrations (OpenAI, etc.)

## Performance Considerations

The agentic architecture offers several performance benefits:

1. **Reduced Token Usage**:
   - Only relevant tools are included in each request
   - Specialized agents use lightweight models when possible
   - Prompt caching reduces token processing for repetitive content

2. **Improved Response Time**:
   - Cached prompts process faster
   - Reduced context size leads to quicker responses
   - Tool execution is streamlined

3. **Better Context Management**:
   - Each agent maintains focused context
   - Main conversation remains uncluttered
   - Tool executions are properly incorporated into history 