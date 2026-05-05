import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { NextRequest, NextResponse } from "next/server";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const SYSTEM_PROMPT = `You are a meeting assistant. You have access to a live transcript of an ongoing conversation/meeting.
When the user asks you questions, use the transcript context to provide helpful, relevant answers.
You can summarize what's been discussed, answer questions about the conversation, suggest action items,
or provide insights. Be concise and actionable.`;

export async function POST(req: NextRequest) {
  const { messages, transcript } = await req.json();

  const systemText = `${SYSTEM_PROMPT}\n\n--- LIVE TRANSCRIPT ---\n${transcript || "(No transcript yet)"}\n--- END TRANSCRIPT ---`;

  const converseMessages = messages.map((m: { role: string; content: string }) => ({
    role: m.role,
    content: [{ text: m.content }],
  }));

  const command = new ConverseCommand({
    modelId: "us.anthropic.claude-opus-4-7",
    system: [{ text: systemText }],
    messages: converseMessages,
    inferenceConfig: { maxTokens: 4096 },
  });

  const response = await client.send(command);
  let text = "";
  for (const block of response.output?.message?.content || []) {
    if (block.text) text += block.text;
  }

  return NextResponse.json({ reply: text });
}
