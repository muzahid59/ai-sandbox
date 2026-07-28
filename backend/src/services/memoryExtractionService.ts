import { createProvider } from '../providers';
import { createMemory, isDuplicate } from './memoryService';
import { MemoryLimitError } from './memoryService';
import prisma from '../config/database';
import logger from '../config/logger';

const log = logger.child({ service: 'memoryExtraction' });
const MAX_FACTS_PER_TURN = 5;

function buildExtractionPrompt(userMessage: string, aiResponse: string): string {
  return `You are a memory extraction assistant. Analyze the conversation turn below and identify any personal facts about the user that are worth remembering for future conversations.

Return ONLY a valid JSON array of strings. Each string must be a single, concise, third-person fact about the user (e.g. "User is a senior backend engineer working primarily in TypeScript"). Return an empty array [] if there are no memorable facts.

Do not include: opinions, questions, generic statements, facts about the world, or anything not specific to the user.

User message: ${userMessage}
Assistant reply: ${aiResponse}`;
}

export async function extractAndSaveMemories(
  userId: string,
  threadId: string,
  model: string,
  userMessage: string,
  aiResponse: string,
): Promise<void> {
  try {
    const provider = createProvider(model);
    const prompt = buildExtractionPrompt(userMessage, aiResponse);

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: prompt }],
    });

    let facts: string[];
    try {
      facts = JSON.parse(result.text);
      if (!Array.isArray(facts)) {
        log.warn({ userId }, 'Memory extraction returned non-array');
        return;
      }
    } catch {
      log.warn({ userId }, 'Memory extraction JSON parse failed');
      return;
    }

    const existing = await prisma.memory.findMany({
      where: { userId },
      select: { content: true },
    });
    const existingContents = existing.map((m) => m.content);

    let saved = 0;
    for (const fact of facts) {
      if (saved >= MAX_FACTS_PER_TURN) break;
      if (typeof fact !== 'string' || !fact.trim()) continue;
      if (isDuplicate(fact, existingContents)) {
        log.debug({ userId }, 'Skipping duplicate extracted memory');
        continue;
      }
      try {
        await createMemory(userId, fact.trim(), 'extracted', threadId);
        existingContents.push(fact.trim());
        saved++;
      } catch (err) {
        if (err instanceof MemoryLimitError) {
          log.info({ userId }, 'Memory limit reached during extraction, stopping');
          break;
        }
        throw err;
      }
    }

    if (saved > 0) log.debug({ userId, saved }, 'Memories extracted and saved');
  } catch (err) {
    log.warn({ err, userId }, 'Memory extraction failed');
  }
}
