import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  AudioStream,
} from "@aws-sdk/client-transcribe-streaming";
import { NextRequest } from "next/server";

const client = new TranscribeStreamingClient({
  region: process.env.AWS_REGION || "us-east-1",
});

async function* audioStreamGenerator(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<AudioStream> {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) yield { AudioEvent: { AudioChunk: value } };
  }
}

export async function POST(req: NextRequest) {
  const body = req.body;
  if (!body) {
    return new Response("No audio stream", { status: 400 });
  }

  const reader = body.getReader();

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: "en-US",
    MediaEncoding: "pcm",
    MediaSampleRateHertz: 16000,
    AudioStream: audioStreamGenerator(reader),
  });

  const response = await client.send(command);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (response.TranscriptResultStream) {
          for await (const event of response.TranscriptResultStream) {
            if (event.TranscriptEvent?.Transcript?.Results) {
              for (const result of event.TranscriptEvent.Transcript.Results) {
                if (result.Alternatives && result.Alternatives.length > 0) {
                  const data = JSON.stringify({
                    text: result.Alternatives[0].Transcript || "",
                    isPartial: result.IsPartial || false,
                  });
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                }
              }
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
