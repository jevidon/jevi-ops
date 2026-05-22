'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { askAction, transcribeAudioAction, type AskResult } from './actions';

interface Turn {
  id: string;
  question: string;
  state: 'asking' | { ok: true; answer: string; tools: { name: string; input: Record<string, unknown> }[] } | { ok: false; error: string };
}

// Structural Web Speech-style type — only used for MediaRecorder here.
type SR = MediaRecorder;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

export function ChatThread() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, startTransition] = useTransition();

  // Voice
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<SR | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom whenever the thread grows.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const submit = useCallback(() => {
    const question = input.trim();
    if (!question || pending) return;
    const id = crypto.randomUUID();

    // Build the history we'll send from the closure-captured `turns`
    // (NOT from inside a setState updater — startTransition can't be
    // called during render). Every prior successful turn contributes a
    // Q+A pair; failed and pending turns are skipped.
    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const t of turns) {
      if (typeof t.state === 'object' && t.state.ok === true) {
        history.push({ role: 'user', content: t.question });
        history.push({ role: 'assistant', content: t.state.answer });
      }
    }
    history.push({ role: 'user', content: question });

    setTurns((prev) => [...prev, { id, question, state: 'asking' }]);
    setInput('');
    inputRef.current?.focus();

    startTransition(async () => {
      const result: AskResult = await askAction(history);
      setTurns((cur) =>
        cur.map((t) =>
          t.id === id
            ? {
                ...t,
                state: result.ok
                  ? {
                      ok: true,
                      answer: result.response.answer,
                      tools: result.response.tool_trace.map((tr) => ({
                        name: tr.name,
                        input: tr.input,
                      })),
                    }
                  : { ok: false, error: result.error },
              }
            : t,
        ),
      );
    });
  }, [input, pending, turns]);

  const resetThread = useCallback(() => {
    if (pending) return;
    setTurns([]);
    setInput('');
    inputRef.current?.focus();
  }, [pending]);

  // ─── Voice ────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    const mime = pickMimeType();
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' });
      chunksRef.current = [];
      if (blob.size === 0) return;
      setTranscribing(true);
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      const result = await transcribeAudioAction(fd);
      setTranscribing(false);
      if (result.ok && result.transcript) {
        setInput((cur) => (cur ? cur.trim() + ' ' + result.transcript : result.transcript));
        inputRef.current?.focus();
      }
    };
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start(1000);
    setRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state !== 'inactive') r.stop();
    setRecording(false);
  }, []);

  // Submit on ⌘/Ctrl+Enter
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="px-5 lg:px-0 pt-4 flex flex-col gap-4">
      {/* Input */}
      <div className="flex items-end gap-2 border border-line bg-surface focus-within:border-ink-2 transition-colors">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder='Ask anything. "What did I work on last week?" or "Show every note tagged stewardship."'
          disabled={pending}
          className="flex-1 bg-transparent p-3 font-sans text-[14px] text-ink resize-none focus:outline-none placeholder:text-ink-3/70"
        />
        <div className="flex flex-col items-center gap-1 p-2">
          <button
            type="button"
            aria-label={recording ? 'Stop recording' : 'Voice input'}
            disabled={pending || transcribing}
            onClick={recording ? stopRecording : startRecording}
            className={`flex h-9 w-9 items-center justify-center transition-colors ${
              recording ? 'bg-accent text-bg' : 'bg-transparent text-ink-3 hover:text-ink-2'
            } disabled:opacity-30`}
          >
            <MicIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !input.trim()}
            className="px-3 py-2 bg-ink hover:bg-ink-2 disabled:opacity-30 text-bg font-sans font-semibold text-[12px] uppercase tracking-wider transition-colors"
          >
            {pending ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 min-h-[1rem]">
        {transcribing ? (
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Transcribing…
          </div>
        ) : (
          <span aria-hidden />
        )}
        {turns.length > 0 && (
          <button
            type="button"
            onClick={resetThread}
            disabled={pending}
            className="font-mono text-[10px] uppercase tracking-wider text-ink-3 hover:text-accent disabled:opacity-40 transition-colors"
          >
            New conversation
          </button>
        )}
      </div>

      {/* Hint when empty */}
      {turns.length === 0 && (
        <div className="font-sans text-[13px] text-ink-3 leading-relaxed mt-2">
          Examples:
          <ul className="mt-1 list-disc list-inside font-sans text-[13px] text-ink-2">
            <li>What did I work on last week?</li>
            <li>How many open tasks are in Site Nitro?</li>
            <li>Show notes tagged stewardship.</li>
            <li>What&apos;s on my calendar today?</li>
          </ul>
        </div>
      )}

      {/* Thread */}
      <div className="flex flex-col gap-6 mt-4">
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <div>
      {/* Question */}
      <div className="flex gap-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-12 pt-1 shrink-0">
          You
        </div>
        <div className="font-sans text-[14px] text-ink leading-snug whitespace-pre-wrap">
          {turn.question}
        </div>
      </div>

      {/* Answer */}
      <div className="flex gap-3 mt-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3 w-12 pt-1 shrink-0">
          Claude
        </div>
        <div className="flex-1 min-w-0">
          {turn.state === 'asking' && (
            <div className="font-sans text-[13px] text-ink-3 italic">Thinking…</div>
          )}
          {typeof turn.state === 'object' && turn.state.ok === false && (
            <div className="font-sans text-[13px] text-accent">Error: {turn.state.error}</div>
          )}
          {typeof turn.state === 'object' && turn.state.ok === true && (
            <>
              <div className="font-sans text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
                {turn.state.answer}
              </div>
              {turn.state.tools.length > 0 && (
                <details className="mt-2">
                  <summary className="font-mono text-[10px] uppercase tracking-wider text-ink-3 cursor-pointer list-none hover:text-ink-2">
                    {turn.state.tools.length} tool {turn.state.tools.length === 1 ? 'call' : 'calls'} ▾
                  </summary>
                  <ul className="mt-1 font-mono text-[10px] text-ink-3 leading-relaxed">
                    {turn.state.tools.map((tool, i) => (
                      <li key={i}>
                        {tool.name}({JSON.stringify(tool.input)})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
