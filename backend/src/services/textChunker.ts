export interface Chunk {
  content: string;
  index: number;
  tokenCount: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

const SENTENCE_BOUNDARY_RE = /(?<=[.?!])\s+|\n+/;

function splitSentences(text: string): string[] {
  return text.split(SENTENCE_BOUNDARY_RE).filter((s) => s.length > 0);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkText(text: string, options?: ChunkOptions): Chunk[] {
  const chunkSize = options?.chunkSize ?? 2000;
  const overlap = options?.overlap ?? 200;

  if (!text || !text.trim()) {
    return [];
  }

  const sentences = splitSentences(text);
  const chunks: Chunk[] = [];
  let currentSentences: string[] = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const wouldBe = currentLength + (currentLength > 0 ? 1 : 0) + sentence.length;

    if (currentLength > 0 && wouldBe > chunkSize) {
      const content = currentSentences.join(' ').trim();
      if (content.length > 0) {
        chunks.push({
          content,
          index: chunks.length,
          tokenCount: estimateTokens(content),
        });
      }

      currentSentences = [];
      currentLength = 0;

      // Build overlap from the end of the previous chunk using complete sentences
      const prevContent = content;
      const overlapSentences: string[] = [];
      let overlapLen = 0;

      const prevSentences = splitSentences(prevContent);
      for (let i = prevSentences.length - 1; i >= 0; i--) {
        const sLen = prevSentences[i].length + (overlapLen > 0 ? 1 : 0);
        if (overlapLen + sLen > overlap && overlapLen > 0) break;
        overlapSentences.unshift(prevSentences[i]);
        overlapLen += sLen;
      }

      // Fall back to character-based overlap if no complete sentence fits
      if (overlapSentences.length === 0 && prevContent.length > 0) {
        const charOverlap = prevContent.slice(-overlap).trim();
        if (charOverlap.length > 0) {
          currentSentences = [charOverlap];
          currentLength = charOverlap.length;
        }
      } else {
        currentSentences = overlapSentences;
        currentLength = overlapLen;
      }
    }

    currentSentences.push(sentence);
    currentLength += (currentLength > 0 && currentSentences.length > 1 ? 1 : 0) + sentence.length;
  }

  if (currentSentences.length > 0) {
    const content = currentSentences.join(' ').trim();
    if (content.length > 0) {
      chunks.push({
        content,
        index: chunks.length,
        tokenCount: estimateTokens(content),
      });
    }
  }

  return chunks;
}
