# Implementing Claude Via Direct Anthropic API

## Overview
This document outlines the implementation plan for adding direct Anthropic API integration to the MCP-MVP project, alongside the existing OpenAI and Claude (Bedrock) integrations. The goal is to provide a more reliable tool use experience with Claude's models.

## Background
The current implementation with Claude via AWS Bedrock has an issue where the model doesn't properly recognize when a tool has been successfully executed. This leads to repetitive tool execution despite receiving success confirmations. By implementing a direct integration with Anthropic's API, we aim to fix this issue by properly formatting tool requests and responses according to Anthropic's specifications.

## Implementation Plan

### Phase 1: Setup Anthropic API Client

1. **Add Dependencies**:
   ```bash
   npm install @anthropic-ai/sdk
   ```

2. **Configure Environment Variables**:
   - Add `ANTHROPIC_API_KEY` to `.env` file:
   ```
   ANTHROPIC_API_KEY=your_anthropic_api_key
   ```

3. **Create Anthropic Client Module**:
   - Create `src/anthropicClient.ts` for client initialization

### Phase 2: Implement Tool Calling with Anthropic API

1. **Create Message Handler Function**:
   - Implement `callClaudeDirectAPI()` function for making API calls
   - Setup proper message and tool formatting

2. **Tool Execution Handler**:
   - Implement `handleToolExecution()` to process tool calls
   - Properly format tool results for Claude

3. **Message History Management**:
   - Implement proper history tracking with typings
   - Support multi-turn conversations

### Phase 3: Update Server Implementation

1. **Modify Chat Endpoint**:
   - Add support for `anthropic` as model selection
   - Implement the API flow for tool execution and response handling

2. **Error Handling**:
   - Add comprehensive error handling for Anthropic API calls
   - Log detailed errors for debugging

### Phase 4: Update Frontend

1. **Add Model Option**:
   - Add "Claude (API Direct)" to the model selection dropdown
   - Ensure message history is properly tracked and sent

2. **Update Response Handling**:
   - Process and display responses correctly
   - Add loading indicators for better UX

### Phase 5: Testing & Documentation

1. **Test Tool Execution**:
   - Test single tool execution
   - Test multi-step tool chains
   - Validate tool results are properly acknowledged

2. **Document API Usage**:
   - Update documentation with Anthropic API details
   - Add code examples for tool calling patterns

## Technical Specifications

### Message Format
```typescript
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  tool_use_id?: string;
  tool_name?: string;
  input?: object;
  content?: string;
}
```

### Tool Response Format
```typescript
// Proper format for tool results
{
  role: "user",
  content: [
    {
      type: "tool_result",
      tool_use_id: "<id_from_tool_use_request>",
      content: "Tool execution result here"
    }
  ]
}
```

## Claude Models

### Available Models

| Model | Anthropic API | AWS Bedrock | GCP Vertex AI |
|-------|---------------|-------------|---------------|
| Claude 3.7 Sonnet | claude-3-7-sonnet-20250219 (claude-3-7-sonnet-latest) | anthropic.claude-3-7-sonnet-20250219-v1:0 | claude-3-7-sonnet@20250219 |
| Claude 3.5 Haiku | claude-3-5-haiku-20241022 (claude-3-5-haiku-latest) | anthropic.claude-3-5-haiku-20241022-v1:0 | claude-3-5-haiku@20241022 |
| Claude 3.5 Sonnet v2 | claude-3-5-sonnet-20241022 (claude-3-5-sonnet-latest) | anthropic.claude-3-5-sonnet-20241022-v2:0 | claude-3-5-sonnet-v2@20241022 |
| Claude 3.5 Sonnet | claude-3-5-sonnet-20240620 | anthropic.claude-3-5-sonnet-20240620-v1:0 | claude-3-5-sonnet-v1@20240620 |
| Claude 3 Opus | claude-3-opus-20240229 (claude-3-opus-latest) | anthropic.claude-3-opus-20240229-v1:0 | claude-3-opus@20240229 |
| Claude 3 Sonnet | claude-3-sonnet-20240229 | anthropic.claude-3-sonnet-20240229-v1:0 | claude-3-sonnet@20240229 |
| Claude 3 Haiku | claude-3-haiku-20240307 | anthropic.claude-3-haiku-20240307-v1:0 | claude-3-haiku@20240307 |

## Expected Benefits

1. **Reliable Tool Execution**: The direct Anthropic API implementation should properly acknowledge tool execution results, preventing repeated tool calls.

2. **Better Control**: Direct API access provides more control over request parameters and formatting.

3. **Latest Features**: Access to the latest Claude features without AWS Bedrock's potential delay in feature updates.

## Timeline

1. Setup & Client Implementation: 1 day
2. Tool Calling Implementation: 1-2 days
3. Frontend Updates: 0.5 day
4. Testing & Debugging: 1 day
5. Documentation & Cleanup: 0.5 day

Total estimated time: 4-5 days

## Dependencies

- Anthropic API key
- NodeJS ≥ 18.x
- @anthropic-ai/sdk package 