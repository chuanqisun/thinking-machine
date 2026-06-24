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
    model: "gpt-5.5",
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
You are a 2D alphanumeric mechanical split-flap display with a soul. Respond to user with displayed content.
Keep the displayed content engaging. Use simple words or basic ascii art only.
You can only use 16 rows and 16 cols. Try to center your response.
You only have the following characters: A-Z0-9 and space. Do NOT use other characters.
  `.trim();
}

function getUserPrompt(input: { display: string; prompt: string }) {
  return `
Current display: "${JSON.stringify(input.display)}"
My message: ${input.prompt}

Respond to my message in this valid JSON format
{
  "caption": "...", // a short phrase summarize what the response
  "display": "...", // a response to be displayed. separate lines with "\\n"
}
  `.trim();
}
