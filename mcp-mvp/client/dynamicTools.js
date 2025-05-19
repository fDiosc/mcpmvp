/**
 * Dynamic Tools Client
 *
 * This module provides functionality for fetching tools based on context,
 * used to reduce token usage by selecting only relevant tools for each request.
 */
import fetch from 'node-fetch';
// Default MCP server URL
const DEFAULT_MCP_URL = 'http://localhost:3333';
/**
 * Common contexts that can be extracted from user messages
 */
export const COMMON_CONTEXTS = {
    jira: ['jira', 'ticket', 'issue', 'sprint', 'board', 'project', 'epic', 'story', 'task', 'bug', 'backlog'],
    notes: ['note', 'memo', 'write', 'remember', 'document', 'text', 'save'],
    agile: ['sprint', 'agile', 'scrum', 'kanban', 'story', 'epic', 'release', 'velocity'],
    communication: ['comment', 'message', 'chat', 'discuss', 'talk', 'conversation', 'reply'],
    search: ['search', 'find', 'query', 'look for', 'locate', 'discover'],
    documents: ['file', 'document', 'attachment', 'upload', 'download', 'read'],
    users: ['user', 'assign', 'assignee', 'watcher', 'member', 'team', 'person', 'reporter']
};
/**
 * Extract context from a user message
 * This analyzes the user input to determine the most relevant context
 */
export function extractContextFromMessage(message) {
    if (!message || typeof message !== 'string') {
        console.error('[LOG][CONTEXT] Invalid message received:', message);
        return [];
    }
    const contexts = [];
    const lowercaseMsg = message.toLowerCase();
    // Check for specific contexts based on keywords
    for (const [context, keywords] of Object.entries(COMMON_CONTEXTS)) {
        if (keywords.some(keyword => lowercaseMsg.includes(keyword.toLowerCase()))) {
            contexts.push(context);
        }
    }
    // Check for explicit jira issue key patterns (e.g., PROJ-123)
    if (/[A-Z]+-\d+/.test(message)) {
        contexts.push('jira');
    }
    console.error(`[LOG][CONTEXT] Extracted contexts from message: ${contexts.join(', ') || 'none'}`);
    return contexts;
}
/**
 * Fetches tools from the MCP server based on provided filtering options
 */
export async function fetchDynamicTools(options = {}, baseUrl = DEFAULT_MCP_URL) {
    try {
        // Build query parameters
        const params = new URLSearchParams();
        if (options.context)
            params.append('context', options.context);
        if (options.category)
            params.append('category', options.category);
        if (options.userId)
            params.append('userId', options.userId);
        if (options.limit)
            params.append('limit', options.limit.toString());
        // Make the request to the tools endpoint
        const response = await fetch(`${baseUrl}/tools?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch tools: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data;
    }
    catch (error) {
        console.error('[ERROR][DYNAMIC-TOOLS] Error fetching dynamic tools:', error);
        throw error;
    }
}
/**
 * Gets metrics for tool usage
 */
export async function getToolMetrics(baseUrl = DEFAULT_MCP_URL) {
    try {
        const response = await fetch(`${baseUrl}/tools/metrics`);
        if (!response.ok) {
            throw new Error(`Failed to fetch tool metrics: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    }
    catch (error) {
        console.error('[ERROR][DYNAMIC-TOOLS] Error fetching tool metrics:', error);
        throw error;
    }
}
/**
 * Resets tool metrics
 */
export async function resetToolMetrics(baseUrl = DEFAULT_MCP_URL) {
    try {
        const response = await fetch(`${baseUrl}/tools/metrics/reset`, {
            method: 'POST',
        });
        if (!response.ok) {
            throw new Error(`Failed to reset tool metrics: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    }
    catch (error) {
        console.error('[ERROR][DYNAMIC-TOOLS] Error resetting tool metrics:', error);
        throw error;
    }
}
/**
 * Extended MCP Client with dynamic tool support
 * This is a wrapper around the standard MCP Client
 */
export class DynamicToolClient {
    client;
    baseUrl;
    toolCache = new Map(); // Cache tools to avoid repeated requests
    constructor(client, baseUrl = DEFAULT_MCP_URL) {
        this.client = client;
        this.baseUrl = baseUrl;
    }
    /**
     * Get tools based on the provided context
     */
    async getTools(options = {}) {
        // Generate a cache key based on the options
        const cacheKey = JSON.stringify(options);
        // Check if we have cached results
        if (this.toolCache.has(cacheKey)) {
            return this.toolCache.get(cacheKey);
        }
        // Fetch tools if not cached
        const result = await fetchDynamicTools(options, this.baseUrl);
        // Cache the result (with a maximum cache size)
        if (this.toolCache.size > 20) {
            // Simple cache eviction - remove oldest entry
            const keysIterator = this.toolCache.keys();
            const firstKey = keysIterator.next().value;
            // Only delete if a key was actually found
            if (firstKey !== undefined) {
                this.toolCache.delete(firstKey);
            }
        }
        this.toolCache.set(cacheKey, result);
        return result;
    }
    /**
     * Get tools based on analyzing user message content
     * This is a smart context-based tool selection
     */
    async getToolsFromMessage(message, additionalOptions = {}) {
        // Extract contexts from the message
        const contexts = extractContextFromMessage(message);
        // If no contexts found, return empty tools array (requirement #1)
        if (contexts.length === 0) {
            console.error('[LOG][DYNAMIC-TOOLS] No context detected in message, returning empty tools array');
            return {
                tools: [],
                metadata: {
                    timestamp: new Date().toISOString(),
                    requestId: crypto.randomUUID().toString(),
                    filtered: false,
                    originalCount: 0,
                    returnedCount: 0,
                    reductionPercent: 0,
                    reason: 'no_context_detected'
                }
            };
        }
        // Get tools for each context and merge results
        const contextString = contexts.join(',');
        console.log(`[INFO][DYNAMIC-TOOLS] Extracted contexts: ${contextString}`);
        // Create options with the extracted context
        const options = {
            ...additionalOptions,
            context: contextString
        };
        return this.getTools(options);
    }
    /**
     * Call a tool using the MCP client
     */
    async callTool(params) {
        return await this.client.callTool(params);
    }
    /**
     * Get the original MCP client
     */
    getMcpClient() {
        return this.client;
    }
    /**
     * Close the MCP client connection
     */
    async close() {
        return await this.client.close();
    }
    /**
     * Get current tool metrics
     */
    async getMetrics() {
        return await getToolMetrics(this.baseUrl);
    }
    /**
     * Reset tool metrics
     */
    async resetMetrics() {
        this.toolCache.clear();
        return await resetToolMetrics(this.baseUrl);
    }
}
