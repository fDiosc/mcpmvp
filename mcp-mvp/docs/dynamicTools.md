# Dynamic Tool Discovery

This document outlines the dynamic tool discovery feature implemented in the MCP server, which allows clients to request only the tools they need based on context, reducing token usage and improving performance.

## Implementation Phases

The implementation is divided into three phases:

### Phase 1: Endpoint + Baseline (Completed)

- Added new `/tools` endpoint that returns all tools but with the infrastructure for filtering
- Collection of baseline metrics on token usage and latency
- No filtering yet - all tools are still returned

### Phase 2: Basic Filtering (Current)

- Implemented context-based filtering of tools
- Added tool categorization and context tagging
- Added smart context extraction from user messages
- Implemented client caching of tool requests
- Target: 30-40% reduction in token usage

### Phase 3: Full Context-Awareness (Future)

- Advanced context-aware tool filtering with ML-based recommendations
- Knowledge graph integration for understanding tool relationships
- Target: 60-80% reduction in token usage

## How Context-Based Filtering Works

In Phase 2, the dynamic tool discovery system:

1. **Tags tools with metadata**: Each tool is tagged with relevant contexts and categories
2. **Analyzes user messages**: Extracts relevant contexts from user input
3. **Matches tools to contexts**: Selects only tools that match the user's current context
4. **Caches results**: Uses client-side caching to improve performance

### Context Matching Algorithm

The matching algorithm:
- Performs fuzzy matching between user context and tool contexts
- Considers both exact matches and related concepts
- Prioritizes tools that are most relevant to the current context

### Available Contexts

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
- `limit` (number, optional): Maximum number of tools to return

Example Response:
```json
{
  "tools": [
    {
      "name": "exampleTool",
      "description": "An example tool",
      "inputSchema": { /* JSON Schema object */ },
      "contexts": ["jira", "search"],
      "categories": ["retrieval"]
    }
  ],
  "metadata": {
    "timestamp": "2023-06-01T12:00:00Z",
    "requestId": "abc123",
    "filtered": true,
    "originalCount": 9,
    "returnedCount": 3,
    "reductionPercent": 67
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

Example Response:
```json
{
  "message": "Metrics reset successfully"
}
```

## Client Library

Phase 2 includes an enhanced client library with context extraction capabilities:

```typescript
import { DynamicToolClient, extractContextFromMessage } from './client/dynamicTools.js';

// Create a dynamic tools client
const dynamicClient = new DynamicToolClient(mcpClient);

// Extract context from a user message
const contexts = extractContextFromMessage("I need to check PROJ-123 ticket comments");
console.log(contexts); // Outputs: ["jira", "communication"]

// Get tools based on the message directly
const messageTools = await dynamicClient.getToolsFromMessage(
  "I need to check PROJ-123 ticket comments"
);

// Get tools with explicit context
const jiraTools = await dynamicClient.getTools({ context: 'jira' });

// Get tools with category
const searchTools = await dynamicClient.getTools({ category: 'search' });

// Get metrics
const metrics = await dynamicClient.getMetrics();

// Reset metrics
await dynamicClient.resetMetrics();
```

## Configuration

To enable context-based filtering, set the environment variable:

```
ENABLE_CONTEXT_FILTERING=true
```

When enabled, the server will automatically filter tools based on the context of each user message, significantly reducing token usage.

## Testing

Use the enhanced test script to test the context-based filtering:

```bash
# Run the TypeScript test showing context extraction
npm run test:dynamic-tools
```

## Metrics Goals

- Phase 1: Establish baseline metrics ✓
- Phase 2: 30-40% reduction in token usage (Current) ✓
- Phase 3: 60-80% reduction in token usage (Future) 