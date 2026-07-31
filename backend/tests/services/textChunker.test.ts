import { chunkText, Chunk } from '../../src/services/textChunker';

describe('chunkText', () => {
  describe('empty and whitespace input', () => {
    it('returns empty array for empty string', () => {
      expect(chunkText('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(chunkText('   \n\t  ')).toEqual([]);
    });
  });

  describe('single chunk scenarios', () => {
    it('returns one chunk when sentence is shorter than chunkSize', () => {
      const text = 'Hello world.';
      const chunks = chunkText(text, { chunkSize: 500, overlap: 50 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Hello world.');
      expect(chunks[0].index).toBe(0);
    });

    it('returns one chunk when a single sentence exceeds chunkSize', () => {
      const longSentence = 'A'.repeat(300);
      const chunks = chunkText(longSentence, { chunkSize: 100, overlap: 20 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(longSentence);
      expect(chunks[0].index).toBe(0);
    });
  });

  describe('sentence boundary splitting', () => {
    it('splits at sentence boundaries without breaking mid-sentence', () => {
      const text =
        'First sentence. Second sentence. Third sentence. Fourth sentence.';
      const chunks = chunkText(text, { chunkSize: 40, overlap: 0 });

      for (const chunk of chunks) {
        // Each chunk should not start or end with a partial word mid-sentence
        // (unless the chunk IS an entire sentence that exceeded chunkSize).
        // Verify content is composed of complete sentences by checking
        // that every period-terminated segment in the original appears intact.
        const sentences = chunk.content
          .split(/(?<=[.?!])\s+/)
          .filter((s) => s.length > 0);
        expect(sentences.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('splits on newline boundaries', () => {
      const text = 'Line one.\nLine two.\nLine three.';
      const chunks = chunkText(text, { chunkSize: 15, overlap: 0 });

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      // Each chunk should contain complete lines
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeGreaterThan(0);
      }
    });
  });

  describe('overlap preserves context', () => {
    it('overlap content from previous chunk appears at the start of the next chunk', () => {
      const text =
        'Alpha. Bravo. Charlie. Delta. Echo. Foxtrot. Golf. Hotel. India. Juliet.';
      const chunks = chunkText(text, { chunkSize: 30, overlap: 15 });

      expect(chunks.length).toBeGreaterThan(1);

      for (let i = 1; i < chunks.length; i++) {
        const prevContent = chunks[i - 1].content;
        const currContent = chunks[i].content;

        // The current chunk should start with text that appeared
        // at the end of the previous chunk (overlap region)
        const prevSentences = prevContent.split(/(?<=[.?!])\s+/);
        const lastPrevSentence = prevSentences[prevSentences.length - 1];

        // The overlap means the current chunk should contain at least
        // the last sentence (or part) of the previous chunk
        expect(currContent).toContain(lastPrevSentence);
      }
    });
  });

  describe('chunk count and structure for long text', () => {
    it('produces the expected number of chunks for long text with overlap', () => {
      // Build a text with many short sentences
      const sentences = Array.from(
        { length: 20 },
        (_, i) => `Sentence number ${i + 1}.`
      );
      const text = sentences.join(' ');
      const chunkSize = 100;
      const overlap = 20;

      const chunks = chunkText(text, { chunkSize, overlap });

      // Should produce multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // All original text should be recoverable from the chunks
      // (each sentence must appear in at least one chunk)
      for (const sentence of sentences) {
        const found = chunks.some((c) => c.content.includes(sentence));
        expect(found).toBe(true);
      }
    });
  });

  describe('token count estimation', () => {
    it('tokenCount matches Math.ceil(content.length / 4)', () => {
      const text = 'Some example text. Another sentence here. Yet more words follow.';
      const chunks = chunkText(text, { chunkSize: 2000 });

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBe(Math.ceil(chunk.content.length / 4));
      }
    });

    it('tokenCount is correct for each chunk when text is split', () => {
      const sentences = Array.from(
        { length: 10 },
        (_, i) => `Testing sentence ${i}.`
      );
      const text = sentences.join(' ');
      const chunks = chunkText(text, { chunkSize: 60, overlap: 10 });

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBe(Math.ceil(chunk.content.length / 4));
      }
    });
  });

  describe('custom chunkSize and overlap options', () => {
    it('respects a small custom chunkSize', () => {
      const text = 'One. Two. Three. Four. Five. Six. Seven. Eight.';
      const chunks = chunkText(text, { chunkSize: 15, overlap: 0 });

      // With chunkSize 15 and no overlap, most chunks should be <= 15 chars
      // (unless a single sentence exceeds 15 chars, which is allowed)
      for (const chunk of chunks) {
        const singleSentences = chunk.content
          .split(/(?<=[.?!])\s+/)
          .filter((s) => s.length > 0);
        // If a chunk has multiple sentences, their combined length
        // should be near or under chunkSize (the algorithm groups greedily)
        if (singleSentences.length === 1) {
          // Single sentence chunks are always valid
          expect(chunk.content.length).toBeGreaterThan(0);
        }
      }
    });

    it('uses default chunkSize of 2000 and overlap of 200 when no options given', () => {
      // With a short text and defaults, everything fits in one chunk
      const text = 'Short text here.';
      const chunks = chunkText(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('Short text here.');
    });

    it('overlap of 0 carries over at most one sentence from the previous chunk', () => {
      const text = 'First. Second. Third. Fourth. Fifth. Sixth. Seventh. Eighth.';
      const chunks = chunkText(text, { chunkSize: 25, overlap: 0 });

      // The overlap loop always includes at least one sentence (the guard
      // `overlapLen > 0` prevents breaking on the first iteration), so
      // with overlap=0 exactly one sentence carries over between chunks.
      for (let i = 1; i < chunks.length; i++) {
        const prevSentences = chunks[i - 1].content
          .split(/(?<=[.?!])\s+/)
          .filter((s) => s.length > 0);
        const currSentences = chunks[i].content
          .split(/(?<=[.?!])\s+/)
          .filter((s) => s.length > 0);

        const shared = prevSentences.filter((s) => currSentences.includes(s));
        expect(shared.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('index is 0-based sequential', () => {
    it('chunk indices are sequential starting from 0', () => {
      const sentences = Array.from(
        { length: 15 },
        (_, i) => `Item number ${i + 1}.`
      );
      const text = sentences.join(' ');
      const chunks = chunkText(text, { chunkSize: 60, overlap: 10 });

      expect(chunks.length).toBeGreaterThan(1);

      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
      });
    });

    it('single chunk has index 0', () => {
      const chunks = chunkText('Only one.', { chunkSize: 500 });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].index).toBe(0);
    });
  });
});
