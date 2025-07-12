import {Agent, InputGuardrail, run} from '@openai/agents';
import {z} from 'zod';

// Create a guardrail agent to check if questions are relevant to Aditya
export const relevanceCheckAgent = new Agent({
  name: 'relevance-checker',
  instructions: `You are a relevance checker for a personal website about Aditya. 
  
  Determine if the user's question is relevant to Aditya or appropriate for a personal website context.
  
  Questions that ARE relevant:
  - About Aditya's background, experience, skills, education
  - About Aditya's work, projects, achievements
  - About Aditya's contact information, location, availability
  - About Aditya's blog posts, articles, or content
  - General questions about Aditya as a person
  - Questions about the website itself or its content
  
  Questions that are NOT relevant:
  - Personal questions about other people
  - Questions about unrelated topics (politics, sports, etc.)
  - Requests for services not related to Aditya
  - Inappropriate or offensive content
  - Questions about other companies or individuals
  
  Be strict but fair. If in doubt, err on the side of allowing the question.`,
  outputType: z.object({
    isRelevant: z
      .boolean()
      .describe(
        'Whether the question is relevant to Aditya or the personal website',
      ),
    reasoning: z
      .string()
      .describe('Brief explanation of why the question is or is not relevant'),
  }),
});

// Input guardrail to check question relevance
export function relevanceGuardrail(
  logger: {
    info: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
  } = console,
): InputGuardrail {
  return {
    name: 'Aditya Relevance Check',
    execute: async ({input}) => {
      logger.info('Relevance check started', {input});
      // Extract the question from the input
      let question = '';
      if (typeof input === 'string') {
        question = input;
      } else if (Array.isArray(input)) {
        const userMessage = input.find(
          item => 'role' in item && item.role === 'user',
        );
        if (userMessage && 'content' in userMessage) {
          question =
            typeof userMessage.content === 'string' ? userMessage.content : '';
        }
      }

      if (!question.trim()) {
        logger.error('Empty question provided');
        return {
          outputInfo: {isRelevant: false, reasoning: 'Empty question provided'},
          tripwireTriggered: true,
        };
      }

      try {
        const result = await run(relevanceCheckAgent, question);
        const output = result.finalOutput as {
          isRelevant: boolean;
          reasoning: string;
        };
        const {isRelevant, reasoning} = output;
        logger.info('Relevance check result', {isRelevant, reasoning});
        return {
          outputInfo: {isRelevant, reasoning},
          tripwireTriggered: !isRelevant,
        };
      } catch (error) {
        logger.error('Relevance check failed:', error);
        // If the check fails, allow the question to proceed
        return {
          outputInfo: {
            isRelevant: true,
            reasoning: 'Relevance check failed, allowing question',
          },
          tripwireTriggered: false,
        };
      }
    },
  };
}
