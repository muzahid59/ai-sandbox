const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    embeddings: { create: mockCreate },
  })),
}));

jest.mock('../../src/config/logger', () => ({
  child: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

import {
  embedTexts,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from '../../src/services/embeddingService';

function makeEmbedding(seed: number, dims = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length: dims }, (_, i) => seed + i * 0.0001);
}

beforeEach(() => {
  mockCreate.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('embeddingService', () => {
  describe('exported constants', () => {
    it('exports the correct EMBEDDING_MODEL', () => {
      expect(EMBEDDING_MODEL).toBe('text-embedding-3-small');
    });

    it('exports the correct EMBEDDING_DIMENSIONS', () => {
      expect(EMBEDDING_DIMENSIONS).toBe(1536);
    });
  });

  describe('embedTexts', () => {
    it('returns an empty array when given no texts', async () => {
      const result = await embedTexts([]);
      expect(result).toEqual([]);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns 1536-dim vectors in correct order for a single batch', async () => {
      const texts = ['hello', 'world', 'foo'];
      const expectedEmbeddings = texts.map((_, i) => makeEmbedding(i));

      mockCreate.mockResolvedValueOnce({
        data: expectedEmbeddings.map((embedding, index) => ({
          embedding,
          index,
        })),
      });

      const result = await embedTexts(texts);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(expectedEmbeddings[0]);
      expect(result[1]).toEqual(expectedEmbeddings[1]);
      expect(result[2]).toEqual(expectedEmbeddings[2]);
      expect(result[0]).toHaveLength(EMBEDDING_DIMENSIONS);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        { model: EMBEDDING_MODEL, input: texts },
        expect.objectContaining({ signal: expect.any(Object) })
      );
    });

    it('splits 150 texts into 2 API calls (100 + 50)', async () => {
      const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);

      const batch1Embeddings = Array.from({ length: 100 }, (_, i) =>
        makeEmbedding(i)
      );
      const batch2Embeddings = Array.from({ length: 50 }, (_, i) =>
        makeEmbedding(100 + i)
      );

      mockCreate
        .mockResolvedValueOnce({
          data: batch1Embeddings.map((embedding, index) => ({
            embedding,
            index,
          })),
        })
        .mockResolvedValueOnce({
          data: batch2Embeddings.map((embedding, index) => ({
            embedding,
            index,
          })),
        });

      const result = await embedTexts(texts);

      expect(mockCreate).toHaveBeenCalledTimes(2);

      // First call receives the first 100 texts
      expect(mockCreate.mock.calls[0][0].input).toHaveLength(100);
      expect(mockCreate.mock.calls[0][0].input[0]).toBe('text-0');
      expect(mockCreate.mock.calls[0][0].input[99]).toBe('text-99');

      // Second call receives the remaining 50 texts
      expect(mockCreate.mock.calls[1][0].input).toHaveLength(50);
      expect(mockCreate.mock.calls[1][0].input[0]).toBe('text-100');
      expect(mockCreate.mock.calls[1][0].input[49]).toBe('text-149');

      // All 150 embeddings returned in order
      expect(result).toHaveLength(150);
      expect(result[0]).toEqual(batch1Embeddings[0]);
      expect(result[99]).toEqual(batch1Embeddings[99]);
      expect(result[100]).toEqual(batch2Embeddings[0]);
      expect(result[149]).toEqual(batch2Embeddings[49]);
    });

    it('retries on API error and succeeds on the third attempt', async () => {
      const texts = ['retry-test'];
      const expectedEmbedding = makeEmbedding(42);

      mockCreate
        .mockRejectedValueOnce(new Error('rate limit exceeded'))
        .mockRejectedValueOnce(new Error('server error'))
        .mockResolvedValueOnce({
          data: [{ embedding: expectedEmbedding, index: 0 }],
        });

      const promise = embedTexts(texts);

      // Backoff after attempt 1: 2^0 * 1000 = 1000ms
      await jest.advanceTimersByTimeAsync(1000);
      // Backoff after attempt 2: 2^1 * 1000 = 2000ms
      await jest.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result).toEqual([expectedEmbedding]);
    });

    it('throws the last error when all retry attempts are exhausted', async () => {
      const texts = ['fail-test'];

      mockCreate
        .mockRejectedValueOnce(new Error('error 1'))
        .mockRejectedValueOnce(new Error('error 2'))
        .mockRejectedValueOnce(new Error('persistent failure'));

      const promise = embedTexts(texts);
      // Prevent Node from treating the rejection as unhandled while timers advance
      promise.catch(() => {});

      // Advance through all backoff delays
      await jest.advanceTimersByTimeAsync(1000); // after attempt 1
      await jest.advanceTimersByTimeAsync(2000); // after attempt 2

      await expect(promise).rejects.toThrow('persistent failure');
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});
