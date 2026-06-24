import OpenAI from "openai";

let previousResponseId: string | null = null;

export interface ChatInput {
  apiKey: string;
  userPrompt: string;
  currentDisplay: string;
  dimension: [number, number];
}

export interface ChatOutput {
  display: string;
  caption: string;
}

export async function getResponse(input: ChatInput): Promise<ChatOutput> {
  const openai = new OpenAI({
    apiKey: input.apiKey,
    dangerouslyAllowBrowser: true,
  });

  const response = await openai.responses.create({
    previous_response_id: previousResponseId,
    instructions: getSystemPrompt(),
    input: getUserPrompt({
      display: input.currentDisplay,
      prompt: input.userPrompt,
    }),
    reasoning: {
      effort: "none",
    },
    text: {
      verbosity: "low",
      format: {
        type: "json_object",
      },
    },
  });

  previousResponseId = response.id;

  const parsed = JSON.parse(response.output_text);
  return {
    caption: parsed.caption,
    display: parsed.display,
  };
}

function getSystemPrompt() {
  return `
Respond to user with a 2D LCD alphanumeric display. Keep the displayed content minimal and engaging. Use simple words or basic symbols only.

Respond in this valid JSON format
{
  "caption": "...", // a short phrase summarize what the displayed content is
  "display": "...", // string that presents the displayed content. separate lines with "\\n"
}
  `.trim();
}

function getUserPrompt(input: { display: string; prompt: string }) {
  return `
${input.prompt}
(Current display: "${JSON.stringify(input.display)}")
  `.trim();
}
