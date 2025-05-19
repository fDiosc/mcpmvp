import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
// Load environment variables
dotenv.config();
// Initialize Anthropic client
export const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});
// Conversation store to maintain conversation IDs
const conversationStore = new Map();
// Function to get or create conversation ID
function getConversationId(sessionIdentifier) {
    // Clean up expired conversations (older than 30 minutes)
    const now = new Date();
    for (const [key, data] of conversationStore.entries()) {
        const timeDiff = now.getTime() - data.lastAccessed.getTime();
        if (timeDiff > 30 * 60 * 1000) { // 30 minutes in milliseconds
            console.log(`[LOG][ANTHROPIC] Removing expired conversation: ${key}`);
            conversationStore.delete(key);
        }
    }
    // Get or create conversation for this session
    if (!conversationStore.has(sessionIdentifier)) {
        const newId = uuidv4();
        console.log(`[LOG][ANTHROPIC] Creating new conversation ID: ${newId} for session: ${sessionIdentifier}`);
        conversationStore.set(sessionIdentifier, { id: newId, lastAccessed: now });
        return newId;
    }
    // Update last accessed time and return existing ID
    const conversation = conversationStore.get(sessionIdentifier);
    conversation.lastAccessed = now;
    console.log(`[LOG][ANTHROPIC] Using existing conversation ID: ${conversation.id} for session: ${sessionIdentifier}`);
    return conversation.id;
}
/**
 * Reestrutura o histórico de mensagens para garantir que cada tool_result
 * tenha um tool_use correspondente na mensagem anterior.
 *
 * Esta função foi implementada para resolver problemas de compatibilidade
 * com a API do Claude, que exige uma estrutura específica para ferramentas.
 * Referência: PR #176 no repositório MCP (make tool call result spec compatible)
 */
function restructureToolMessages(messages) {
    // If we have fewer than 1 message, there's nothing to restructure
    if (!messages || messages.length < 1)
        return [];
    const validatedMessages = [];
    // First pass: Collect all tool_use IDs and their associated message indices
    const toolUseMap = new Map(); // Maps tool_use IDs to message index in validatedMessages
    // Process each message first to validate and clean them
    for (const msg of messages) {
        if (!msg || !msg.role || msg.content === undefined || msg.content === null) {
            console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Skipping invalid or empty message (no role/content):', msg);
            continue;
        }
        let currentMessageRole = msg.role;
        if (currentMessageRole !== 'user' && currentMessageRole !== 'assistant') {
            console.warn(`[LOG][ANTHROPIC_RESTRUCTURE] Invalid role: ${msg.role}. Skipping message.`);
            continue;
        }
        let validatedContent;
        if (typeof msg.content === 'string') {
            validatedContent = [{ type: 'text', text: msg.content }];
        }
        else if (Array.isArray(msg.content)) {
            const processedBlocks = [];
            for (const block of msg.content) {
                if (!block || !block.type) {
                    console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Skipping invalid block (no type):', block);
                    continue;
                }
                switch (block.type) {
                    case 'text':
                        processedBlocks.push({ type: 'text', text: block.text || '' });
                        break;
                    case 'tool_use':
                        if (block.id && block.name) {
                            processedBlocks.push({
                                type: 'tool_use',
                                id: block.id,
                                name: block.name,
                                input: block.input || {}
                            });
                        }
                        else {
                            console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Skipping invalid tool_use block (missing id or name):', block);
                        }
                        break;
                    case 'tool_result':
                        if (block.tool_use_id) {
                            let resultBlockContent = block.content;
                            if (typeof resultBlockContent !== 'string') {
                                console.warn(`[LOG][ANTHROPIC_RESTRUCTURE] tool_result content is not a string. Stringifying: ID ${block.tool_use_id}`, resultBlockContent);
                                resultBlockContent = JSON.stringify(resultBlockContent);
                            }
                            processedBlocks.push({
                                type: 'tool_result',
                                tool_use_id: block.tool_use_id,
                                content: resultBlockContent
                            });
                        }
                        else {
                            console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Skipping invalid tool_result block (missing tool_use_id):', block);
                        }
                        break;
                    default:
                        console.warn(`[LOG][ANTHROPIC_RESTRUCTURE] Skipping unknown block type: ${block.type}`);
                        if (block.text) {
                            processedBlocks.push({ type: 'text', text: `[Unsupported Block Type: ${block.type}] ${block.text}` });
                        }
                }
            }
            if (processedBlocks.length === 0 && msg.content.length > 0) {
                console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Message content became empty after block validation, originally had blocks:', msg.content);
                validatedContent = [{ type: 'text', text: "[Content Filtered Due To Invalid Blocks]" }];
            }
            else if (processedBlocks.length === 0 && msg.content.length === 0) {
                console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Skipping message with initially empty content array.');
                continue;
            }
            else {
                validatedContent = processedBlocks;
            }
        }
        else {
            console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Unknown message content type, attempting to convert to text block:', msg.content);
            validatedContent = [{ type: 'text', text: JSON.stringify(msg.content) }];
        }
        // Only add the message if it has valid content after processing
        if (validatedContent && (!Array.isArray(validatedContent) || validatedContent.length > 0)) {
            // Add the message to our validated array
            validatedMessages.push({
                role: currentMessageRole,
                content: validatedContent,
            });
            // If this is an assistant message with tool_use blocks, record their IDs
            if (currentMessageRole === 'assistant' && Array.isArray(validatedContent)) {
                for (const block of validatedContent) {
                    if (block.type === 'tool_use' && block.id) {
                        toolUseMap.set(block.id, validatedMessages.length - 1);
                    }
                }
            }
        }
        else {
            console.warn('[LOG][ANTHROPIC_RESTRUCTURE] Message skipped as content was empty or invalid after processing:', msg);
        }
    }
    // Second pass: Check for orphaned tool_result blocks and remove them or convert to text
    const finalMessages = [];
    let skipNextMessage = false;
    for (let i = 0; i < validatedMessages.length; i++) {
        if (skipNextMessage) {
            skipNextMessage = false;
            continue;
        }
        const currentMsg = validatedMessages[i];
        // If this is a user message, check for tool_result blocks
        if (currentMsg.role === 'user' && Array.isArray(currentMsg.content)) {
            const orphanedToolResults = [];
            const validToolResults = [];
            for (const block of currentMsg.content) {
                if (block.type === 'tool_result' && block.tool_use_id) {
                    // Check if there's a corresponding tool_use message
                    if (!toolUseMap.has(block.tool_use_id)) {
                        console.warn(`[LOG][ANTHROPIC_RESTRUCTURE] Found orphaned tool_result with ID: ${block.tool_use_id}`);
                        // Convert to text to preserve content
                        orphanedToolResults.push({
                            type: 'text',
                            text: `[Tool Result]: ${block.content}`
                        });
                    }
                    else {
                        validToolResults.push(block);
                    }
                }
                else {
                    validToolResults.push(block);
                }
            }
            // If we have both valid and orphaned results, replace the content with valid ones
            // and create a new message for orphaned ones if needed
            if (orphanedToolResults.length > 0) {
                if (validToolResults.length > 0) {
                    // Keep the valid tool results in this message
                    finalMessages.push({
                        role: 'user',
                        content: validToolResults
                    });
                    // Add a new message with the orphaned results converted to text
                    if (orphanedToolResults.length > 0) {
                        finalMessages.push({
                            role: 'user',
                            content: orphanedToolResults
                        });
                    }
                }
                else {
                    // If all are orphaned, just convert them all to text
                    finalMessages.push({
                        role: 'user',
                        content: orphanedToolResults
                    });
                }
            }
            else {
                // No orphaned results, keep the message as is
                finalMessages.push(currentMsg);
            }
        }
        else {
            // For assistant messages or user messages without tool_result, keep as is
            finalMessages.push(currentMsg);
        }
    }
    // Log the outcome of restructuring for debugging
    if (messages.length !== finalMessages.length) {
        console.log(`[LOG][ANTHROPIC_RESTRUCTURE] Original message count: ${messages.length}, Validated message count: ${finalMessages.length}. Some messages may have been filtered or corrected.`);
    }
    return finalMessages;
}
/**
 * Calls the Claude API directly
 * @param messages The messages to send to Claude
 * @param tools The tools available to Claude
 * @param sessionId The session ID for tracking
 * @param systemPrompt Optional system prompt to pass as a top-level parameter
 */
export async function callClaudeDirectAPI(messages, tools = [], sessionId = 'default-session', systemPrompt) {
    try {
        console.error('[LOG][ANTHROPIC] Calling Claude API with messages and tools');
        // Add detailed logging for debugging tool_use and tool_result structure
        let toolUseIds = new Set();
        let toolResultIds = new Set();
        // Analyze messages to detect potential issues before restructuring
        messages.forEach((msg, idx) => {
            if (msg?.role === 'assistant' && Array.isArray(msg?.content)) {
                msg.content.forEach((block) => {
                    if (block?.type === 'tool_use' && block?.id) {
                        toolUseIds.add(block.id);
                    }
                });
            }
            if (msg?.role === 'user' && Array.isArray(msg?.content)) {
                msg.content.forEach((block) => {
                    if (block?.type === 'tool_result' && block?.tool_use_id) {
                        toolResultIds.add(block.tool_use_id);
                    }
                });
            }
        });
        // Detect orphaned tool_result blocks (no matching tool_use)
        const orphanedToolResults = Array.from(toolResultIds).filter(id => !toolUseIds.has(id));
        if (orphanedToolResults.length > 0) {
            console.warn(`[LOG][ANTHROPIC] WARNING: Found ${orphanedToolResults.length} orphaned tool_result blocks with no matching tool_use:`, orphanedToolResults);
        }
        // Log message structure before restructuring
        console.log(`[LOG][ANTHROPIC] Pre-restructuring stats: ${messages.length} messages, ${toolUseIds.size} tool_use blocks, ${toolResultIds.size} tool_result blocks`);
        // Reestruturar mensagens para manter contexto sem problemas de ferramentas
        // Esta etapa é crucial para a API do Claude, que exige uma estrutura específica
        // onde cada tool_result deve ter um tool_use correspondente na mensagem anterior
        const restructuredMessages = restructureToolMessages(messages);
        // Generate a session ID if not provided
        const currentSessionId = sessionId || 'default-session';
        const conversationId = getConversationId(currentSessionId);
        // Add post-restructuring stats
        let postToolUseCount = 0;
        let postToolResultCount = 0;
        restructuredMessages.forEach(msg => {
            if (Array.isArray(msg.content)) {
                msg.content.forEach((block) => {
                    if (block.type === 'tool_use')
                        postToolUseCount++;
                    if (block.type === 'tool_result')
                        postToolResultCount++;
                });
            }
        });
        console.log(`[LOG][ANTHROPIC] Post-restructuring stats: ${restructuredMessages.length} messages, ${postToolUseCount} tool_use blocks, ${postToolResultCount} tool_result blocks`);
        // Convert our messages to a simpler format that's compatible with the Anthropic API
        const formattedMessages = restructuredMessages.map((msg) => {
            // restructuredMessages should now provide msg.content as either a string (for rare direct pass-through)
            // or an array of CustomContentBlock which should be compatible with Anthropic's ContentBlockParam.
            if (typeof msg.content === 'string') { // Should be less common now for user/assistant, mainly if restructureToolMessages had a direct pass-through
                return {
                    role: msg.role,
                    content: msg.content
                };
            }
            // If msg.content is an array of CustomContentBlock, it should be directly usable
            // as ContentBlockParam[] after validation by restructureToolMessages.
            if (Array.isArray(msg.content)) {
                // We now trust that restructureToolMessages has prepared blocks that are valid ContentBlockParams.
                // However, the Anthropic SDK types are specific (e.g., TextBlock, ToolUseBlock, ToolResultBlock).
                // We need to ensure our CustomContentBlock array maps to these specific types if an explicit cast is not enough.
                // For now, let's cast and rely on runtime validation if types are subtly incompatible.
                // A more robust solution might involve a specific mapping function here if direct casting fails.
                const sdkContentBlocks = msg.content.map(customBlock => {
                    if (customBlock.type === 'text') {
                        return { type: 'text', text: customBlock.text || '' };
                    }
                    if (customBlock.type === 'tool_use') {
                        return { type: 'tool_use', id: customBlock.id, name: customBlock.name, input: customBlock.input };
                    }
                    if (customBlock.type === 'tool_result') {
                        // Anthropic SDK expects content for tool_result to be string or an array of specific blocks (Text, Image)
                        // Our restructureToolMessages now ensures customBlock.content is a string here.
                        return { type: 'tool_result', tool_use_id: customBlock.tool_use_id, content: customBlock.content };
                    }
                    // Fallback for unknown block types from CustomContentBlock not mapping to SDK - should be filtered by restructureToolMessages
                    console.warn("[LOG][ANTHROPIC_FORMAT] Unknown customBlock type during SDK mapping:", customBlock);
                    return { type: 'text', text: `[Invalid Block Type: ${customBlock.type}] ${JSON.stringify(customBlock)}` };
                });
                return {
                    role: msg.role,
                    content: sdkContentBlocks.filter(block => block !== null) // Filter out any nulls from bad conversions
                };
            }
            // Fallback for any other unexpected message formats not caught by restructureToolMessages
            console.warn("[LOG][ANTHROPIC_FORMAT] Unexpected message structure for formatting (content not string or array): ", msg);
            return {
                role: msg.role,
                content: '[Invalid Message Content Structure]' // Provide a default valid content
            };
        }).filter(msg => msg.content && (typeof msg.content === 'string' ? msg.content.length > 0 : msg.content.length > 0)); // Filter out messages that ended up with no content
        // Apply cache control if needed
        let messagesWithCaching = formattedMessages;
        messagesWithCaching = applyPromptCaching(formattedMessages);
        // Convert tools to the expected format
        const formattedTools = tools.map(tool => ({
            name: tool.name || '',
            description: tool.description || '',
            input_schema: {
                type: "object",
                properties: tool.input_schema?.properties || {},
                required: tool.input_schema?.required || []
            }
        }));
        // Log token count estimate (simplified)
        const inputJson = JSON.stringify(messagesWithCaching) + JSON.stringify(formattedTools);
        const estimatedTokens = Math.ceil(inputJson.length / 4); // Very rough estimate
        console.error(`[LOG][CACHE] Estimated input tokens: ~${estimatedTokens} (min cacheable threshold: 2048)`);
        // >>> ADD DETAILED LOGGING HERE <<<
        console.error("[LOG][ANTHROPIC_REQUEST_PAYLOAD] Messages being sent:", JSON.stringify(messagesWithCaching, null, 2));
        console.error("[LOG][ANTHROPIC_REQUEST_PAYLOAD] Tools being sent:", JSON.stringify(formattedTools, null, 2));
        if (systemPrompt) {
            console.error("[LOG][ANTHROPIC_REQUEST_PAYLOAD] System prompt being sent:", systemPrompt);
        }
        // >>> END DETAILED LOGGING <<<
        // Make API call with type assertions to ensure compatibility
        const response = await anthropic.messages.create({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 1024,
            messages: messagesWithCaching,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            tools: formattedTools,
            temperature: 0.7
        }, {
            headers: {
                "anthropic-beta": "prompt-caching-2024-07-31",
                "anthropic-conversation-id": conversationId
            }
        });
        // Log token usage and cache effectiveness
        logTokenUsage(response);
        console.error('[LOG][ANTHROPIC] Claude API response received');
        return response;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error("[ERROR][ANTHROPIC] Error calling Anthropic API:", errorMessage);
        throw error;
    }
}
// Helper function to roughly estimate token count
function estimateTokenCount(messages, tools) {
    // Very rough estimate - 1 token ~= 4 chars for English text
    let totalChars = 0;
    // Count message chars
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            totalChars += msg.content.length;
        }
        else {
            for (const block of msg.content) {
                if (block.type === 'text' && block.text) {
                    totalChars += block.text.length;
                }
                else if (block.type === 'tool_result' && block.content) {
                    totalChars += block.content.length;
                }
                else if (block.type === 'tool_use') {
                    totalChars += JSON.stringify(block.input || {}).length;
                    totalChars += (block.name || '').length;
                }
            }
        }
    }
    // Count tool chars
    for (const tool of tools) {
        totalChars += tool.name.length;
        totalChars += tool.description.length;
        totalChars += JSON.stringify(tool.input_schema).length;
    }
    // Very rough conversion - just for estimation
    return Math.round(totalChars / 4);
}
// Function to log token usage and cache effectiveness
function logTokenUsage(response) {
    console.log('[LOG][TOKENS] ============= TOKEN USAGE =============');
    console.log(`[LOG][TOKENS] Input tokens: ${response.usage?.input_tokens || 'N/A'}`);
    console.log(`[LOG][TOKENS] Output tokens: ${response.usage?.output_tokens || 'N/A'}`);
    // Check if we meet minimum cacheable threshold
    const totalInputTokens = response.usage?.input_tokens || 0;
    if (totalInputTokens < 2048) {
        console.log(`[LOG][CACHE] WARNING: Total input tokens (${totalInputTokens}) below minimum cacheable threshold for Haiku (2048 tokens)`);
    }
    else {
        console.log(`[LOG][CACHE] Input tokens (${totalInputTokens}) meet minimum cacheable threshold (2048)`);
    }
    // Log cache-specific information if available
    if (response.usage?.cache_creation_input_tokens) {
        console.log(`[LOG][CACHE] Cache creation tokens: ${response.usage.cache_creation_input_tokens}`);
        console.log('[LOG][CACHE] New cache entry created');
        console.log(`[LOG][CACHE] Cache overhead: ${Math.round((response.usage.cache_creation_input_tokens / totalInputTokens) * 100)}% (expected: 25%)`);
    }
    if (response.usage?.cache_read_input_tokens) {
        console.log(`[LOG][CACHE] Cache read tokens: ${response.usage.cache_read_input_tokens}`);
        console.log('[LOG][CACHE] Successfully read from cache');
        // Calculate approximate savings
        const inputTokens = response.usage?.input_tokens || 0;
        const cacheReadTokens = response.usage?.cache_read_input_tokens || 0;
        const savings = inputTokens > 0 ? ((cacheReadTokens / inputTokens) * 100).toFixed(2) : 'N/A';
        console.log(`[LOG][CACHE] Cache efficiency: ${savings}%`);
        console.log(`[LOG][CACHE] Approximate cost reduction: ${Math.round(100 - (10 * cacheReadTokens / inputTokens))}% (expected: 90%)`);
    }
    if (!response.usage?.cache_creation_input_tokens && !response.usage?.cache_read_input_tokens) {
        console.log('[LOG][CACHE] No cache activity detected. Possible reasons:');
        console.log('[LOG][CACHE] - Input below minimum threshold (needs 2048+ tokens for Haiku)');
        console.log('[LOG][CACHE] - Cache control not properly applied');
        console.log('[LOG][CACHE] - API beta feature not enabled correctly');
        console.log('[LOG][CACHE] - Content changes breaking cache');
    }
    console.log('[LOG][TOKENS] =======================================');
}
// Function to apply prompt caching to messages
function applyPromptCaching(messages) {
    if (messages.length <= 1) {
        return messages;
    }
    // Make a deep copy to avoid modifying the original
    const result = JSON.parse(JSON.stringify(messages));
    // IMPORTANT: Anthropic only allows up to 4 cache_control blocks
    // Since we're not using padding, we can use all 4 blocks strategically
    // Strategy: First message, middle, recent history, and latest user message
    // Cache counter to track how many we've added (max 4)
    let cacheControlCount = 0;
    // 1. Apply cache control to first message (if it exists and we have room)
    if (result.length > 0 && result[0].role === 'user' && cacheControlCount < 4) {
        if (typeof result[0].content === 'string') {
            result[0].content = [{
                    type: 'text',
                    text: result[0].content,
                    cache_control: { type: "ephemeral" }
                }];
            cacheControlCount++;
        }
        else if (Array.isArray(result[0].content)) {
            if (result[0].content.length > 0) {
                result[0].content[0] = {
                    ...result[0].content[0],
                    cache_control: { type: "ephemeral" }
                };
                cacheControlCount++;
            }
        }
    }
    // 2. If we have 6+ messages, apply cache to a middle message (if we have room)
    if (result.length >= 6 && cacheControlCount < 4) {
        const middleIndex = Math.floor(result.length / 2);
        if (result[middleIndex].role === 'user') {
            if (typeof result[middleIndex].content === 'string') {
                result[middleIndex].content = [{
                        type: 'text',
                        text: result[middleIndex].content,
                        cache_control: { type: "ephemeral" }
                    }];
                cacheControlCount++;
            }
            else if (Array.isArray(result[middleIndex].content)) {
                if (result[middleIndex].content.length > 0) {
                    result[middleIndex].content[0] = {
                        ...result[middleIndex].content[0],
                        cache_control: { type: "ephemeral" }
                    };
                    cacheControlCount++;
                }
            }
        }
    }
    // 3. Apply cache control to second-to-last user message (if we have room)
    if (cacheControlCount < 4) {
        const lastUserMsgIndex = findLastIndex(result, (msg) => msg.role === 'user');
        const secondToLastUserMsgIndex = findLastIndex(result.slice(0, lastUserMsgIndex), (msg) => msg.role === 'user');
        // If we have at least two user messages, add cache control to the second-to-last one
        if (secondToLastUserMsgIndex >= 0) {
            const actualIndex = secondToLastUserMsgIndex;
            if (typeof result[actualIndex].content === 'string') {
                result[actualIndex].content = [{
                        type: 'text',
                        text: result[actualIndex].content,
                        cache_control: { type: "ephemeral" }
                    }];
                cacheControlCount++;
            }
            else if (Array.isArray(result[actualIndex].content)) {
                // Apply to at most one item to conserve our cache_control quota
                if (result[actualIndex].content.length > 0) {
                    result[actualIndex].content[0] = {
                        ...result[actualIndex].content[0],
                        cache_control: { type: "ephemeral" }
                    };
                    cacheControlCount++;
                }
            }
        }
    }
    // 4. Apply cache to latest user message if we still have quota
    if (cacheControlCount < 4) {
        const lastUserMsgIndex = findLastIndex(result, (msg) => msg.role === 'user');
        if (lastUserMsgIndex >= 0) {
            if (typeof result[lastUserMsgIndex].content === 'string') {
                result[lastUserMsgIndex].content = [{
                        type: 'text',
                        text: result[lastUserMsgIndex].content,
                        cache_control: { type: "ephemeral" }
                    }];
                cacheControlCount++;
            }
            else if (Array.isArray(result[lastUserMsgIndex].content)) {
                // Only apply if not already applied
                if (result[lastUserMsgIndex].content.length > 0) {
                    const hasCache = result[lastUserMsgIndex].content.some((block) => block.cache_control && block.cache_control.type === 'ephemeral');
                    if (!hasCache) {
                        result[lastUserMsgIndex].content[0] = {
                            ...result[lastUserMsgIndex].content[0],
                            cache_control: { type: "ephemeral" }
                        };
                        cacheControlCount++;
                    }
                }
            }
        }
    }
    console.log(`[LOG][CACHE] Applied ${cacheControlCount} cache control blocks (max 4 allowed)`);
    return result;
}
// Fix the findLastIndex function with proper type safety
function findLastIndex(array, predicate) {
    for (let i = array.length - 1; i >= 0; i--) {
        if (predicate(array[i])) {
            return i;
        }
    }
    return -1;
}
// Função utilitária para converter snake_case para camelCase
function snakeToCamel(obj) {
    if (Array.isArray(obj)) {
        return obj.map(snakeToCamel);
    }
    else if (obj && typeof obj === 'object') {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [
            k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
            snakeToCamel(v)
        ]));
    }
    return obj;
}
// Function to handle tool execution and format responses properly
export async function handleToolExecution(toolUse, executeTool, messageHistory) {
    const { name, input } = toolUse;
    // Use the original id from the model if available, otherwise generate a new one
    const toolUseId = toolUse.id || uuidv4();
    console.log(`[LOG][ANTHROPIC] Executing tool: ${name}`);
    // Check if we've already called this exact tool with these exact parameters
    // This helps prevent infinite loops where Claude keeps requesting the same tool
    const isDuplicateToolCall = messageHistory.some(msg => {
        if (msg.role !== 'assistant' || !Array.isArray(msg.content))
            return false;
        return msg.content.some(block => {
            if (block.type !== 'tool_use' || block.name !== name)
                return false;
            // Compare input objects for deep equality
            return JSON.stringify(block.input) === JSON.stringify(input);
        });
    });
    if (isDuplicateToolCall) {
        console.log(`[LOG][ANTHROPIC] Detected duplicate tool call for ${name}. Skipping execution to prevent loop.`);
        // Return a modified message history with a note about the duplicate call
        // Don't actually add a new tool_use since Claude already has one
        messageHistory.push({
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: toolUseId,
                    content: `Tool ${name} was already called with the same parameters. To prevent an infinite loop, this duplicate call was intercepted.`
                }
            ]
        });
        return { messageHistory, toolResult: { content: [{ type: 'text', text: 'Duplicate tool call intercepted.' }] } };
    }
    try {
        // Normaliza argumentos para camelCase
        const normalizedInput = snakeToCamel(input);
        // Execute the tool with the provided input
        const toolResult = await executeTool(name, normalizedInput);
        console.log(`[LOG][ANTHROPIC] Tool result received`);
        // Format the tool result in the way Claude expects
        const resultContent = toolResult?.content?.[0]?.text || JSON.stringify(toolResult);
        // Add assistant message with tool use - using id for tool_use blocks
        // Make sure the ID is preserved exactly as received from Claude
        messageHistory.push({
            role: "assistant",
            content: [
                {
                    type: "tool_use",
                    id: toolUseId,
                    name,
                    input
                }
            ]
        });
        // Add user message with tool result - using tool_use_id for tool_result blocks
        // This must exactly match the id from the tool_use block
        messageHistory.push({
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: toolUseId,
                    content: resultContent
                }
            ]
        });
        return { messageHistory, toolResult };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[ERROR][ANTHROPIC] Error executing tool ${name}:`, errorMessage);
        // Add an error result message
        messageHistory.push({
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: toolUseId,
                    content: `Error executing tool: ${errorMessage}`
                }
            ]
        });
        return { messageHistory, error };
    }
}
// Function to convert MCP tools to Anthropic tool format
export function convertMcpToolsToAnthropicFormat(mcpTools) {
    return mcpTools.map(tool => ({
        name: tool.name,
        description: tool.description || `MCP tool: ${tool.name}`,
        input_schema: {
            type: "object",
            properties: tool.inputSchema.properties || {},
            required: tool.inputSchema.required || []
        }
    }));
}
// Function to convert plain text messages to properly formatted Anthropic messages
export function formatMessagesForAnthropic(messages) {
    // Primeiro, filtra mensagens vazias ou inválidas
    const validMessages = messages.filter(msg => {
        // Verifica se a mensagem tem role e content
        if (!msg || typeof msg !== 'object' || !msg.role) {
            return false;
        }
        // Verifica strings vazias no content
        if (typeof msg.content === 'string') {
            return msg.content.trim() !== '';
        }
        // Verifica arrays vazios no content
        if (Array.isArray(msg.content)) {
            if (msg.content.length === 0)
                return false;
            // Verifica cada item do array de content
            return msg.content.some((item) => {
                if (item && item.type === 'text') {
                    return item.text && item.text.trim() !== '';
                }
                return false;
            });
        }
        // Verifica objetos de content
        if (msg.content && typeof msg.content === 'object') {
            if (msg.content.type === 'text') {
                return msg.content.text && msg.content.text.trim() !== '';
            }
        }
        return false;
    });
    // Extrai mensagens do sistema (deve ser passada como parâmetro de nível superior)
    let systemContent;
    const nonSystemMessages = [];
    for (const msg of validMessages) {
        if (msg.role === 'system') {
            // Extrair conteúdo do sistema
            if (typeof msg.content === 'string') {
                systemContent = msg.content;
            }
            else if (Array.isArray(msg.content)) {
                // Pega apenas o texto dos objetos de conteúdo
                const textParts = msg.content
                    .filter((item) => item && item.type === 'text' && item.text)
                    .map((item) => item.text);
                if (textParts.length > 0) {
                    systemContent = textParts.join('\n');
                }
            }
            else if (msg.content && msg.content.type === 'text') {
                systemContent = msg.content.text;
            }
        }
        else {
            // Processar mensagens não-sistema
            if (typeof msg.content === 'string') {
                nonSystemMessages.push({
                    role: msg.role,
                    content: [{
                            type: 'text',
                            text: msg.content
                        }]
                });
            }
            else if (Array.isArray(msg.content)) {
                const contents = msg.content
                    .filter((item) => item && item.type === 'text' && item.text)
                    .map((item) => ({
                    type: 'text',
                    text: item.text
                }));
                if (contents.length > 0) {
                    nonSystemMessages.push({
                        role: msg.role,
                        content: contents
                    });
                }
            }
            else if (msg.content && msg.content.type === 'text') {
                nonSystemMessages.push({
                    role: msg.role,
                    content: [{
                            type: 'text',
                            text: msg.content.text
                        }]
                });
            }
        }
    }
    return {
        messages: nonSystemMessages,
        system: systemContent
    };
}
