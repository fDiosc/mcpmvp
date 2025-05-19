import { z } from 'zod';
import fetch from 'node-fetch';
// New function to get Jira credentials dynamically or from environment
async function getJiraCredentials(requestContext) {
    const USE_ENV_FOR_JIRA_CREDENTIALS = process.env.USE_ENV_FOR_JIRA_CREDENTIALS === 'true';
    if (!USE_ENV_FOR_JIRA_CREDENTIALS && requestContext?.userJiraCredentials) {
        if (requestContext.userJiraCredentials.baseUrl &&
            requestContext.userJiraCredentials.username &&
            requestContext.userJiraCredentials.apiToken) {
            console.log(`[JiraClient] Using dynamic user credentials for user: ${requestContext.productLabUserId || 'Unknown'}`);
            return requestContext.userJiraCredentials;
        }
        else {
            console.error('[JiraClient] Attempted to use dynamic credentials, but they are incomplete.', requestContext.userJiraCredentials);
            throw new Error('Incomplete dynamic Jira credentials provided.');
        }
    }
    if (USE_ENV_FOR_JIRA_CREDENTIALS) {
        const ENV_JIRA_BASE_URL = process.env.JIRA_BASE_URL;
        const ENV_JIRA_USERNAME = process.env.JIRA_USERNAME;
        const ENV_JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
        if (ENV_JIRA_BASE_URL && ENV_JIRA_USERNAME && ENV_JIRA_API_TOKEN) {
            console.log('[JiraClient] Using environment credentials for Jira.');
            return {
                baseUrl: ENV_JIRA_BASE_URL,
                username: ENV_JIRA_USERNAME,
                apiToken: ENV_JIRA_API_TOKEN,
            };
        }
        else {
            console.error('[JiraClient] USE_ENV_FOR_JIRA_CREDENTIALS is true, but environment variables are incomplete.');
            throw new Error('Jira environment variables (JIRA_BASE_URL, JIRA_USERNAME, JIRA_API_TOKEN) are not fully set.');
        }
    }
    console.error('[JiraClient] Critical credential configuration error. Unable to determine Jira credentials. USE_ENV_FOR_JIRA_CREDENTIALS is false and no dynamic credentials were provided or were incomplete.');
    throw new Error('Jira credentials configuration error. Cannot proceed with Jira API call.');
}
// Common utility for API calls - Modified
async function callJiraApi(endpoint, method = 'GET', // Added method parameter with default
options = {}, requestContext // Added requestContext
) {
    const creds = await getJiraCredentials(requestContext);
    const { baseUrl, username, apiToken } = creds;
    const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`; // Avoid double slashes
    const authToken = Buffer.from(`${username}:${apiToken}`).toString('base64');
    const headers = {
        'Authorization': `Basic ${authToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json', // Usually needed for POST/PUT
        ...(options.customHeaders || {}),
    };
    const fetchOptions = {
        ...options,
        method: method,
        headers: headers,
        body: options.payload ? JSON.stringify(options.payload) : undefined,
    };
    console.log(`[JiraClient] Making ${method} request to ${url}`); // Avoid logging sensitive parts
    try {
        const response = await fetch(url, fetchOptions);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[JiraClient] Jira API Error: ${response.status} ${response.statusText}`, errorText);
            throw new Error(`Jira API error: ${response.status} ${response.statusText}\\n${errorText}`);
        }
        if (response.status === 204) { // Handle No Content
            return null;
        }
        return await response.json();
    }
    catch (error) {
        // Log already happens in the calling function or above if it's a new Error
        // console.error('[JiraClient] Exception during Jira API call:', error); 
        throw error; // Re-throw to be handled by the caller
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
// Executor da tool (adaptado do Jira MCP) - Modified
export async function getJiraIssueExecutor(args, requestContext) {
    const parsed = getJiraIssueZodSchema.safeParse(args);
    if (!parsed.success) {
        return {
            content: [{
                    type: "text",
                    text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                }],
            isError: true
        };
    }
    const { issueKey } = parsed.data;
    const endpoint = `/rest/api/3/issue/${issueKey}?expand=changelog`;
    try {
        // Refactored to use callJiraApi
        const data = await callJiraApi(endpoint, 'GET', {}, requestContext);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(data, null, 2)
                }]
        };
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
                    text: `Exception fetching Jira issue ${issueKey}: ${err.message}` // Added issueKey for context
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
// Executor - Modified
export async function getDetailedJiraIssueExecutor(args, requestContext) {
    const parsed = getDetailedJiraIssueZodSchema.safeParse(args);
    if (!parsed.success) {
        return {
            content: [{
                    type: "text",
                    text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                }],
            isError: true
        };
    }
    const { issueKey, fields, expand } = parsed.data;
    const queryParams = new URLSearchParams();
    if (fields)
        queryParams.append('fields', fields);
    if (expand)
        queryParams.append('expand', expand);
    const endpoint = `/rest/api/3/issue/${issueKey}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    try {
        const data = await callJiraApi(endpoint, 'GET', {}, requestContext); // Using callJiraApi
        // Basic formatting, can be expanded
        const formattedData = {
            key: data.key,
            summary: data.fields?.summary,
            status: data.fields?.status?.name,
            assignee: data.fields?.assignee?.displayName,
            // Add more fields as needed or return raw data if requested
            rawData: (fields === '*' || !fields) ? data : undefined // Example: show all if fields is '*' or not specified
        };
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(formattedData, null, 2)
                }]
        };
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
                    text: `Error fetching detailed Jira issue ${issueKey}: ${err.message}`
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
export async function getJiraIssueCommentsExecutor(args, requestContext) {
    try {
        const parsed = getJiraIssueCommentsZodSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{
                        type: "text",
                        text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                    }],
                isError: true
            };
        }
        const { issueKey, startAt, maxResults, orderBy } = parsed.data;
        // Build query parameters
        const queryParams = new URLSearchParams();
        if (startAt !== undefined)
            queryParams.append('startAt', startAt.toString());
        if (maxResults !== undefined)
            queryParams.append('maxResults', maxResults.toString());
        if (orderBy)
            queryParams.append('orderBy', orderBy);
        const endpoint = `/rest/api/3/issue/${issueKey}/comment${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        try {
            const data = await callJiraApi(endpoint, 'GET', {}, requestContext);
            // Format the comments for better readability
            const formattedComments = data.comments.map((comment) => ({
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
                        type: "text",
                        text: JSON.stringify(response, null, 2)
                    }]
            };
        }
        catch (err) {
            return {
                content: [{
                        type: "text",
                        text: `Error fetching Jira issue comments: ${err.message}`
                    }],
                isError: true
            };
        }
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
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
export async function getJiraIssueTransitionsExecutor(args, requestContext) {
    try {
        const parsed = getJiraIssueTransitionsZodSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{
                        type: "text",
                        text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                    }],
                isError: true
            };
        }
        const { issueKey, expand } = parsed.data;
        // Build query parameters
        const queryParams = new URLSearchParams();
        if (expand)
            queryParams.append('expand', expand);
        const endpoint = `/rest/api/3/issue/${issueKey}/transitions${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        try {
            const data = await callJiraApi(endpoint, 'GET', {}, requestContext);
            // Format the transitions for better readability
            const formattedTransitions = data.transitions.map((transition) => ({
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
                        type: "text",
                        text: JSON.stringify(response, null, 2)
                    }]
            };
        }
        catch (err) {
            return {
                content: [{
                        type: "text",
                        text: `Error fetching Jira issue transitions: ${err.message}`
                    }],
                isError: true
            };
        }
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
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
export async function searchJiraIssuesExecutor(args, requestContext) {
    try {
        const parsed = searchJiraIssuesZodSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{
                        type: "text",
                        text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                    }],
                isError: true
            };
        }
        const { jql, startAt, maxResults, fields, expand } = parsed.data;
        // Build query parameters
        const queryParams = new URLSearchParams();
        queryParams.append('jql', jql);
        if (startAt !== undefined)
            queryParams.append('startAt', startAt.toString());
        if (maxResults !== undefined)
            queryParams.append('maxResults', maxResults.toString());
        if (fields)
            queryParams.append('fields', fields);
        if (expand)
            queryParams.append('expand', expand);
        const endpoint = `/rest/api/3/search?${queryParams.toString()}`;
        try {
            const data = await callJiraApi(endpoint, 'GET', {}, requestContext);
            // Format the search results for better readability
            const formattedIssues = data.issues.map((issue) => ({
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
                        type: "text",
                        text: JSON.stringify(response, null, 2)
                    }]
            };
        }
        catch (err) {
            return {
                content: [{
                        type: "text",
                        text: `Error searching Jira issues: ${err.message}`
                    }],
                isError: true
            };
        }
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
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
export async function getJiraIssueWatchersExecutor(args, requestContext) {
    try {
        const parsed = getJiraIssueWatchersZodSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{
                        type: "text",
                        text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                    }],
                isError: true
            };
        }
        const { issueKey } = parsed.data;
        const endpoint = `/rest/api/3/issue/${issueKey}/watchers`;
        try {
            const data = await callJiraApi(endpoint, 'GET', {}, requestContext);
            // Format the watchers for better readability
            const formattedWatchers = data.watchers.map((watcher) => ({
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
                        type: "text",
                        text: JSON.stringify(response, null, 2)
                    }]
            };
        }
        catch (err) {
            return {
                content: [{
                        type: "text",
                        text: `Error fetching Jira issue watchers: ${err.message}`
                    }],
                isError: true
            };
        }
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
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
export async function getJiraIssueAttachmentsExecutor(args, requestContext) {
    try {
        const parsed = getJiraIssueAttachmentsZodSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{
                        type: "text",
                        text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                    }],
                isError: true
            };
        }
        const { issueKey } = parsed.data;
        // For attachments, we need to request the specific field
        const endpoint = `/rest/api/3/issue/${issueKey}?fields=attachment`;
        try {
            const data = await callJiraApi(endpoint, 'GET', {}, requestContext);
            // Make sure attachments exist in the response
            if (!data.fields || !data.fields.attachment) {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                issueKey: issueKey,
                                attachments: []
                            }, null, 2)
                        }]
                };
            }
            // Format the attachments for better readability
            const formattedAttachments = data.fields.attachment.map((attachment) => ({
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
                        type: "text",
                        text: JSON.stringify(response, null, 2)
                    }]
            };
        }
        catch (err) {
            return {
                content: [{
                        type: "text",
                        text: `Error fetching Jira issue attachments: ${err.message}`
                    }],
                isError: true
            };
        }
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
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
export async function getJiraIssueSprintsExecutor(args, requestContext) {
    try {
        const parsed = getJiraIssueSprintsZodSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{
                        type: "text",
                        text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues)
                    }],
                isError: true
            };
        }
        const { issueKey } = parsed.data;
        // For sprints, we need to use the Agile API
        const endpoint = `/rest/agile/1.0/issue/${issueKey}?fields=sprint,closedSprints,project`;
        try {
            const data = await callJiraApi(endpoint, 'GET', {}, requestContext);
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
                data.fields.closedSprints.map((sprint) => ({
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
                        type: "text",
                        text: JSON.stringify(response, null, 2)
                    }]
            };
        }
        catch (err) {
            // The Agile API might not be available or the project might not use sprints
            return {
                content: [{
                        type: "text",
                        text: `Error fetching Jira issue sprint information: ${err.message}\n\nNote: This feature requires Jira Software and the Agile API. The project may not use sprints or your account may not have access to this information.`
                    }],
                isError: true
            };
        }
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
                    text: `Exception in getJiraIssueSprints: ${err.message}`
                }],
            isError: true
        };
    }
}
// Example for a POST tool (addJiraComment)
const addJiraCommentZodSchema = z.object({
    issueKey: z.string().describe("The key of the issue to comment on."),
    body: z.string().describe("The comment text."),
});
export const addJiraCommentPropertySchema = {
    issueKey: { type: "string", description: "The key of the issue to comment on." },
    body: { type: "string", description: "The comment text." }
};
export const addJiraCommentInputSchema = {
    type: "object",
    properties: {
        issueKey: { type: "string", description: "The key of the issue to comment on." },
        body: { type: "string", description: "The comment text." }
    },
    required: ["issueKey", "body"]
};
export const addJiraCommentTool = {
    name: "addJiraComment",
    description: "Adds a comment to a Jira issue.",
};
export async function addJiraCommentExecutor(args, requestContext) {
    const parsed = addJiraCommentZodSchema.safeParse(args);
    if (!parsed.success) {
        return { content: [{ type: "text", text: 'Invalid arguments: ' + JSON.stringify(parsed.error.issues) }], isError: true };
    }
    const { issueKey, body } = parsed.data;
    const endpoint = `/rest/api/3/issue/${issueKey}/comment`;
    const payload = { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] } }; // Jira Cloud comment format
    try {
        const data = await callJiraApi(endpoint, 'POST', { payload }, requestContext);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
    catch (err) {
        return { content: [{ type: "text", text: `Error adding comment to ${issueKey}: ${err.message}` }], isError: true };
    }
}
