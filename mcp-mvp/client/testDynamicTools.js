/**
 * Test Dynamic Tools Client
 *
 * This script demonstrates and tests the dynamic tools functionality,
 * including the Phase 2 context-based filtering features.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { DynamicToolClient, fetchDynamicTools, extractContextFromMessage, COMMON_CONTEXTS } from './dynamicTools.js';
const DEFAULT_MCP_URL = 'http://localhost:3333';
async function testDynamicTools() {
    try {
        console.log('===== Dynamic Tools Test Script (Phase 2) =====');
        // Connect to MCP server
        console.log('\n[1] Connecting to MCP server...');
        const sseUrl = new URL(`${DEFAULT_MCP_URL}/mcp/sse`);
        const transport = new SSEClientTransport(sseUrl);
        const client = new Client({
            name: 'dynamic-tools-test-client',
            version: '0.1.0'
        });
        await client.connect(transport);
        console.log('Connected to MCP server');
        // Create dynamic tools client
        const dynamicClient = new DynamicToolClient(client);
        // Test direct function for fetching all tools
        console.log('\n[2] Testing direct function for fetching all tools...');
        const allTools = await fetchDynamicTools();
        console.log(`Retrieved ${allTools.tools.length} tools directly`);
        // Test fetching with explicit context
        console.log('\n[3] Testing fetching tools with explicit context...');
        const jiraTools = await dynamicClient.getTools({ context: 'jira' });
        console.log(`Retrieved ${jiraTools.tools.length} tools with 'jira' context (${jiraTools.metadata.reductionPercent}% reduction)`);
        // Test context extraction from user messages
        console.log('\n[4] Testing context extraction from user messages...');
        const testMessages = [
            "I need to find PROJ-123 issue details",
            "Create a note about the meeting",
            "Show me all comments on the ticket ABC-456",
            "I want to search for issues assigned to me",
            "Get all attachments from the bug report",
            "Random message with no specific context"
        ];
        for (const message of testMessages) {
            const contexts = extractContextFromMessage(message);
            console.log(`Message: "${message}"`);
            console.log(`Extracted contexts: ${contexts.length > 0 ? contexts.join(', ') : 'none'}`);
            // Get tools based on the message
            const messageTools = await dynamicClient.getToolsFromMessage(message);
            console.log(`Selected ${messageTools.tools.length} tools (${messageTools.metadata.reductionPercent || 0}% reduction)`);
            console.log(`Tools: ${messageTools.tools.map((t) => t.name).join(', ')}`);
            console.log('-'.repeat(50));
        }
        // Test tool metrics
        console.log('\n[5] Testing tool metrics...');
        const metrics = await dynamicClient.getMetrics();
        console.log('Current metrics:');
        console.log(JSON.stringify(metrics, null, 2));
        // Test performance comparison between filtered and unfiltered
        console.log('\n[6] Testing performance comparison...');
        // First reset metrics
        await dynamicClient.resetMetrics();
        console.log('Metrics reset for comparison test');
        // Now perform multiple calls with and without filtering
        for (let i = 0; i < 5; i++) {
            // Unfiltered (baseline)
            await fetchDynamicTools();
            // Filtered with different contexts
            await dynamicClient.getTools({ context: 'jira' });
            await dynamicClient.getTools({ context: 'notes' });
            await dynamicClient.getToolsFromMessage("Find PROJ-123 and create a note about it");
        }
        // Get updated metrics after comparison
        const comparisonMetrics = await dynamicClient.getMetrics();
        console.log('Comparison metrics:');
        console.log(JSON.stringify(comparisonMetrics, null, 2));
        // Display available contexts
        console.log('\n[7] Available contexts for filtering:');
        for (const [context, keywords] of Object.entries(COMMON_CONTEXTS)) {
            console.log(`- ${context}: ${keywords.join(', ')}`);
        }
        // Close connection
        console.log('\n[8] Closing connection...');
        await dynamicClient.close();
        console.log('Connection closed');
        console.log('\n===== Test Completed Successfully =====');
    }
    catch (error) {
        console.error('\n❌ Error during dynamic tools test:', error);
    }
}
// Run the test script
testDynamicTools();
