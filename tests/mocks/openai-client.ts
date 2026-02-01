/**
 * Mock OpenAI client for testing.
 */

export interface MockEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface MockChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    index: number;
    finish_reason: string;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate a deterministic mock embedding based on input text.
 * This ensures consistent test results.
 */
export function generateMockEmbedding(text: string): number[] {
  const embedding = new Array(384).fill(0);

  // Generate deterministic values based on text hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Fill embedding with values derived from hash
  for (let i = 0; i < 384; i++) {
    const seed = hash + i;
    embedding[i] = Math.sin(seed) * 0.5;
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(
    embedding.reduce((sum, val) => sum + val * val, 0),
  );
  return embedding.map(val => val / magnitude);
}

/**
 * Create a mock embeddings response.
 */
export function createMockEmbeddingResponse(
  inputs: string | string[],
): MockEmbeddingResponse {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];
  return {
    data: inputArray.map((text, index) => ({
      embedding: generateMockEmbedding(text),
      index,
    })),
    model: 'all-MiniLM-L6-v2',
    usage: {
      prompt_tokens: inputArray.reduce((sum, t) => sum + t.length, 0),
      total_tokens: inputArray.reduce((sum, t) => sum + t.length, 0),
    },
  };
}

/**
 * Create a mock chat completion response.
 */
export function createMockChatResponse(content: string): MockChatResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
        },
        index: 0,
        finish_reason: 'stop',
      },
    ],
    model: 'gpt-4o-mini',
    usage: {
      prompt_tokens: 100,
      completion_tokens: content.length,
      total_tokens: 100 + content.length,
    },
  };
}

/**
 * Generate a mock description and questions for an article.
 */
export function generateMockDescription(title: string): string {
  return `DESCRIPTION:
This is a mock description for the article "${title}" from Aditya's blog. It covers the main themes and key points of the content, providing a comprehensive overview that captures the essence of what Aditya discusses.

The article explores various aspects of its subject matter, offering insights and perspectives that readers will find valuable. Aditya presents information in a clear and engaging manner.

QUESTIONS:
1. What is the main topic of ${title}?
2. What are the key themes discussed in this article?
3. How does Aditya approach the subject matter?
4. What insights does the article provide?
5. Who is the target audience for this content?
6. What conclusions does Aditya draw?
7. How does this relate to similar topics?
8. What examples are provided in the article?
9. What is Aditya's perspective on this topic?
10. What are the practical takeaways from this article?
11. What does Aditya do for fun?
12. What are Aditya's hobbies?
13. What has Aditya been working on?
14. What does Aditya think about ${title}?
15. What are Aditya's interests related to this topic?
16. How does Aditya spend his time?
17. What experiences does Aditya share in this article?
18. What can I learn about Aditya from this article?
19. What activities does Aditya enjoy?
20. What is Aditya passionate about?`;
}

/**
 * Mock OpenAI class for testing.
 */
export class MockOpenAI {
  embeddings = {
    create: async (params: {model: string; input: string | string[]}) => {
      return createMockEmbeddingResponse(params.input);
    },
  };

  chat = {
    completions: {
      create: async (params: {
        model: string;
        messages: Array<{role: string; content: string}>;
      }) => {
        // Extract title from the prompt if possible
        const userMessage = params.messages.find(m => m.role === 'user');
        const titleMatch = userMessage?.content.match(/Article Title: (.+)/);
        const title = titleMatch ? titleMatch[1] : 'Unknown Article';
        return createMockChatResponse(generateMockDescription(title));
      },
    },
  };
}
