import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { VoiceCaptureRequestSchema } from '@jerad-ops/shared/schemas';
import { parseTranscript } from '../lib/parser.js';
import { executeActions } from '../lib/executor.js';
import { isAnthropicConfigured } from '../lib/anthropic.js';
import { transcribeAudio, isWhisperConfigured } from '../lib/whisper.js';

// POST /api/capture/voice         — pre-transcribed text path (Web Speech API)
// POST /api/capture/voice-audio   — multipart audio path (MediaRecorder → Whisper)
//
// Both flow into the same parser + executor pipeline. The audio path adds a
// Whisper transcription step at the front. Spec §7 + §14.

async function runPipeline(
  req: FastifyRequest,
  reply: FastifyReply,
  transcript: string,
) {
  let result;
  try {
    result = await parseTranscript(transcript, req.supabase!);
  } catch (err) {
    req.log.error({ err }, 'parser failed');
    return reply.code(502).send({
      error: 'parser_failed',
      message: err instanceof Error ? err.message : 'unknown_parser_error',
    });
  }

  if (result.kind === 'error') {
    return reply.code(422).send({
      status: 'parse_error',
      error: result.error,
      transcript: result.transcript,
    });
  }
  if (result.kind === 'disambiguation') {
    return reply.code(200).send({
      status: 'needs_disambiguation',
      field: result.field,
      candidates: result.candidates,
      transcript,
    });
  }

  const executionResults = await executeActions(req.supabase!, result.actions);
  req.log.info(
    {
      user_id: req.user!.id,
      action_count: result.actions.length,
      success_count: executionResults.filter((x) => x.status === 'success').length,
    },
    'voice actions executed',
  );

  return reply.code(200).send({
    status: 'executed',
    actions: executionResults,
    transcript,
  });
}

export const captureRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ─── Text path (still here for clients that already have a transcript) ─
  app.post('/api/capture/voice', async (req, reply) => {
    const parsed = VoiceCaptureRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    if (!isAnthropicConfigured()) {
      return reply.code(503).send({ error: 'anthropic_not_configured' });
    }
    req.log.info(
      { user_id: req.user!.id, transcript_chars: parsed.data.transcript.length },
      'voice transcript received (text path)',
    );
    return runPipeline(req, reply, parsed.data.transcript);
  });

  // ─── Audio path (MediaRecorder → multipart → Whisper → parser) ───────
  app.post('/api/capture/voice-audio', async (req, reply) => {
    if (!isAnthropicConfigured()) {
      return reply.code(503).send({ error: 'anthropic_not_configured' });
    }
    if (!isWhisperConfigured()) {
      return reply.code(503).send({
        error: 'whisper_not_configured',
        reason: 'Set OPENAI_API_KEY in .env to enable audio capture.',
      });
    }
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'expected_multipart' });
    }

    const fileData = await req.file();
    if (!fileData) {
      return reply.code(400).send({ error: 'no_file_uploaded' });
    }
    if (fileData.fieldname !== 'audio') {
      return reply.code(400).send({ error: 'expected_field_name_audio' });
    }

    const buffer = await fileData.toBuffer();
    if (buffer.length === 0) {
      return reply.code(400).send({ error: 'empty_audio' });
    }
    // Don't gate on buffer size — Opus compresses 4s of speech down to
    // ~1KB if the speaker's quiet. Let Whisper decide whether there's
    // meaningful audio; the empty_transcript branch handles it.

    const filename = fileData.filename || 'audio.webm';
    const mimeType = fileData.mimetype || 'audio/webm';

    req.log.info(
      { user_id: req.user!.id, audio_bytes: buffer.length, mime: mimeType, filename },
      'voice audio received (audio path)',
    );

    let transcript: string;
    try {
      transcript = await transcribeAudio(buffer, filename, mimeType);
    } catch (err) {
      req.log.error({ err }, 'whisper transcription failed');
      return reply.code(502).send({
        error: 'whisper_failed',
        message: err instanceof Error ? err.message : 'unknown_whisper_error',
      });
    }

    if (!transcript) {
      return reply.code(200).send({
        status: 'parse_error',
        error: 'empty_transcript',
        transcript: '',
      });
    }

    req.log.info(
      { transcript_chars: transcript.length, transcript_preview: transcript.slice(0, 200) },
      'whisper transcript',
    );
    return runPipeline(req, reply, transcript);
  });

  // Transcribe-only: same Whisper path, no parser or executor. Used by the
  // chat page so voice input fills the question field for the user to
  // review before sending.
  app.post('/api/capture/transcribe', async (req, reply) => {
    if (!isWhisperConfigured()) {
      return reply.code(503).send({ error: 'whisper_not_configured' });
    }
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'expected_multipart' });
    }
    const fileData = await req.file();
    if (!fileData) return reply.code(400).send({ error: 'no_file_uploaded' });
    if (fileData.fieldname !== 'audio') {
      return reply.code(400).send({ error: 'expected_field_name_audio' });
    }
    const buffer = await fileData.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ error: 'empty_audio' });

    try {
      const transcript = await transcribeAudio(
        buffer,
        fileData.filename || 'audio.webm',
        fileData.mimetype || 'audio/webm',
      );
      return reply.code(200).send({ transcript });
    } catch (err) {
      req.log.error({ err }, 'whisper transcription failed');
      return reply.code(502).send({
        error: 'whisper_failed',
        message: err instanceof Error ? err.message : 'unknown_whisper_error',
      });
    }
  });
};
