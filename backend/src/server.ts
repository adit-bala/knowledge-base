import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  Runner,
  withTrace,
  GuardrailExecutionError,
  InputGuardrailTripwireTriggered,
  MaxTurnsExceededError,
} from '@openai/agents';
import {drizzle} from 'drizzle-orm/node-postgres';
import {article} from './schema/article.js';
import {embedding} from './schema/embedding.js';
import {Pool} from 'pg';
import {
  createKnowledgeAgent,
  relevanceGuardrail,
  initializeArticleContentCacheWithLog,
  getSystemPrompt,
} from './agents/index.js';
import * as dotenv from 'dotenv';
dotenv.config({override: true});
import {logger} from './logger.js';
import 'pgvector/pg';
import {rateLimiter} from './rate-limiter.js';

const pool = new Pool({connectionString: process.env.DATABASE_URL!});
const db = drizzle(pool, {schema: {article, embedding}});

// Initialise Fastify with our pino logger instance
const app = Fastify({logger});
logger.info('Fastify server created');

// Register CORS plugin
void app.register(cors, {
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET'],
});
logger.info('CORS plugin registered');

// Use the logger-enabled relevanceGuardrail for runner
const runner = new Runner({
  model: 'gpt-4o-mini',
  inputGuardrails: [relevanceGuardrail(logger)],
  workflowName: 'aditya-knowledge-base',
  traceMetadata: {
    application: 'aditya-personal-website',
    version: '1.0.0',
  },
});

app.post('/ask', async (request, reply) => {
  logger.info('Received /ask request', request.body);

  // Check rate limit before processing
  const rateLimitCheck = rateLimiter.checkLimit();
  if (!rateLimitCheck.allowed) {
    logger.warn('Rate limit exceeded', rateLimitCheck);
    await reply.send({
      error: 'Rate limit exceeded',
      details:
        'Aditya is too broke to provide more LLM calls, please try again tomorrow.',
      resetTime: rateLimitCheck.resetTime,
    });
    return;
  }

  const {question} = request.body as {question?: string};
  if (!question) {
    logger.error('Missing question in request body');
    await reply.status(400).send({error: "Missing 'question' in request body"});
    return;
  }

  try {
    // Ensure cache is initialized and get system prompt
    await initializeArticleContentCacheWithLog(db, logger);
    const systemPrompt = getSystemPrompt();

    const result = await withTrace(
      'knowledge-base-query',
      async () => {
        logger.debug(
          'Calling runner.run with streaming for question:',
          question,
        );

        // Use streaming to get visibility into model steps and tool usage
        const stream = await runner.run(
          createKnowledgeAgent(db, logger, systemPrompt, question),
          question,
          {stream: true, maxTurns: 5},
        );

        // Log meaningful streaming events for visibility
        for await (const event of stream) {
          switch (event.type) {
            /* 1. Low-level model deltas — usually noise unless you're debugging token flow */
            case 'raw_model_stream_event':
              // comment out if you want token deltas
              continue;

            /* 2. Agent hand-offs / role switches */
            case 'agent_updated_stream_event':
              logger.info(`↔︎ Agent changed to ${event.agent.name}`);
              break;

            /* 3. High-level run items (tool calls, tool results, assistant text, etc.) */
            case 'run_item_stream_event': {
              const {item} = event;
              switch (item.type) {
                case 'tool_call_item': {
                  const rawItem = item.rawItem as any;
                  const {name, arguments: args, id} = rawItem || {};
                  logger.info({tool: name, args}, `🔧  Tool call [${id}]`);
                  break;
                }
                case 'tool_call_output_item': {
                  const rawItem = item.rawItem as any;
                  const {id} = rawItem || {};
                  logger.info(
                    {toolCallId: id, output: item.output},
                    '⚙️ Tool output',
                  );
                  break;
                }
                case 'message_output_item': {
                  const text =
                    (item as any).message ??
                    (item as any).output ??
                    JSON.stringify(item);
                  logger.info(`💬 Assistant: ${text}`);
                  break;
                }
                default: {
                  logger.debug(
                    `(skipping unrecognised run item: ${(item as any).type})`,
                  );
                }
              }
              break;
            }

            /* 4. Anything new we haven't accounted for yet */
            default:
              logger.debug('(skipping unhandled event)');
          }
        }

        // Wait for completion and get final result
        await stream.completed;
        return stream;
      },
      {
        metadata: {
          question,
          timestamp: new Date().toISOString(),
        },
      },
    );

    // Increment usage after successful processing
    rateLimiter.incrementUsage();

    logger.info('Sending final answer:', result.finalOutput);
    await reply.send({answer: result.finalOutput});
  } catch (err) {
    logger.error('Failed to answer question', err);
    app.log.error(err, 'Failed to answer question');
    if (
      err instanceof InputGuardrailTripwireTriggered ||
      err instanceof GuardrailExecutionError
    ) {
      await reply.status(400).send({
        error: 'Question not relevant to Aditya or this personal website',
        details:
          'Please ask questions related to Aditya, his background, work, or the content of this website.',
      });
    } else if (err instanceof MaxTurnsExceededError) {
      await reply.status(500).send({
        error: 'Question too complex',
        details:
          'The question is too complex and requires more turns to answer. Please try again with a simpler question.',
      });
    } else {
      await reply.status(500).send({
        error: 'Internal Server Error',
        details: 'An unexpected error occurred. Please try again later.',
      });
    }
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app
  .listen({port, host: '0.0.0.0'})
  .then(addr => logger.info(`Server listening on ${addr}`))
  .catch(err => {
    logger.error('Server failed to start', err);
    app.log.error(err);
    throw err;
  });

// Clean signal handling
function handleSignal(signal: string) {
  logger.info(`${signal} received, closing server`);
  void app.close();
}
process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
