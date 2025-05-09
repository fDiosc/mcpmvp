import { z } from "zod";

// Prompt: Summarize Notes
export function registerSummarizeNotesPrompt(server: any, notes: Record<string, any>) {
  server.prompt(
    "summarize_notes",
    {},
    async (_args: any, _extra: any) => {
      console.error('[LOG][PROMPT] summarize_notes used', { args: _args });
      const embeddedNotes = Object.entries(notes).map(([id, note]) => ({
        role: "user" as const,
        content: {
          type: "resource" as const,
          resource: {
            uri: `note:///${id}`,
            mimeType: "text/plain",
            text: note.content
          }
        }
      }));
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Please summarize the following notes:"
            }
          },
          ...embeddedNotes,
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Provide a concise summary of all the notes above."
            }
          }
        ]
      };
    }
  );
}

// Prompt: Tool Selection
export function registerToolSelectionPrompt(server: any) {
  server.prompt(
    "tool_selection",
    {
      userMessage: z.string().describe("Mensagem do usuário"),
      toolsText: z.string().describe("Lista de ferramentas disponíveis em texto formatado")
    },
    async ({ userMessage, toolsText }: { userMessage: string, toolsText: string }, _extra: any) => {
      console.error('[LOG][PROMPT] tool_selection used', { userMessage, toolsText });
      const promptText = `\nUsuário enviou a seguinte mensagem:\n"${userMessage}"\n\nLista de ferramentas disponíveis:\n${toolsText}\n\nQuais ferramentas são relevantes para atender ao pedido do usuário?\nResponda apenas com uma lista de nomes de ferramentas, separados por vírgula.`;
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: promptText
            }
          }
        ]
      };
    }
  );
}

// Prompt: Newsletter Post
export function registerNewsletterPrompt(server: any) {
  server.prompt(
    "newsletter_post",
    {
      feature: z.string().describe("Description of the new feature"),
      context: z.string().optional().describe("Additional context or target audience for the newsletter")
    },
    async ({ feature, context }: { feature: string, context?: string }, _extra: any) => {
      console.error('[LOG][PROMPT] newsletter_post used', { feature, context });
      const promptText = `\nA new feature has been developed: "${feature}".\n${context ? `Context: ${context}` : ""}\nWrite a newsletter post announcing this feature. The post should be engaging, clear, and suitable for our audience.`;
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: promptText
            }
          }
        ]
      };
    }
  );
}

// Prompt: Release Note
export function registerReleaseNotePrompt(server: any) {
  server.prompt(
    "release_note",
    {
      summary: z.string().describe("Summary of the release or feature"),
      details: z.string().optional().describe("Additional details, bug fixes, improvements, etc.")
    },
    async ({ summary, details }: { summary: string, details?: string }, _extra: any) => {
      console.error('[LOG][PROMPT] release_note used', { summary, details });
      const promptText = `\nRelease Note:\nSummary: "${summary}"\n${details ? `Details: ${details}` : ""}\nWrite a clear and concise release note for this update. Use a professional tone and highlight the most important changes.`;
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: promptText
            }
          }
        ]
      };
    }
  );
} 