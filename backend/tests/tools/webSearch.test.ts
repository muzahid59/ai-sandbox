import { handler } from '../../src/tools/webSearch';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('web_search handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SEARXNG_URL = 'http://localhost:8888';
  });

  it('returns formatted search results', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: [
          { title: 'Result One', content: 'First snippet', url: 'https://example.com/1' },
          { title: 'Result Two', content: 'Second snippet', url: 'https://example.com/2' },
        ],
      },
    });

    const result = await handler({ query: 'test query', num_results: 2 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('1. Result One');
    expect(result.output).toContain('First snippet');
    expect(result.output).toContain('https://example.com/1');
    expect(result.output).toContain('2. Result Two');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:8888/search',
      expect.objectContaining({
        params: { q: 'test query', format: 'json', categories: 'general' },
      }),
    );
  });

  it('returns error when query is missing', async () => {
    const result = await handler({});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing');
  });

  it('returns message when no results found', async () => {
    mockedAxios.get.mockResolvedValue({ data: { results: [] } });

    const result = await handler({ query: 'obscure query' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('No results found');
  });

  it('handles SearXNG connection error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await handler({ query: 'test' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Search service unavailable');
  });

  it('clamps num_results to 1-10 range', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: Array.from({ length: 15 }, (_, i) => ({
          title: `Result ${i + 1}`,
          content: `Snippet ${i + 1}`,
          url: `https://example.com/${i + 1}`,
        })),
      },
    });

    const result = await handler({ query: 'test', num_results: 20 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('10.');
    expect(result.output).not.toContain('11.');
  });

  it('defaults to 5 results', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Result ${i + 1}`,
          content: `Snippet ${i + 1}`,
          url: `https://example.com/${i + 1}`,
        })),
      },
    });

    const result = await handler({ query: 'test' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('5.');
    expect(result.output).not.toContain('6.');
  });
});
