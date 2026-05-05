"use client";
import { useState, useRef, useEffect, useCallback } from "react";

type Message = { role: "user" | "assistant"; content: string };

export default function Home() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [partialText, setPartialText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  const startListening = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    mediaStreamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    const abort = new AbortController();
    abortRef.current = abort;

    // Collect audio chunks and stream to backend
    const audioChunks: ArrayBuffer[] = [];
    let sending = false;

    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        pcm16[i] = Math.max(-32768, Math.min(32767, Math.floor(float32[i] * 32768)));
      }
      audioChunks.push(pcm16.buffer);
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    setListening(true);

    // Stream audio to backend in batches
    const sendAudio = async () => {
      if (sending || abort.signal.aborted) return;
      sending = true;

      const chunks = audioChunks.splice(0);
      if (chunks.length === 0) { sending = false; return; }

      const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: merged,
          signal: abort.signal,
        });

        if (res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const data = JSON.parse(line.slice(6));
                if (data.error) continue;
                if (data.isPartial) {
                  setPartialText(data.text);
                } else if (data.text) {
                  setTranscript((prev) => prev + (prev ? " " : "") + data.text);
                  setPartialText("");
                }
              } catch {}
            }
          }
        }
      } catch {}
      sending = false;
    };

    const interval = setInterval(sendAudio, 3000);
    abort.signal.addEventListener("abort", () => clearInterval(interval));
  }, []);

  const stopListening = useCallback(() => {
    abortRef.current?.abort();
    processorRef.current?.disconnect();
    audioCtxRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    setListening(false);
  }, []);

  const sendChat = async () => {
    if (!input.trim() || chatLoading) return;
    const userMsg: Message = { role: "user", content: input };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated, transcript: transcriptRef.current }),
      });
      const data = await res.json();
      setMessages([...updated, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages([...updated, { role: "assistant", content: "Error: Failed to get response." }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="flex h-screen">
      {/* Left: Live Transcript */}
      <div className="w-1/2 flex flex-col border-r border-gray-800">
        <header className="p-4 border-b border-gray-800 bg-gray-900 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">🎙️ Meeting Assistant</h1>
            <p className="text-xs text-gray-400">Live transcription powered by AWS Transcribe</p>
          </div>
          <button
            onClick={listening ? stopListening : startListening}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              listening
                ? "bg-red-600 hover:bg-red-700 animate-pulse"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {listening ? "⏹ Stop Listening" : "🎤 Start Listening"}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {!transcript && !partialText && (
            <p className="text-gray-500 text-center mt-20">
              Click &quot;Start Listening&quot; to begin capturing audio from your microphone.
            </p>
          )}
          {transcript && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{transcript}</p>
          )}
          {partialText && (
            <span className="text-sm text-gray-400 italic"> {partialText}</span>
          )}
        </div>

        {transcript && (
          <div className="border-t border-gray-800 p-3 bg-gray-900 text-xs text-gray-400">
            {transcript.split(" ").length} words transcribed
          </div>
        )}
      </div>

      {/* Right: Chat */}
      <div className="w-1/2 flex flex-col">
        <header className="p-4 border-b border-gray-800 bg-gray-900">
          <h2 className="font-semibold">💬 Chat with Assistant</h2>
          <p className="text-xs text-gray-400">Ask about the conversation — Claude has full transcript context</p>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-gray-500 text-center mt-20 text-sm">
              Ask questions about the meeting, request summaries, or get action items...
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] p-3 rounded-lg text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-blue-600" : "bg-gray-800"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-800 p-3 rounded-lg text-sm animate-pulse">Thinking...</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); sendChat(); }} className="border-t border-gray-800 p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the meeting..."
            className="flex-1 bg-gray-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={chatLoading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
