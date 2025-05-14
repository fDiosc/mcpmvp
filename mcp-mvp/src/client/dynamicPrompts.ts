/**
 * Dynamic Prompts Client
 * 
 * Este módulo fornece funcionalidade para detectar e utilizar prompts de forma contextual,
 * selecionando o prompt apropriado com base na mensagem do usuário.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * Detecta quais prompts são relevantes com base na mensagem do usuário
 * @param message A mensagem do usuário
 * @param mcpClient O cliente MCP para acessar prompts
 */
export async function detectPromptsFromMessage(message: string, mcpClient: any): Promise<{ promptName: string; params: any } | null> {
  if (!message || typeof message !== 'string') {
    console.error('[LOG][PROMPT_CONTEXT] Invalid message received:', message);
    return null;
  }
  
  // Se o keyword mapping falhar, use o LLM para determinar o prompt adequado
  const lowercaseMsg = message.toLowerCase();
  
  // Lista de todos os prompts disponíveis
  let availablePrompts: any[] = [];
  try {
    // Definição manual de prompts disponíveis até corrigir a API
    availablePrompts = [
      { name: 'summarize_notes', description: 'Resumir todas as notas do sistema' },
      { name: 'newsletter_post', description: 'Criar um post de newsletter sobre novos recursos' },
      { name: 'release_note', description: 'Criar uma nota de lançamento para uma versão' },
      { name: 'tool_selection', description: 'Selecionar ferramentas adequadas para uma tarefa' }
    ];
    console.error('[LOG][PROMPT_CONTEXT] Using hardcoded prompts list:', availablePrompts);
  } catch (error) {
    console.error('[ERROR][PROMPT_CONTEXT] Error with prompts:', error);
    return null;
  }
  
  if (availablePrompts.length === 0) {
    console.error('[LOG][PROMPT_CONTEXT] No prompts available');
    return null;
  }
  
  // Mapeia cada prompt para uma string descritiva para o LLM
  const promptDescriptions = availablePrompts.map(prompt => 
    `- ${prompt.name}: ${prompt.description || `Prompt para ${prompt.name}`}`
  ).join('\n');
  
  // Decide qual modelo usar para a seleção de prompts
  // Prefira usar um modelo mais leve/rápido para esta decisão
  const promptSelectionModel = "claude-3-5-haiku-20241022"; // Ou qualquer modelo que preferir
  
  // Prompt para o LLM selecionar o prompt correto
  const promptText = `
Usuário enviou a seguinte mensagem:
"${message}"

Lista de prompts disponíveis:
${promptDescriptions}

Com base na mensagem do usuário, qual dos prompts acima é mais adequado para atender ao pedido?
Se nenhum prompt for adequado, responda "nenhum".
Responda apenas com o nome do prompt sem explicações adicionais. 
Se for necessário extrair algum parâmetro da mensagem do usuário para o prompt, liste-os no formato JSON após o nome do prompt.

Exemplo de resposta para seleção do prompt newsletter_post:
newsletter_post{"feature":"AI Assistant", "context":"Technical users"}
`;

  // Chama o LLM para fazer a seleção de prompt
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  });
  
  try {
    const response = await anthropic.messages.create({
      model: promptSelectionModel,
      max_tokens: 150,
      messages: [
        { role: "user", content: promptText }
      ],
      temperature: 0.2,  // Baixa temperatura para decisões mais determinísticas
    });
    
    // Fix for Anthropic API response format
    let llmResponse = '';
    if (response.content && Array.isArray(response.content) && response.content.length > 0) {
      const contentBlock = response.content[0];
      if (contentBlock.type === 'text') {
        llmResponse = contentBlock.text.trim();
      } else {
        console.error('[LOG][PROMPT_CONTEXT] Unexpected content type:', contentBlock.type);
        return null;
      }
    } else {
      console.error('[LOG][PROMPT_CONTEXT] No content in LLM response');
      return null;
    }
    
    console.error('[LOG][PROMPT_CONTEXT] LLM response for prompt selection:', llmResponse);
    
    // Se o LLM responde "nenhum", não há prompt adequado
    if (llmResponse.toLowerCase() === 'nenhum') {
      console.error('[LOG][PROMPT_CONTEXT] LLM determined no prompt is suitable');
      return null;
    }
    
    // Tenta extrair o nome do prompt e os parâmetros
    let promptName = llmResponse;
    let params = {};
    
    // Verifica se há parâmetros em formato JSON
    const jsonMatch = llmResponse.match(/([a-z_]+)(\{.*\})/);
    if (jsonMatch) {
      promptName = jsonMatch[1];
      try {
        params = JSON.parse(jsonMatch[2]);
      } catch (e) {
        console.error('[ERROR][PROMPT_CONTEXT] Failed to parse JSON params:', jsonMatch[2]);
      }
    }
    
    // Verifica se o prompt selecionado existe
    const selectedPrompt = availablePrompts.find(p => p.name === promptName);
    if (!selectedPrompt) {
      console.error(`[ERROR][PROMPT_CONTEXT] Selected prompt '${promptName}' not found in available prompts`);
      return null;
    }
    
    logPromptDetection(message, promptName, params);
    return { promptName, params };
  } catch (error) {
    console.error('[ERROR][PROMPT_CONTEXT] Error calling LLM for prompt selection:', error);
    return null;
  }
}

/**
 * Cliente para prompts dinâmicos baseados em contexto
 */
export class DynamicPromptClient {
  private client: any;
  private promptCache: Map<string, any> = new Map();
  
  constructor(client: any) {
    this.client = client;
  }
  
  /**
   * Detecta e obtém o prompt adequado com base na mensagem do usuário
   */
  async getPromptFromMessage(message: string): Promise<{ 
    promptContent: any; 
    promptName: string;
    shouldAppend: boolean;
    system?: string;
  } | null> {
    // Detecta qual prompt usar
    const promptDetection = await detectPromptsFromMessage(message, this.client);
    
    if (!promptDetection) {
      return null;
    }
    
    try {
      // Obtenção manual do prompt baseado no tipo detectado
      console.error(`[LOG][DYNAMIC_PROMPT] Using manually constructed prompt: ${promptDetection.promptName} ${JSON.stringify(promptDetection.params)}`);
      
      const promptContent = this.getPromptContent(promptDetection.promptName, promptDetection.params);
      
      if (!promptContent) {
        console.error(`[LOG][DYNAMIC_PROMPT] Failed to get content for prompt: ${promptDetection.promptName}`);
        return null;
      }
      
      return {
        promptContent: promptContent.messages,
        promptName: promptDetection.promptName,
        shouldAppend: promptContent.shouldAppend,
        system: promptContent.system
      };
    } catch (err) {
      console.error(`[LOG][DYNAMIC_PROMPT] Error retrieving prompt: ${err}`);
      return null;
    }
  }
  
  /**
   * Formata mensagens com o prompt contextual
   */
  formatMessagesWithPrompt(userMessage: string, promptResult: any, shouldAppend: boolean): any[] {
    // CORREÇÃO: Implementar as duas abordagens sugeridas
    // Abordagem 1: Adicionar o prompt como system, manter a mensagem como user
    
    if (!userMessage || !userMessage.trim()) {
      console.error('[ERROR][DYNAMIC_PROMPT] Empty user message provided');
      return [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Por favor, forneça mais detalhes sobre o que você precisa."
            }
          ]
        }
      ];
    }
    
    // Extrair mensagens do promptResult
    const systemMessages = promptResult.messages.filter((m: any) => m.role === 'system');
    const promptUserMessages = promptResult.messages.filter((m: any) => m.role === 'user');
    
    let messages = [];
    
    // Abordagem 1: Se temos uma mensagem system, usamos ela como sistema e mantemos a mensagem do usuário
    if (systemMessages.length > 0) {
      messages = [
        ...systemMessages,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userMessage
            }
          ]
        }
      ];
    }
    // Abordagem 2: Concatenar o texto do prompt com a mensagem do usuário
    else if (promptUserMessages.length > 0 && shouldAppend) {
      // Extrair o texto do prompt
      const promptText = promptUserMessages.map((m: any) => {
        if (typeof m.content === 'string') {
          return m.content;
        } else if (m.content.type === 'text') {
          return m.content.text;
        } else {
          return JSON.stringify(m.content);
        }
      }).join('\n\n');
      
      // Criar uma única mensagem combinada
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${promptText}\n\n${userMessage}`
            }
          ]
        }
      ];
    }
    // Fallback: se não conseguimos extrair um prompt adequado, apenas usar a mensagem do usuário
    else {
      messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: userMessage
            }
          ]
        }
      ];
    }
    
    console.error('[LOG][DYNAMIC_PROMPT] Formatted messages:', JSON.stringify(messages, null, 2));
    return messages;
  }

  /**
   * Constrói manualmente os prompts suportados
   * @param promptName Nome do prompt
   * @param params Parâmetros para o prompt
   */
  private getPromptContent(promptName: string, params: any = {}): { 
    messages: any[]; 
    system?: string;
    shouldAppend: boolean;
  } | null {
    // Implementação de prompts hard-coded para a versão inicial
    if (promptName === 'newsletter_post') {
      const feature = params.feature || 'unnamed feature';
      const context = params.context || '';
      
      // Para o prompt de newsletter, vamos usar um system prompt
      return {
        messages: [],
        system: `Você está escrevendo uma newsletter profissional. A new feature has been developed: "${feature}".\n\nA newsletter deve ser envolvente, clara e adequada para nosso público.${context ? ' Context: ' + context : ''}`,
        shouldAppend: false
      };
    }
    
    
    if (promptName === 'release_note') {
      const version = params.version || 'próxima versão';
      
      return {
        messages: [],
        system: `Você está escrevendo notas de lançamento para a ${version}. As notas devem ser claras e orientadas para os usuários, destacando novos recursos, melhorias e correções.`,
        shouldAppend: false
      };
    }
    
    if (promptName === 'tool_selection') {
      return {
        messages: [],
        system: `Você é um assistente especializado em selecionar as ferramentas adequadas para tarefas específicas. Quando o usuário apresentar uma tarefa, analise-a cuidadosamente e recomende as ferramentas mais apropriadas da nossa coleção para ajudar a realizar essa tarefa.`,
        shouldAppend: false
      };
    }
    
    return null;
  }
}

/**
 * Função para logar informações sobre a detecção de prompts
 */
export function logPromptDetection(message: string, promptName: string | null, params: any = {}) {
  // Log apenas o essencial para debugging de prompts
  const logObj: any = {
    userMessage: message,
    detectedPrompt: promptName || 'NONE',
  };
  if (promptName && Object.keys(params).length > 0) {
    logObj.parameters = params;
  }
  console.log('[PROMPT DETECTION]', logObj);
} 