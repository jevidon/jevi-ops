import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { chatComplete, isLlmConfigured, type LlmMessage } from '../lib/llm.js';
import { toolDefs, runTool } from '../lib/chat-tools.js';
import { getDb } from '../lib/db.js';

// POST /api/chat — natural-language query against the DB (spec §11).
//
// The model is given the user's question and a tool surface (search_tasks,
// search_notes, etc.). It picks which tools to call, we run them against
// the database, feed results back, and the model composes a final
// natural-language answer. We cap the loop at 8 turns to prevent runaway
// agentic behavior. Provider-neutral — runs on the local OpenAI-compatible
// server or the Anthropic fallback identically (lib/llm.ts).

// Two accepted shapes:
//   { question: "..." }                       — single-turn (back-compat)
//   { messages: [{role, content}, ...] }      — multi-turn, last entry must be a user msg
// We cap the history at MAX_HISTORY turns to keep tokens bounded; older
// messages get dropped silently.
const SingleTurnSchema = z.object({
  question: z.string().trim().min(1).max(2000),
});
const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});
const MultiTurnSchema = z.object({
  messages: z.array(HistoryMessageSchema).min(1).max(40),
});
const ChatRequestSchema = z.union([SingleTurnSchema, MultiTurnSchema]);

const MAX_HISTORY = 20;

const SYSTEM_PROMPT = `You are Jevidon's personal-operations assistant. You answer questions about \
his work, projects, tasks, notes, quotes, annotations, and calendar by querying the database \
via the tools provided.

Behavior rules:
1. Use tools to look up real data. Never fabricate dates, projects, hours, or quote text.
2. When the user asks about a project, use get_project_summary with the closest matching name.
3. When the user asks "what did I work on", use search_tasks (status=done) and/or get_recent_events.
4. Notes vs annotations vs quotes — pick the right tool:
   - search_notes: free-floating thoughts (own thought, reading response, meeting note, brainstorm).
   - search_annotations: dated thoughts the user attached TO a specific quote.
   - search_quotes: the verbatim text of saved quotes, with annotation counts.
   When a question is broad ("what have I thought about stewardship"), call multiple tools.
5. Attribute sources naturally in your answer:
   - "In a reading response from March 14 you wrote..."
   - "You annotated a Cal Newport quote in October with..."
   - "Your quote from Stewardship by Peter Block says..."
6. Be concise. Default to 1-3 sentence answers plus a bulleted list if it improves clarity.
7. Mountain Time is the user's timezone. Dates from the DB are UTC; format them naturally (e.g. "Tuesday").
8. If a tool returns 0 results, say so honestly. Don't invent.
9. Don't return raw JSON. Summarize the data in plain English.
10. If you can't answer with the available tools, say what's missing.`;

interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  result_summary: string;
}

const MAX_TURNS = 8;

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/chat', async (req, reply) => {
    if (!(await isLlmConfigured())) {
      return reply.code(503).send({ error: 'llm_not_configured' });
    }
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const tools = toolDefs();
    const trace: ToolTrace[] = [];

    // Normalize either shape into the same message list starting point.
    // For multi-turn we trim oldest messages first but always keep the
    // most recent user message (the one the model is meant to answer).
    let messages: LlmMessage[];
    let question: string;
    if ('question' in parsed.data) {
      messages = [{ role: 'user', content: parsed.data.question }];
      question = parsed.data.question;
    } else {
      const history = parsed.data.messages;
      const lastIn = history[history.length - 1];
      if (!lastIn || lastIn.role !== 'user') {
        return reply.code(400).send({
          error: 'invalid_payload',
          details: { messages: ['last message must be from user'] },
        });
      }
      const trimmed = history.slice(-MAX_HISTORY);
      messages = trimmed.map((m) => ({ role: m.role, content: m.content }));
      // Safe: trimmed has at least one entry because history did.
      question = trimmed[trimmed.length - 1]!.content;
    }

    let turns = 0;
    let finalAnswer = '';

    while (turns < MAX_TURNS) {
      turns += 1;

      const response = await chatComplete({
        system: SYSTEM_PROMPT,
        messages,
        tools,
        maxTokens: 2048,
        effort: 'medium',
      });

      if (response.toolCalls.length === 0) {
        finalAnswer = response.text;
        break;
      }

      // Echo the assistant turn (with its tool calls) back into history,
      // run each tool, and append the results.
      messages.push({ role: 'assistant', content: response.text || null, toolCalls: response.toolCalls });

      for (const call of response.toolCalls) {
        let result: unknown;
        try {
          result = await runTool(call.name, call.args, db);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : 'unknown_error' };
        }
        // Compress the result into a string the model can consume.
        const resultStr = JSON.stringify(result);
        trace.push({
          name: call.name,
          input: call.args,
          result_summary:
            resultStr.length > 200 ? resultStr.slice(0, 200) + '… (truncated)' : resultStr,
        });
        messages.push({ role: 'tool', toolCallId: call.id, content: resultStr });
      }
    }

    if (!finalAnswer) {
      finalAnswer = 'I ran out of attempts before reaching a final answer. Try rephrasing the question?';
    }

    req.log.info(
      {
        user_id: req.user!.id,
        turns,
        tools_used: trace.length,
        question_chars: question.length,
        history_msgs: messages.length,
      },
      'chat answered',
    );

    return reply.code(200).send({
      question,
      answer: finalAnswer,
      tool_trace: trace,
      turns,
    });
  });
};
