import { z } from 'zod';

// ─── Durable capture protocol (capture program, Gate A) ─────────────────────
//
// A capture is stored and acknowledged BEFORE any transcription or model
// inference. Every write is a command envelope with a client-generated
// operation_id; the server memoises the terminal result under
// (data_space_id, operation_id) so a retry after a lost response replays the
// original outcome instead of creating a second capture.
//
// Cross-language contract: the JSON fixtures in
// packages/shared/fixtures/durable-capture/ are parsed by these schemas (TS)
// and by the Hermes capture plugin's tests (Python). Change both together.

export const CAPTURE_PROTOCOL_VERSION = 1 as const;

// ─── Credential scopes ────────────────────────────────────────────────────
// A capture_client token (api_tokens.permission_profile) is default-denied on
// every route that does not declare one of these scopes.
export const CAPTURE_CLIENT_SCOPES = ['capture:write', 'capture:read'] as const;
export const CaptureClientScopeSchema = z.enum(CAPTURE_CLIENT_SCOPES);
export type CaptureClientScope = z.infer<typeof CaptureClientScopeSchema>;

// ─── State vocabularies ───────────────────────────────────────────────────
export const CAPTURE_PROCESSING_STATES = [
  'awaiting_media', 'queued', 'preprocessing', 'ready_for_hermes', 'interpreting',
  'needs_review', 'committed', 'retry_wait', 'blocked', 'cancelled',
] as const;
export const CaptureProcessingStateSchema = z.enum(CAPTURE_PROCESSING_STATES);
export type CaptureProcessingState = z.infer<typeof CaptureProcessingStateSchema>;

// Historical captured_data rows that predate receipts are listed with the
// display-only state 'legacy'. It is never stored in capture_receipts.
export const CaptureListStateSchema = z.enum([...CAPTURE_PROCESSING_STATES, 'legacy']);
export type CaptureListState = z.infer<typeof CaptureListStateSchema>;

export const CaptureStorageStateSchema = z.enum(['complete', 'awaiting_media']);
export type CaptureStorageState = z.infer<typeof CaptureStorageStateSchema>;
export const CaptureMediaStateSchema = z.enum(['reserved', 'verified']);
export type CaptureMediaState = z.infer<typeof CaptureMediaStateSchema>;
export const CaptureAttemptStageSchema = z.enum(['pending', 'transcribing', 'parsing', 'executing', 'recording', 'finished']);
export type CaptureAttemptStage = z.infer<typeof CaptureAttemptStageSchema>;

export const CaptureKindSchema = z.enum(['text', 'audio', 'image']);
export type CaptureKind = z.infer<typeof CaptureKindSchema>;
// Intent is what the user meant by submitting; modality is how the input
// arrived. A conversation_turn is journaled, never auto-executed.
export const CaptureIntentSchema = z.enum(['capture_only', 'conversation_turn']);
export type CaptureIntent = z.infer<typeof CaptureIntentSchema>;
export const CaptureModalitySchema = z.enum(['typed', 'spoken', 'photo']);
export type CaptureModality = z.infer<typeof CaptureModalitySchema>;

export const CaptureReceiptKindSchema = z.enum(['server_saved', 'awaiting_media']);
export type CaptureReceiptKind = z.infer<typeof CaptureReceiptKindSchema>;

export const CAPTURE_ERROR_CODES = [
  // interpretation pre-checks / infrastructure
  'llm_not_configured', 'stt_not_configured', 'endpoint_not_approved',
  'llm_unavailable', 'stt_unavailable', 'stt_failed', 'parser_failed',
  // execution outcomes that need a human
  'partial_execution', 'external_effect_requires_review', 'execution_uncertain',
  // unsupported for now
  'image_processing_unavailable',
] as const;
export const CaptureErrorCodeSchema = z.enum(CAPTURE_ERROR_CODES);
export type CaptureErrorCode = z.infer<typeof CaptureErrorCodeSchema>;

// ─── Media ────────────────────────────────────────────────────────────────
export const CAPTURE_MEDIA_TYPES = [
  'audio/webm', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/ogg',
  'image/jpeg', 'image/png', 'image/webp',
] as const;
export const CaptureMediaTypeSchema = z.enum(CAPTURE_MEDIA_TYPES);
export type CaptureMediaType = z.infer<typeof CaptureMediaTypeSchema>;
// Matches the API's existing multipart limit (25 MiB). V1 uploads are
// whole-file and idempotent; resumable transfer is advertised as unsupported.
export const CAPTURE_MEDIA_MAX_BYTES = 26_214_400;
export const CAPTURE_TEXT_MAX_CHARS = 20_000;
export const CAPTURE_MAX_ATTACHMENTS = 4;

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex characters.');

export const CaptureAttachmentReservationSchema = z.object({
  attachment_id: z.string().uuid(),
  media_type: CaptureMediaTypeSchema,
  size_bytes: z.number().int().min(1).max(CAPTURE_MEDIA_MAX_BYTES),
  sha256: Sha256Hex,
}).strict();
export type CaptureAttachmentReservation = z.infer<typeof CaptureAttachmentReservationSchema>;

// ─── Client provenance ────────────────────────────────────────────────────
// Recorded verbatim on the receipt. device_id is advisory in Gate B (no
// device registry yet); actor and data-space always come from the server.
export const CaptureClientSchema = z.object({
  name: z.enum(['web', 'hermes', 'ios', 'ingest', 'other']),
  version: z.string().max(40).optional(),
  device_id: z.string().max(120).optional(),
  surface: z.string().max(40).optional(),
}).strict();
export type CaptureClient = z.infer<typeof CaptureClientSchema>;

// ─── Command payloads ─────────────────────────────────────────────────────
export const CaptureCreatePayloadSchema = z.object({
  capture_id: z.string().uuid(),
  kind: CaptureKindSchema,
  intent: CaptureIntentSchema.default('capture_only'),
  modality: CaptureModalitySchema.optional(),
  text: z.string().min(1).max(CAPTURE_TEXT_MAX_CHARS).optional(),
  captured_at: z.string().datetime({ offset: true }),
  time_zone: z.string().min(1).max(64).optional(),
  client: CaptureClientSchema,
  source_item_id: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(64)).max(16).optional(),
  attachments: z.array(CaptureAttachmentReservationSchema).max(CAPTURE_MAX_ATTACHMENTS).optional(),
}).strict().superRefine((value, ctx) => {
  const attachments = value.attachments ?? [];
  if (value.kind === 'text') {
    if (!value.text) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'A text capture needs text.' });
    if (attachments.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachments'], message: 'A text capture carries no attachments.' });
  } else if (attachments.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachments'], message: `A ${value.kind} capture needs at least one attachment reservation.` });
  }
  const ids = new Set(attachments.map((a) => a.attachment_id));
  if (ids.size !== attachments.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachments'], message: 'attachment_id values must be unique.' });
  if (value.modality === 'typed' && value.kind !== 'text') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modality'], message: 'typed modality applies to text captures only.' });
  if (value.modality === 'spoken' && value.kind !== 'audio') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modality'], message: 'spoken modality applies to audio captures only.' });
  if (value.modality === 'photo' && value.kind !== 'image') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modality'], message: 'photo modality applies to image captures only.' });
});
export type CaptureCreatePayload = z.infer<typeof CaptureCreatePayloadSchema>;

export const CaptureFinalizePayloadSchema = z.object({ capture_id: z.string().uuid() }).strict();
export type CaptureFinalizePayload = z.infer<typeof CaptureFinalizePayloadSchema>;

// Explicit retry is new intent: a new operation_id for the same capture. The
// expected attempt number prevents two clients from both retrying at once.
export const CaptureRetryPayloadSchema = z.object({
  capture_id: z.string().uuid(),
  expected_attempt_no: z.number().int().min(0),
}).strict();
export type CaptureRetryPayload = z.infer<typeof CaptureRetryPayloadSchema>;

export const CAPTURE_COMMANDS = ['capture.create', 'capture.finalize', 'capture.retry_interpretation'] as const;
export const CaptureCommandNameSchema = z.enum(CAPTURE_COMMANDS);
export type CaptureCommandName = z.infer<typeof CaptureCommandNameSchema>;

const envelopeBase = {
  protocol_version: z.literal(CAPTURE_PROTOCOL_VERSION),
  operation_id: z.string().uuid(),
};
export const CaptureCreateEnvelopeSchema = z.object({ ...envelopeBase, command: z.literal('capture.create'), payload: CaptureCreatePayloadSchema }).strict();
export const CaptureFinalizeEnvelopeSchema = z.object({ ...envelopeBase, command: z.literal('capture.finalize'), payload: CaptureFinalizePayloadSchema }).strict();
export const CaptureRetryEnvelopeSchema = z.object({ ...envelopeBase, command: z.literal('capture.retry_interpretation'), payload: CaptureRetryPayloadSchema }).strict();
export const CaptureCommandEnvelopeSchema = z.discriminatedUnion('command', [
  CaptureCreateEnvelopeSchema, CaptureFinalizeEnvelopeSchema, CaptureRetryEnvelopeSchema,
]);
export type CaptureCreateEnvelope = z.infer<typeof CaptureCreateEnvelopeSchema>;
export type CaptureFinalizeEnvelope = z.infer<typeof CaptureFinalizeEnvelopeSchema>;
export type CaptureRetryEnvelope = z.infer<typeof CaptureRetryEnvelopeSchema>;
export type CaptureCommandEnvelope = z.infer<typeof CaptureCommandEnvelopeSchema>;

// ─── Receipts and read models ─────────────────────────────────────────────
export const CaptureUploadSlotSchema = z.object({
  attachment_id: z.string().uuid(),
  put_url: z.string().min(1),
  max_bytes: z.number().int().positive(),
  resumable: z.literal(false),
}).strict();

// server_saved means the server holds the complete raw content and a durable
// processing record. awaiting_media means only the envelope and reservations
// exist; the client must not describe that as saved to Jevi Ops.
export const CaptureReceiptSchema = z.object({
  capture_id: z.string().uuid(),
  operation_id: z.string().uuid(),
  data_space_id: z.string().uuid(),
  server_epoch: z.number().int().positive(),
  receipt_kind: CaptureReceiptKindSchema,
  storage_state: CaptureStorageStateSchema,
  processing_state: CaptureProcessingStateSchema,
  created_at: z.string().datetime({ offset: true }),
  uploads: z.array(CaptureUploadSlotSchema),
}).strict();
export type CaptureReceipt = z.infer<typeof CaptureReceiptSchema>;

export const CaptureReceiptResponseSchema = z.object({ receipt: CaptureReceiptSchema, replayed: z.boolean() }).strict();
export type CaptureReceiptResponse = z.infer<typeof CaptureReceiptResponseSchema>;

export const OperationDispositionSchema = z.enum(['applied', 'conflict', 'rejected']);
export type OperationDisposition = z.infer<typeof OperationDispositionSchema>;

export const OperationReceiptSchema = z.object({
  operation_id: z.string().uuid(),
  data_space_id: z.string().uuid(),
  server_epoch: z.number().int().positive(),
  protocol_version: z.number().int().positive(),
  command: z.string().min(1),
  disposition: OperationDispositionSchema,
  status: z.number().int().min(200).max(599),
  resource_ref: z.string().nullable(),
  result: z.unknown(),
  created_at: z.string().datetime({ offset: true }),
}).strict();
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;

export const CaptureMediaStatusSchema = z.object({
  attachment_id: z.string().uuid(),
  media_type: CaptureMediaTypeSchema,
  size_bytes: z.number().int().positive(),
  state: CaptureMediaStateSchema,
  verified_at: z.string().nullable(),
}).strict();
export type CaptureMediaStatus = z.infer<typeof CaptureMediaStatusSchema>;

export const CaptureAttemptSummarySchema = z.object({
  attempt_no: z.number().int().positive(),
  stage: CaptureAttemptStageSchema,
  error_code: CaptureErrorCodeSchema.nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
}).strict();

export const CaptureDetailSchema = z.object({
  capture_id: z.string().uuid(),
  operation_id: z.string().uuid().nullable(),
  data_space_id: z.string().uuid().nullable(),
  kind: CaptureKindSchema.nullable(),
  intent: CaptureIntentSchema.nullable(),
  modality: CaptureModalitySchema.nullable(),
  text: z.string().nullable(),
  client: CaptureClientSchema.nullable(),
  source_item_id: z.string().nullable(),
  tags: z.array(z.string()),
  captured_at: z.string().nullable(),
  storage_state: CaptureStorageStateSchema.nullable(),
  processing_state: CaptureListStateSchema,
  error_code: CaptureErrorCodeSchema.nullable(),
  outcome: z.unknown().nullable(),
  media: z.array(CaptureMediaStatusSchema),
  current_attempt_no: z.number().int().min(0),
  retry_permitted: z.boolean(),
  attempts: z.array(CaptureAttemptSummarySchema),
  created_at: z.string(),
  updated_at: z.string().nullable(),
}).strict();
export type CaptureDetail = z.infer<typeof CaptureDetailSchema>;

export const CaptureListQuerySchema = z.object({
  state: z.string().optional()
    .transform((s) => (s ? s.split(',').map((t) => t.trim()).filter(Boolean) : undefined))
    .pipe(z.array(CaptureListStateSchema).min(1).max(CAPTURE_PROCESSING_STATES.length + 1).optional()),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type CaptureListQuery = z.infer<typeof CaptureListQuerySchema>;

export const InterpretResponseSchema = z.object({
  capture_id: z.string().uuid(),
  attempt_no: z.number().int().min(0),
  processing_state: CaptureProcessingStateSchema,
  outcome: z.unknown().nullable(),
  error_code: CaptureErrorCodeSchema.nullable(),
  replayed: z.boolean(),
}).strict();
export type InterpretResponse = z.infer<typeof InterpretResponseSchema>;
