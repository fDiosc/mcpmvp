# Jira API Tools Implementation Plan

## Overview

Based on the Jira REST API v3 documentation, we need to implement additional Jira tools beyond the existing `getJiraIssue` tool. These tools will allow users to:

1. Get more detailed information from Jira issues
2. Search for issues using JQL (Jira Query Language)
3. Retrieve additional information like comments, sprints, and assignees

## Authentication & Base Configuration

All tools will share the same authentication mechanism and base configuration:

```typescript
// Environment variables needed:
// - JIRA_BASE_URL: The base URL of the Jira instance (e.g., https://your-domain.atlassian.net)
// - JIRA_USERNAME: Username for Jira authentication
// - JIRA_API_TOKEN: API token for Jira authentication

// Authentication function
function getJiraAuthHeaders() {
  const username = process.env.JIRA_USERNAME;
  const apiToken = process.env.JIRA_API_TOKEN;
  const auth = Buffer.from(`${username}:${apiToken}`).toString('base64');
  return {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
  };
}
```

## Tools to Implement

### 1. Get Detailed Jira Issue

Expand the existing `getJiraIssue` tool to include more fields and information.

```typescript
// Tool: getDetailedJiraIssue
// Endpoint: GET /rest/api/3/issue/{issueKey}
// Parameters:
// - issueKey: The key of the Jira issue (e.g., "PROJ-123")
// - fields: Optional. Comma-separated list of fields to return
// - expand: Optional. Comma-separated list of entities to expand (e.g., "renderedFields,changelog,transitions,names")
```

### 2. Get Jira Issue Comments

Retrieve all comments for a specific issue.

```typescript
// Tool: getJiraIssueComments
// Endpoint: GET /rest/api/3/issue/{issueKey}/comment
// Parameters:
// - issueKey: The key of the Jira issue
// - startAt: Optional. The index of the first item to return
// - maxResults: Optional. The maximum number of items to return
// - orderBy: Optional. Order of returned comments (e.g., "created", "-created")
```

### 3. Get Jira Issue Transitions

Retrieve available transitions for an issue.

```typescript
// Tool: getJiraIssueTransitions
// Endpoint: GET /rest/api/3/issue/{issueKey}/transitions
// Parameters:
// - issueKey: The key of the Jira issue
```

### 4. Search Jira Issues with JQL

Allow searching for issues using JQL queries.

```typescript
// Tool: searchJiraIssues
// Endpoint: GET /rest/api/3/search
// Parameters:
// - jql: JQL search query (e.g., "assignee = currentUser() AND status = 'In Progress'")
// - startAt: Optional. The index of the first item to return
// - maxResults: Optional. The maximum number of items to return
// - fields: Optional. Comma-separated list of fields to return
// - expand: Optional. Comma-separated list of entities to expand
```

### 5. Get Jira Issue Watchers

Retrieve the list of users watching an issue.

```typescript
// Tool: getJiraIssueWatchers
// Endpoint: GET /rest/api/3/issue/{issueKey}/watchers
// Parameters:
// - issueKey: The key of the Jira issue
```

### 6. Get Jira Issue Attachments

Retrieve attachments for a specific issue.

```typescript
// Tool: getJiraIssueAttachments
// Endpoint: GET /rest/api/3/issue/{issueKey}?fields=attachment
// Parameters:
// - issueKey: The key of the Jira issue
```

### 7. Get Jira Sprint Information

Retrieve sprint information for an issue (requires Agile API).

```typescript
// Tool: getJiraIssueSprints
// Endpoint: GET /rest/agile/1.0/issue/{issueKey}
// Parameters:
// - issueKey: The key of the Jira issue
// - fields: Set to "sprint" to get sprint information
```

## Implementation Details

### Tool Structure

Each tool will follow the same structure as the existing `getJiraIssue` tool:

1. Zod schema for validation
2. Property map for MCP registration
3. JSON schema for documentation
4. Tool definition with name and description
5. Executor function with error handling

### Response Formatting

To make the responses more useful for users, we'll format the JSON responses to extract the most relevant information rather than returning the full raw API response.

### Request Parameters

We'll implement validation for all parameters using Zod schemas, with appropriate error handling and user-friendly error messages.

## JQL Examples for Documentation

To help users construct JQL queries for the `searchJiraIssues` tool, we'll provide examples:

- Find issues assigned to a specific user:
  `assignee = "email@example.com" AND project = "PROJECT_KEY"`

- Find issues created in the last 30 days:
  `created >= -30d`

- Find issues in a specific sprint:
  `sprint in openSprints() AND project = "PROJECT_KEY"`

- Find issues with specific status:
  `status = "In Progress" AND project = "PROJECT_KEY"`

## Integration with LLM

To enable natural language queries, we should provide clear documentation on how to formulate queries like:

- "Find all issues assigned to John Doe in the last 30 days"
- "Get all bugs in the current sprint"
- "Show me all open issues in Project X with priority High"

The LLM would then translate these queries into appropriate JQL and call the relevant tools.

## Next Steps

1. Implement each tool one by one, testing with sample data
2. Add comprehensive error handling for API limits, authentication failures, etc.
3. Create documentation with examples for end-users
4. Optimize response formatting for better readability in the LLM context 