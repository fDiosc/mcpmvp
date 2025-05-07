# Tool Payload Optimization for MCP

## Current Issue

In the current implementation of the MCP-MVP with the Anthropic API integration, we're sending all available tools to the model with every request, which is resulting in significant token usage. As observed in the console output:

```
Input tokens: 1300-1600 per request
```

A considerable portion of these tokens is being consumed by the tool definitions that are repeatedly sent in every request, regardless of whether the tools are needed for that specific interaction. This is especially inefficient for simple follow-up messages or clarification questions where tools aren't being used.

## Impact Analysis

### Token Usage Breakdown

Based on the logs, the tool definitions consume approximately 30-40% of the input tokens in each request. For example, with 9 tools being sent in each request, we're seeing:

- Base conversation context: ~800-1000 tokens
- Tool definitions: ~500-600 tokens

### Cost Implications

The unnecessary repetition of tool definitions leads to:
- Increased API costs
- Slower response times (more tokens to process)
- Reaching token limits faster in complex conversations

## Prompt Caching Implementation Status

We've successfully implemented Anthropic's prompt caching feature, which significantly reduces token usage for repeated content.

### Current Results

Based on our implementation and analysis of the API logs:

1. **Caching Status**: Prompt caching is working successfully with conversation tracking.
2. **Token Savings**: We're seeing significant token savings in some cases:
   - Example: Input 512 tokens with Cache Read 2246 tokens (effectively recycling content)
   - Cost reduction of 56-93% observed in subsequent calls (vs. expected 90%)
3. **Cache Creation Overhead**: Initial cache creation adds overhead (typically 16-25%, but can spike higher)

### Implementation Details

The successful implementation includes:
- Consistent conversation IDs using client IP + user agent as session identifiers
- Strategic application of cache_control markers (limited to 4 per request)
- Padding messages to meet the minimum 2048 token threshold for Claude 3.5 Haiku
- Proper API beta header: `anthropic-beta: prompt-caching-2024-07-31`

### Remaining Challenges

Despite successful caching, we observe:
- Inconsistent cache hit rates
- Occasional high cache overhead (up to 512% in some cases)
- Cases where cache doesn't activate despite meeting token thresholds

## Proposed Solutions for Tool Payload Optimization

### Solution 1: Server-Side Tool Registry

Rather than sending all tool definitions with every request, we could implement a server-side tool registry approach:

1. **Initial Registration**: The client sends all available tools to the MCP server at the start of a session.
2. **Server Storage**: The MCP server stores the tools with a unique session identifier.
3. **Tool References**: In subsequent requests, the client only sends tool references (names/IDs) instead of full definitions.
4. **Server Reconstruction**: Before sending the request to Claude, the server re-attaches the full tool definitions.

**Benefits**:
- Reduces token usage by 30-40% for each request after the initial one
- Works independently of the model's internal caching capabilities
- Can be combined with prompt caching for maximum efficiency

**Implementation Complexity**: Medium
- Requires session management on the server
- Needs changes to the client-server protocol
- Minimal changes to the existing prompt construction logic

### Solution 2: Role-Based Tool Filtering

Another approach is to dynamically determine which tools are needed for each request:

1. **Context Analysis**: Analyze the conversation context to determine which tools might be needed.
2. **Tool Filtering**: Only include tools that are relevant to the current context.
3. **Default Tool Set**: Define smaller sets of "common tools" for typical scenarios.

**Benefits**:
- Reduces token usage by sending only relevant tools
- Doesn't require server-side changes
- Can be improved over time with usage analytics

**Implementation Complexity**: Medium-High
- Requires intelligent context analysis
- May result in tools being unavailable when needed
- Needs careful default configurations

### Solution 3: Tool Definition Compression

Optimize the tool definitions themselves to be more token-efficient:

1. **Concise Descriptions**: Shorten tool descriptions while maintaining clarity.
2. **Schema Simplification**: Simplify input schemas to essential parameters.
3. **Shared Parameter Definitions**: Define common parameters once and reference them.

**Benefits**:
- Reduces token usage without changing architecture
- Simpler implementation
- Immediate benefits for all requests

**Implementation Complexity**: Low
- Mainly involves refactoring existing tool definitions
- No architectural changes needed
- Can be done incrementally

## Recommendation

Based on our analysis of both the prompt caching implementation and tool payload optimization options:

1. **Immediate Action**: Implement Solution 3 (Tool Definition Compression) to achieve quick wins.
2. **Short-term Plan**: Develop Solution 1 (Server-Side Tool Registry) as the most balanced approach.
3. **Long-term Research**: Investigate Solution 2 (Role-Based Tool Filtering) for specific high-value scenarios.

These approaches can be combined with our existing prompt caching implementation for maximum efficiency. We recommend measuring the token usage before and after each implementation to quantify the improvements.

## Next Steps

1. Audit all tool definitions for potential compression
2. Design the server-side tool registry architecture
3. Implement tool compression within the next sprint
4. Continue monitoring prompt caching performance and optimizing as needed 