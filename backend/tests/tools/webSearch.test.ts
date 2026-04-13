import { webSearch } from '../../src/tools/webSearch';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('web_search tool', () => {
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

    const result = await webSearch.run({ query: 'test query', num_results: 2 });

    expect(result).toContain('1. Result One');
    expect(result).toContain('First snippet');
    expect(result).toContain('https://example.com/1');
    expect(result).toContain('2. Result Two');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:8888/search',
      expect.objectContaining({
        params: { q: 'test query', format: 'json', categories: 'general' },
      }),
    );
  });

  it('returns message when no results found', async () => {
    mockedAxios.get.mockResolvedValue({ data: { results: [] } });

    const result = await webSearch.run({ query: 'obscure query' });

    expect(result).toContain('No results found');
  });

  it('throws ToolError on SearXNG connection error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(webSearch.run({ query: 'test' })).rejects.toThrow('Search service unavailable');
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

    const result = await webSearch.run({ query: 'test', num_results: 20 });

    expect(result).toContain('10.');
    expect(result).not.toContain('11.');
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

    const result = await webSearch.run({ query: 'test' });

    expect(result).toContain('5.');
    expect(result).not.toContain('6.');
  });

  it('has correct tool definition', () => {
    expect(webSearch.definition.name).toBe('web_search');
    expect(webSearch.definition.input_schema.required).toContain('query');
  });
});
