import { z } from 'zod';
import fetch from 'node-fetch';

// Common utility for Jira authentication
function getJiraAuth() {
  const username = process.env.JIRA_USERNAME;
  const apiToken = process.env.JIRA_API_TOKEN;
  
  if (!username || !apiToken) {
    throw new Error('Jira configuration missing. Please set JIRA_USERNAME and JIRA_API_TOKEN.');
  }
  
  return Buffer.from(`${username}:${apiToken}`).toString('base64');
}

// Common utility for API calls
async function callJiraApi(endpoint: string, options: any = {}) {
  const baseUrl = process.env.JIRA_BASE_URL;
  
  if (!baseUrl) {
    throw new Error('Jira configuration missing. Please set JIRA_BASE_URL.');
  }
  
  const url = `${baseUrl}${endpoint}`;
  const auth = getJiraAuth();
  
  const defaultOptions = {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
    },
  };
  
  const fetchOptions = { ...defaultOptions, ...options };
  
  try {
    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error: ${response.status} ${response.statusText}\n${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    throw error;
  }
}

// Zod schema para validação interna
const getJiraIssueZodSchema = z.object({
  issueKey: z.string().describe('The key of the Jira issue to fetch (e.g., "PROJ-123")'),
});

// Property map para registro no MCP
export const getJiraIssuePropertySchema = {
  issueKey: {
    type: "string",
    description: 'The key of the Jira issue to fetch (e.g., "PROJ-123")'
  }
};

// JSON Schema para referência/documentação
export const getJiraIssueInputSchema = {
  type: 'object',
  properties: {
    issueKey: {
      type: 'string',
      description: 'The key of the Jira issue to fetch (e.g., "PROJ-123")',
    },
  },
  required: ['issueKey'],
};

// Tool definition (adaptado do Jira MCP)
export const getJiraIssueTool = {
  name: 'getJiraIssue',
  description: 'Fetches a Jira issue by its key',
};

// Executor da tool (adaptado do Jira MCP)
export async function getJiraIssueExecutor(args: any, _extra: any) {
  // Validação opcional
  const parsed = getJiraIssueZodSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{
        type: "text" as const,
        text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
      }],
      isError: true
    };
  }
  const { issueKey } = parsed.data;
  const baseUrl = process.env.JIRA_BASE_URL;
  const username = process.env.JIRA_USERNAME;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !username || !apiToken) {
    return {
      content: [{
        type: "text" as const,
        text: 'Jira configuration missing. Please set JIRA_BASE_URL, JIRA_USERNAME, and JIRA_API_TOKEN.'
      }],
      isError: true
    };
  }

  const url = `${baseUrl}/rest/api/3/issue/${issueKey}?expand=changelog`;
  const auth = Buffer.from(`${username}:${apiToken}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      return {
        content: [{
          type: "text" as const,
          text: `Error fetching Jira issue: ${response.status} ${response.statusText}\n${errorText}`
        }],
        isError: true
      };
    }
    const data = await response.json();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }]
    };
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception: ${err.message}`
      }],
      isError: true
    };
  }
}

// 1. Get Detailed Jira Issue Tool
// Zod schema
const getDetailedJiraIssueZodSchema = z.object({
  issueKey: z.string().describe('The key of the Jira issue (e.g., "PROJ-123")'),
  fields: z.string().optional().describe('Comma-separated list of fields to return'),
  expand: z.string().optional().describe('Comma-separated list of entities to expand')
});

// Property map
export const getDetailedJiraIssuePropertySchema = {
  issueKey: {
    type: "string",
    description: 'The key of the Jira issue (e.g., "PROJ-123")'
  },
  fields: {
    type: "string",
    description: 'Comma-separated list of fields to return'
  },
  expand: {
    type: "string",
    description: 'Comma-separated list of entities to expand (e.g., "renderedFields,changelog,transitions,names")'
  }
};

// JSON Schema
export const getDetailedJiraIssueInputSchema = {
  type: 'object',
  properties: {
    issueKey: {
      type: 'string',
      description: 'The key of the Jira issue (e.g., "PROJ-123")',
    },
    fields: {
      type: 'string',
      description: 'Comma-separated list of fields to return'
    },
    expand: {
      type: 'string',
      description: 'Comma-separated list of entities to expand (e.g., "renderedFields,changelog,transitions,names")'
    }
  },
  required: ['issueKey'],
};

// Tool definition
export const getDetailedJiraIssueTool = {
  name: 'getDetailedJiraIssue',
  description: 'Fetches a Jira issue with detailed information and optionally specified fields',
};

// Executor
export async function getDetailedJiraIssueExecutor(args: any, _extra: any) {
  try {
    const parsed = getDetailedJiraIssueZodSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: "text" as const,
          text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
        }],
        isError: true
      };
    }
    
    const { issueKey, fields, expand } = parsed.data;
    
    // Build query parameters
    const queryParams = new URLSearchParams();
    if (fields) queryParams.append('fields', fields);
    if (expand) queryParams.append('expand', expand);
    
    const endpoint = `/rest/api/3/issue/${issueKey}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    try {
      const data = await callJiraApi(endpoint);
      
      // Format response for better readability
      const formattedData = {
        key: data.key,
        summary: data.fields?.summary,
        description: data.fields?.description,
        status: data.fields?.status?.name,
        assignee: data.fields?.assignee?.displayName,
        reporter: data.fields?.reporter?.displayName,
        priority: data.fields?.priority?.name,
        created: data.fields?.created,
        updated: data.fields?.updated,
        // Include other relevant fields based on the requested fields
        rawData: fields === '*' ? data : undefined
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(formattedData, null, 2)
        }]
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text" as const,
          text: `Error fetching detailed Jira issue: ${err.message}`
        }],
        isError: true
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception in getDetailedJiraIssue: ${err.message}`
      }],
      isError: true
    };
  }
}

// 2. Get Jira Issue Comments Tool
// Zod schema
const getJiraIssueCommentsZodSchema = z.object({
  issueKey: z.string().describe('The key of the Jira issue (e.g., "PROJ-123")'),
  startAt: z.number().optional().describe('The index of the first item to return'),
  maxResults: z.number().optional().describe('The maximum number of items to return'),
  orderBy: z.string().optional().describe('Order of returned comments (e.g., "created", "-created")')
});

// Property map
export const getJiraIssueCommentsPropertySchema = {
  issueKey: {
    type: "string",
    description: 'The key of the Jira issue (e.g., "PROJ-123")'
  },
  startAt: {
    type: "number",
    description: 'The index of the first item to return'
  },
  maxResults: {
    type: "number",
    description: 'The maximum number of items to return'
  },
  orderBy: {
    type: "string",
    description: 'Order of returned comments (e.g., "created", "-created")'
  }
};

// JSON Schema
export const getJiraIssueCommentsInputSchema = {
  type: 'object',
  properties: {
    issueKey: {
      type: 'string',
      description: 'The key of the Jira issue (e.g., "PROJ-123")',
    },
    startAt: {
      type: 'number',
      description: 'The index of the first item to return'
    },
    maxResults: {
      type: 'number',
      description: 'The maximum number of items to return'
    },
    orderBy: {
      type: 'string',
      description: 'Order of returned comments (e.g., "created", "-created")'
    }
  },
  required: ['issueKey'],
};

// Tool definition
export const getJiraIssueCommentsTool = {
  name: 'getJiraIssueComments',
  description: 'Retrieves all comments for a specific Jira issue',
};

// Executor
export async function getJiraIssueCommentsExecutor(args: any, _extra: any) {
  try {
    const parsed = getJiraIssueCommentsZodSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: "text" as const,
          text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
        }],
        isError: true
      };
    }
    
    const { issueKey, startAt, maxResults, orderBy } = parsed.data;
    
    // Build query parameters
    const queryParams = new URLSearchParams();
    if (startAt !== undefined) queryParams.append('startAt', startAt.toString());
    if (maxResults !== undefined) queryParams.append('maxResults', maxResults.toString());
    if (orderBy) queryParams.append('orderBy', orderBy);
    
    const endpoint = `/rest/api/3/issue/${issueKey}/comment${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    try {
      const data = await callJiraApi(endpoint);
      
      // Format the comments for better readability
      const formattedComments = data.comments.map((comment: any) => ({
        id: comment.id,
        author: comment.author?.displayName || comment.author?.name || 'Unknown',
        created: comment.created,
        updated: comment.updated,
        body: comment.body,
      }));
      
      const response = {
        issueKey: issueKey,
        total: data.total,
        comments: formattedComments
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text" as const,
          text: `Error fetching Jira issue comments: ${err.message}`
        }],
        isError: true
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception in getJiraIssueComments: ${err.message}`
      }],
      isError: true
    };
  }
}

// 3. Get Jira Issue Transitions Tool
// Zod schema
const getJiraIssueTransitionsZodSchema = z.object({
  issueKey: z.string().describe('The key of the Jira issue (e.g., "PROJ-123")'),
  expand: z.string().optional().describe('Expand operations for the returned transitions')
});

// Property map
export const getJiraIssueTransitionsPropertySchema = {
  issueKey: {
    type: "string",
    description: 'The key of the Jira issue (e.g., "PROJ-123")'
  },
  expand: {
    type: "string",
    description: 'Expand operations for the returned transitions'
  }
};

// JSON Schema
export const getJiraIssueTransitionsInputSchema = {
  type: 'object',
  properties: {
    issueKey: {
      type: 'string',
      description: 'The key of the Jira issue (e.g., "PROJ-123")',
    },
    expand: {
      type: 'string',
      description: 'Expand operations for the returned transitions'
    }
  },
  required: ['issueKey'],
};

// Tool definition
export const getJiraIssueTransitionsTool = {
  name: 'getJiraIssueTransitions',
  description: 'Retrieves available transitions for a specific Jira issue',
};

// Executor
export async function getJiraIssueTransitionsExecutor(args: any, _extra: any) {
  try {
    const parsed = getJiraIssueTransitionsZodSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: "text" as const,
          text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
        }],
        isError: true
      };
    }
    
    const { issueKey, expand } = parsed.data;
    
    // Build query parameters
    const queryParams = new URLSearchParams();
    if (expand) queryParams.append('expand', expand);
    
    const endpoint = `/rest/api/3/issue/${issueKey}/transitions${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    try {
      const data = await callJiraApi(endpoint);
      
      // Format the transitions for better readability
      const formattedTransitions = data.transitions.map((transition: any) => ({
        id: transition.id,
        name: transition.name,
        to: {
          id: transition.to?.id,
          name: transition.to?.name,
          statusCategory: transition.to?.statusCategory?.name
        }
      }));
      
      const response = {
        issueKey: issueKey,
        transitions: formattedTransitions
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text" as const,
          text: `Error fetching Jira issue transitions: ${err.message}`
        }],
        isError: true
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception in getJiraIssueTransitions: ${err.message}`
      }],
      isError: true
    };
  }
}

// 4. Search Jira Issues with JQL Tool
// Zod schema
const searchJiraIssuesZodSchema = z.object({
  jql: z.string().describe('JQL search query (e.g., "assignee = currentUser() AND status = \'In Progress\'")'),
  startAt: z.number().optional().describe('The index of the first item to return'),
  maxResults: z.number().optional().describe('The maximum number of items to return'),
  fields: z.string().optional().describe('Comma-separated list of fields to return'),
  expand: z.string().optional().describe('Comma-separated list of entities to expand')
});

// Property map
export const searchJiraIssuesPropertySchema = {
  jql: {
    type: "string",
    description: 'JQL search query (e.g., "assignee = currentUser() AND status = \'In Progress\'")'
  },
  startAt: {
    type: "number",
    description: 'The index of the first item to return'
  },
  maxResults: {
    type: "number",
    description: 'The maximum number of items to return'
  },
  fields: {
    type: "string",
    description: 'Comma-separated list of fields to return'
  },
  expand: {
    type: "string",
    description: 'Comma-separated list of entities to expand'
  }
};

// JSON Schema
export const searchJiraIssuesInputSchema = {
  type: 'object',
  properties: {
    jql: {
      type: 'string',
      description: 'JQL search query (e.g., "assignee = currentUser() AND status = \'In Progress\'")'
    },
    startAt: {
      type: 'number',
      description: 'The index of the first item to return'
    },
    maxResults: {
      type: 'number',
      description: 'The maximum number of items to return'
    },
    fields: {
      type: 'string',
      description: 'Comma-separated list of fields to return'
    },
    expand: {
      type: 'string',
      description: 'Comma-separated list of entities to expand'
    }
  },
  required: ['jql'],
};

// Tool definition
export const searchJiraIssuesTool = {
  name: 'searchJiraIssues',
  description: 'Searches for issues using JQL (Jira Query Language)',
};

// Executor
export async function searchJiraIssuesExecutor(args: any, _extra: any) {
  try {
    const parsed = searchJiraIssuesZodSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: "text" as const,
          text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
        }],
        isError: true
      };
    }
    
    const { jql, startAt, maxResults, fields, expand } = parsed.data;
    
    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('jql', jql);
    if (startAt !== undefined) queryParams.append('startAt', startAt.toString());
    if (maxResults !== undefined) queryParams.append('maxResults', maxResults.toString());
    if (fields) queryParams.append('fields', fields);
    if (expand) queryParams.append('expand', expand);
    
    const endpoint = `/rest/api/3/search?${queryParams.toString()}`;
    
    try {
      const data = await callJiraApi(endpoint);
      
      // Format the search results for better readability
      const formattedIssues = data.issues.map((issue: any) => ({
        key: issue.key,
        summary: issue.fields?.summary,
        status: issue.fields?.status?.name,
        assignee: issue.fields?.assignee?.displayName || 'Unassigned',
        priority: issue.fields?.priority?.name,
        created: issue.fields?.created,
        updated: issue.fields?.updated,
        issuetype: issue.fields?.issuetype?.name,
        // Include other relevant fields if specifically requested
      }));
      
      const response = {
        total: data.total,
        maxResults: data.maxResults,
        startAt: data.startAt,
        jql: jql,
        issues: formattedIssues
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text" as const,
          text: `Error searching Jira issues: ${err.message}`
        }],
        isError: true
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception in searchJiraIssues: ${err.message}`
      }],
      isError: true
    };
  }
}

// 5. Get Jira Issue Watchers Tool
// Zod schema
const getJiraIssueWatchersZodSchema = z.object({
  issueKey: z.string().describe('The key of the Jira issue (e.g., "PROJ-123")')
});

// Property map
export const getJiraIssueWatchersPropertySchema = {
  issueKey: {
    type: "string",
    description: 'The key of the Jira issue (e.g., "PROJ-123")'
  }
};

// JSON Schema
export const getJiraIssueWatchersInputSchema = {
  type: 'object',
  properties: {
    issueKey: {
      type: 'string',
      description: 'The key of the Jira issue (e.g., "PROJ-123")',
    }
  },
  required: ['issueKey'],
};

// Tool definition
export const getJiraIssueWatchersTool = {
  name: 'getJiraIssueWatchers',
  description: 'Retrieves the list of users watching a specific Jira issue',
};

// Executor
export async function getJiraIssueWatchersExecutor(args: any, _extra: any) {
  try {
    const parsed = getJiraIssueWatchersZodSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: "text" as const,
          text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
        }],
        isError: true
      };
    }
    
    const { issueKey } = parsed.data;
    
    const endpoint = `/rest/api/3/issue/${issueKey}/watchers`;
    
    try {
      const data = await callJiraApi(endpoint);
      
      // Format the watchers for better readability
      const formattedWatchers = data.watchers.map((watcher: any) => ({
        accountId: watcher.accountId,
        displayName: watcher.displayName,
        emailAddress: watcher.emailAddress,
        active: watcher.active
      }));
      
      const response = {
        issueKey: issueKey,
        watchCount: data.watchCount,
        watchers: formattedWatchers
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text" as const,
          text: `Error fetching Jira issue watchers: ${err.message}`
        }],
        isError: true
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception in getJiraIssueWatchers: ${err.message}`
      }],
      isError: true
    };
  }
}

// 6. Get Jira Issue Attachments Tool
// Zod schema
const getJiraIssueAttachmentsZodSchema = z.object({
  issueKey: z.string().describe('The key of the Jira issue (e.g., "PROJ-123")')
});

// Property map
export const getJiraIssueAttachmentsPropertySchema = {
  issueKey: {
    type: "string",
    description: 'The key of the Jira issue (e.g., "PROJ-123")'
  }
};

// JSON Schema
export const getJiraIssueAttachmentsInputSchema = {
  type: 'object',
  properties: {
    issueKey: {
      type: 'string',
      description: 'The key of the Jira issue (e.g., "PROJ-123")',
    }
  },
  required: ['issueKey'],
};

// Tool definition
export const getJiraIssueAttachmentsTool = {
  name: 'getJiraIssueAttachments',
  description: 'Retrieves attachments for a specific Jira issue',
};

// Executor
export async function getJiraIssueAttachmentsExecutor(args: any, _extra: any) {
  try {
    const parsed = getJiraIssueAttachmentsZodSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: "text" as const,
          text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
        }],
        isError: true
      };
    }
    
    const { issueKey } = parsed.data;
    
    // For attachments, we need to request the specific field
    const endpoint = `/rest/api/3/issue/${issueKey}?fields=attachment`;
    
    try {
      const data = await callJiraApi(endpoint);
      
      // Make sure attachments exist in the response
      if (!data.fields || !data.fields.attachment) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              issueKey: issueKey,
              attachments: []
            }, null, 2)
          }]
        };
      }
      
      // Format the attachments for better readability
      const formattedAttachments = data.fields.attachment.map((attachment: any) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        created: attachment.created,
        author: attachment.author?.displayName,
        url: attachment.content
      }));
      
      const response = {
        issueKey: issueKey,
        attachments: formattedAttachments
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text" as const,
          text: `Error fetching Jira issue attachments: ${err.message}`
        }],
        isError: true
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception in getJiraIssueAttachments: ${err.message}`
      }],
      isError: true
    };
  }
}

// 7. Get Jira Sprint Information Tool
// Zod schema
const getJiraIssueSprintsZodSchema = z.object({
  issueKey: z.string().describe('The key of the Jira issue (e.g., "PROJ-123")')
});

// Property map
export const getJiraIssueSprintsPropertySchema = {
  issueKey: {
    type: "string",
    description: 'The key of the Jira issue (e.g., "PROJ-123")'
  }
};

// JSON Schema
export const getJiraIssueSprintsInputSchema = {
  type: 'object',
  properties: {
    issueKey: {
      type: 'string',
      description: 'The key of the Jira issue (e.g., "PROJ-123")',
    }
  },
  required: ['issueKey'],
};

// Tool definition
export const getJiraIssueSprintsTool = {
  name: 'getJiraIssueSprints',
  description: 'Retrieves sprint information for a specific Jira issue',
};

// Executor
export async function getJiraIssueSprintsExecutor(args: any, _extra: any) {
  try {
    const parsed = getJiraIssueSprintsZodSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: "text" as const,
          text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
        }],
        isError: true
      };
    }
    
    const { issueKey } = parsed.data;
    
    // For sprints, we need to use the Agile API
    const endpoint = `/rest/agile/1.0/issue/${issueKey}?fields=sprint,closedSprints,project`;
    
    try {
      const data = await callJiraApi(endpoint);
      
      // Extract sprint information from the response
      const currentSprint = data.fields?.sprint ? {
        id: data.fields.sprint.id,
        name: data.fields.sprint.name,
        state: data.fields.sprint.state,
        startDate: data.fields.sprint.startDate,
        endDate: data.fields.sprint.endDate,
        goal: data.fields.sprint.goal
      } : null;
      
      // Extract closed sprints information
      const closedSprints = data.fields?.closedSprints ? 
        data.fields.closedSprints.map((sprint: any) => ({
          id: sprint.id,
          name: sprint.name,
          state: sprint.state,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          completeDate: sprint.completeDate,
          goal: sprint.goal
        })) : [];
      
      const response = {
        issueKey: issueKey,
        project: data.fields?.project?.name,
        currentSprint: currentSprint,
        closedSprints: closedSprints
      };
      
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (err: any) {
      // The Agile API might not be available or the project might not use sprints
      return {
        content: [{
          type: "text" as const,
          text: `Error fetching Jira issue sprint information: ${err.message}\n\nNote: This feature requires Jira Software and the Agile API. The project may not use sprints or your account may not have access to this information.`
        }],
        isError: true
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Exception in getJiraIssueSprints: ${err.message}`
      }],
      isError: true
    };
  }
} 