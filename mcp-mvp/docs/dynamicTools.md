# Dynamic Tool Discovery

This document outlines the dynamic tool discovery feature implemented in the MCP server, which allows clients to request only the tools they need based on context, reducing token usage and improving performance.

## Implementation Status

The dynamic tool discovery system now implements a fully context-based approach:

1. If no context is detected in a user message, no tools are loaded at all.
2. When a specific context is detected, only tools relevant to that context are loaded.

This implementation has been completed and is currently active in the main codebase.

## How It Works

### Context Detection

The system analyzes each user message to identify relevant contexts:

1. **Keyword Analysis**: Searches for context-specific keywords (e.g., "ticket", "note", "sprint")
2. **Pattern Recognition**: Identifies patterns like Jira issue keys (e.g., "PROJ-123")
3. **Context Extraction**: Maps identified keywords to defined contexts

If no recognized context is found in the message, the system returns an empty tools array, which significantly reduces token usage.

### Tool Loading Logic

The tool loading procedure follows this sequence:

1. **User Message Analysis**: Each message is analyzed for context clues
2. **Context to Tool Mapping**: 
   - If context detected: Only tools matching the context are loaded
   - If no context detected: No tools are loaded at all
3. **Category Filtering**: Optional secondary filtering by tool category
4. **Response**: Returns filtered tools with metadata about the filtering process

### Context-to-Tool Matching

Each tool is tagged with relevant contexts:

```json
{
  "create_note": {
    "contexts": ["notes", "writing", "document", "text"],
    "categories": ["creation", "notes"]
  },
  "get_jira_issue": {
    "contexts": ["jira", "tickets", "project management", "issue tracking"],
    "categories": ["jira", "retrieval"]
  }
}
```

The system matches detected contexts against these tool context tags to determine which tools to load.

## Available Contexts

The system recognizes these primary contexts:

- `jira`: Jira issues, tickets, tasks, bugs, etc.
- `notes`: Note taking, writing, documenting
- `agile`: Sprints, scrum, kanban, epics, etc.
- `communication`: Comments, messages, discussions
- `search`: Finding, querying, filtering
- `documents`: Files, attachments, uploads
- `users`: People, assignment, watchers, team members

## API Reference

### Tool Discovery Endpoint

```
GET /tools
```

Query Parameters:
- `context` (string, optional): The current context (e.g., "jira", "notes", "agile")
- `category` (string, optional): Tool category (e.g., "communication", "search", "calculation")
- `userId` (string, optional): User identifier for personalized tool access

Example Response (With Context):
```json
{
  "tools": [
    {
      "name": "get_jira_issue",
      "description": "Get basic information about a Jira issue",
      "inputSchema": { /* JSON Schema object */ },
      "contexts": ["jira", "tickets", "project management", "issue tracking"],
      "categories": ["jira", "retrieval"]
    }
  ],
  "metadata": {
    "timestamp": "2023-06-01T12:00:00Z",
    "requestId": "abc123",
    "filtered": true,
    "originalCount": 9,
    "returnedCount": 3,
    "reductionPercent": 67,
    "appliedContext": "jira"
  }
}
```

Example Response (No Context Detected):
```json
{
  "tools": [],
  "metadata": {
    "timestamp": "2023-06-01T12:00:00Z",
    "requestId": "abc123",
    "filtered": false,
    "originalCount": 0,
    "returnedCount": 0,
    "reductionPercent": 0,
    "reason": "no_context_detected"
  }
}
```

### Metrics Endpoints

#### Get Metrics

```
GET /tools/metrics
```

Example Response:
```json
{
  "baseline": {
    "requests": 100,
    "totalTokens": 50000,
    "avgTokensPerRequest": 500,
    "since": "2023-06-01T12:00:00Z"
  },
  "filtered": {
    "requests": 100,
    "totalTokens": 30000,
    "avgTokensPerRequest": 300,
    "since": "2023-06-01T12:00:00Z"
  },
  "reduction": "40%"
}
```

#### Reset Metrics

```
POST /tools/metrics/reset
```

## Client Library

The system includes a client library with enhanced context detection capabilities:

```typescript
import { DynamicToolClient, extractContextFromMessage } from './client/dynamicTools.js';

// Create a dynamic tools client
const dynamicClient = new DynamicToolClient(mcpClient);

// Extract context from a user message
const contexts = extractContextFromMessage("I need to check PROJ-123 ticket comments");
console.log(contexts); // Outputs: ["jira", "communication"]

// Get tools based on the message directly - returns relevant tools if context detected, empty array if not
const tools = await dynamicClient.getToolsFromMessage("I need to check PROJ-123 ticket comments");

// Or with explicit context
const jiraTools = await dynamicClient.getTools({ context: 'jira' });
```

## Technical Implementation

The core components of the implementation are:

1. **Context Extraction Function**: `extractContextFromMessage()` in `dynamicTools.ts`
   - Analyzes messages for context clues
   - Returns an array of detected contexts

2. **Dynamic Tools Client**: `DynamicToolClient` class in `dynamicTools.ts`
   - Manages tool fetching based on context
   - Handles caching and metrics

3. **Tools Endpoint**: `/tools` route in `index.ts`
   - Filters available tools based on context parameter
   - Returns empty array when no context is provided

## Benefits

The current implementation provides several key benefits:

1. **Minimal Token Usage**: By loading no tools when no context is detected, token usage is significantly reduced
2. **Faster Response Times**: Models process requests much faster with fewer or no tools
3. **Improved User Experience**: More focused responses without irrelevant tool suggestions
4. **Progressive Enhancement**: Tools only appear when they would be useful for the current context

## Testing

Test the context-based filtering with:

```bash
# Run the TypeScript test showing context extraction
npm run test:dynamic-tools

# View current metrics
npm run tools:metrics
```

## Considerations and Potential Risks

While the context-based tool loading approach provides significant benefits, there are some considerations to keep in mind:

### 1. False Negatives in Context Detection

The current keyword-based approach might miss relevant contexts if:
- Users use uncommon terminology
- The conversation is highly implicit
- Referring to concepts by synonyms not in our keyword lists

**Mitigation**: Regularly review and expand the keyword lists in `COMMON_CONTEXTS` object. Consider implementing a more sophisticated NLP-based context detection in the future.

### 2. Multi-Context Scenarios

Some user requests might span multiple contexts that require tools from different domains. The current implementation handles this well by supporting comma-separated contexts, but complex requests may need careful handling.

### 3. Tool Loading Latency

When a context is first detected, there might be a slight latency increase as tools are loaded. This is mitigated by the caching system but could be noticeable in some scenarios.

### 4. Model Performance

While most models perform better with fewer tools, some models might rely on having access to a broader range of tools to understand the complete system capabilities. Testing with different models is recommended.

### 5. Monitoring and Tuning

The actual token savings will vary based on:
- User interaction patterns
- Complexity of tool schemas
- Model being used

Regular monitoring of the `/tools/metrics` endpoint is recommended to understand the real-world impact and fine-tune the context detection as needed.

## Future Enhancements

Possible future enhancements to the system could include:

1. **Machine Learning-Based Context Detection**: Train a small classifier to more accurately detect contexts
2. **User-Specific Context Profiles**: Learn from user interaction patterns
3. **Context Confidence Scoring**: Only load tools when context confidence exceeds a threshold
4. **Conversation Memory**: Consider previous contexts in a conversation for more intelligent tool loading
5. **Automatic Context Discovery**: Dynamically discover contexts based on tool usage patterns 