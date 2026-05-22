import type { z } from 'zod';
import type {
  TaskSchema,
  ProjectSchema,
  DomainSchema,
  NoteSchema,
  CapturedDataSchema,
  ParsedActionSchema,
} from './schemas/index.js';

export type Task = z.infer<typeof TaskSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Domain = z.infer<typeof DomainSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type CapturedData = z.infer<typeof CapturedDataSchema>;
export type ParsedAction = z.infer<typeof ParsedActionSchema>;

export const TAB_KEYS = ['today', 'domains', 'projects', 'content', 'people', 'library'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export const CONTENT_STATUSES = [
  'idea',
  'outline',
  'filming',
  'editing',
  'published',
  'derivatives_pending',
  'done',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const PROJECT_STATUSES = ['active', 'paused', 'done', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
