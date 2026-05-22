import type { FastifyPluginAsync } from 'fastify';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { anthropic, anthropicModel, isAnthropicConfigured } from '../lib/anthropic.js';
import { toolDefsForAnthropic, runTool } from '../lib/chat-tools.js';

// POST /api/chat — natural-language query against the DB (spec §11).
//
// Claude is given the user's question and a tool surface (search_tasks,
// search_notes, etc.). It picks which tools to call, we run them against
// the user's Supabase client (RLS applies), feed results back, and Claude
// composes a final natural-language answer. We cap the loop at 8 turns to
// prevent runaway agentic behavior.

const ChatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
});

const SYSTEM_PROMPT = `You are Jerad's personal-operations assistant. You answer questions about \
his work, projects, tasks, notes, quotes, and calendar by querying the database via the tools \
provided.

Behavior rules:
1. Use tools to look up real data. Never fabricate dates, projects, hours, or quote text.
2. When the user asks about a project, use get_project_summary with the closest matching name.
3. When the user asks "what did I work on", use search_tasks (status=done) and/or get_recent_events.
4. Be concise. Default to 1-3 sentence answers plus a bulleted list if it improves clarity.
5. Mountain Time is the user's timezone. Dates from the DB are UTC; format them naturally (e.g. "Tuesday").
6. If a tool returns 0 results, say so honestly. Don't invent.
7. Don't return raw JSON. Summarize the data in plain English.
8. If you can't answer with the available tools, say what's missing.`;

type ContentBlock = Anthropic.ContentBlock;
type ToolUseBlock = Anthropic.ToolUseBlock;
type MessageParam = Anthropic.MessageParam;

interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  result_summary: string;
}

const MAX_TURNS = 8;

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  app.post('/api/chat', async (req, reply) => {
    if (!isAnthropicConfigured()) {
      return reply.code(503).send({ error: 'anthropic_not_configured' });
    }
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const sb = req.supabase!;
    const tools = toolDefsForAnthropic();
    const trace: ToolTrace[] = [];

    const messages: MessageParam[] = [
      { role: 'user', content: parsed.data.question },
    ];

    let turns = 0;
    let finalAnswer = '';

    while (turns < MAX_TURNS) {
      turns += 1;

      const response: Anthropic.Message = await anthropic().messages.create({
        model: anthropicModel(),
        max_tokens: 2048,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools,
        messages,
      } as Anthropic.MessageCreateParamsNonStreaming);

      // Echo the assistant turn back into the history.
      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use',
      );

      if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
        // Final answer — collect text blocks.
        finalAnswer = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        break;
      }

      // Run each tool and feed results back as a user turn.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        let result: unknown;
        let isError = false;
        try {
          result = await runTool(use.name, (use.input ?? {}) as Record<string, unknown>, sb);
        } catch (err) {
          isError = true;
          result = { error: err instanceof Error ? err.message : 'unknown_error' };
        }
        // Compress the result into a string Claude can consume.
        const resultStr = JSON.stringify(result);
        trace.push({
          name: use.name,
          input: (use.input ?? {}) as Record<string, unknown>,
          result_summary:
            resultStr.length > 200 ? resultStr.slice(0, 200) + '… (truncated)' : resultStr,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: resultStr,
          is_error: isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    if (!finalAnswer) {
      finalAnswer = 'I ran out of attempts before reaching a final answer. Try rephrasing the question?';
    }

    req.log.info(
      { user_id: req.user!.id, turns, tools_used: trace.length, question_chars: parsed.data.question.length },
      'chat answered',
    );

    return reply.code(200).send({
      question: parsed.data.question,
      answer: finalAnswer,
      tool_trace: trace,
      turns,
    });
  });
};
