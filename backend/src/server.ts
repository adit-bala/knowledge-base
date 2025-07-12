import Fastify from 'fastify';
import {
  Runner,
  withTrace,
  GuardrailExecutionError,
  InputGuardrailTripwireTriggered,
} from '@openai/agents';
import {drizzle} from 'drizzle-orm/node-postgres';
import {article} from './schema/article.js';
import {embedding} from './schema/embedding.js';
import {
  createKnowledgeAgent,
  relevanceGuardrail,
  initializeArticleContentCacheWithLog,
  getSystemPrompt,
} from './agents/index.js';
import 'dotenv/config';
import {logger} from './logger.js';
import {sql} from 'drizzle-orm';

const db = drizzle(process.env.DATABASE_URL!, {schema: {article, embedding}});

// Test RLS protection with destructive query
async function testRLSProtection() {
  logger.info('Testing RLS protection...');
  try {
    // First, try to insert a test row to see if RLS blocks writes
    await db.execute(
      sql`INSERT INTO article (id, title, description, tags, created_at, markdown, last_edited) VALUES ('test-rls', 'test', 'test description', ARRAY['test'], NOW(), 'test content', NOW())`,
    );
    const titles = await db.select({title: sql`'test-rls'`}).from(article);
    console.log('titles:', titles);
    logger.error('❌ RLS FAILED: INSERT query succeeded - RLS not working');

    // Clean up the test row if insert succeeded
    await db.execute(sql`DELETE FROM article WHERE id = 'test-rls'`);
  } catch (error) {
    logger.info(
      '✅ RLS WORKING: Write query blocked:',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

// Run the test
testRLSProtection().catch(err => logger.error('RLS test failed:', err));

// Initialise Fastify with our pino logger instance
const app = Fastify({logger});
logger.info('Fastify server created');

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
          createKnowledgeAgent(db, logger, systemPrompt),
          question,
          {stream: true},
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
    } else {
      await reply.status(500).send({error: 'Internal Server Error'});
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
