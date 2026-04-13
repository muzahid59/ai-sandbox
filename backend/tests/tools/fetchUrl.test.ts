import { fetchUrl } from '../../src/tools/fetchUrl';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock dns.promises.lookup
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));
import dns from 'dns';
const mockedDnsLookup = dns.promises.lookup as jest.MockedFunction<typeof dns.promises.lookup>;

describe('fetch_url tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and converts HTML to plain text', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    mockedAxios.get.mockResolvedValue({
      data: '<html><body><h1>Hello World</h1><p>Some content here.</p></body></html>',
    });

    const result = await fetchUrl.run({ url: 'https://example.com' });

    expect(result.toUpperCase()).toContain('HELLO WORLD');
    expect(result).toContain('Some content here.');
    expect(result).not.toContain('<html>');
  });

  it('blocks private IP 127.x.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 } as any);

    await expect(fetchUrl.run({ url: 'http://localhost/secret' })).rejects.toThrow('private/internal');
  });

  it('blocks private IP 10.x.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 } as any);

    await expect(fetchUrl.run({ url: 'http://internal-server.com/data' })).rejects.toThrow('private/internal');
  });

  it('blocks private IP 172.16.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '172.16.0.1', family: 4 } as any);

    await expect(fetchUrl.run({ url: 'http://some-host.com' })).rejects.toThrow('private/internal');
  });

  it('blocks private IP 192.168.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 } as any);

    await expect(fetchUrl.run({ url: 'http://router.local' })).rejects.toThrow('private/internal');
  });

  it('truncates output to max_length', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    const longContent = '<p>' + 'A'.repeat(10000) + '</p>';
    mockedAxios.get.mockResolvedValue({ data: longContent });

    const result = await fetchUrl.run({ url: 'https://example.com', max_length: 100 });

    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('has correct tool definition', () => {
    expect(fetchUrl.definition.name).toBe('fetch_url');
    expect(fetchUrl.definition.input_schema.required).toContain('url');
  });
});
