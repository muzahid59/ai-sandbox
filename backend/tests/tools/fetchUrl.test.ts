import { handler } from '../../src/tools/fetchUrl';

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

describe('fetch_url handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and converts HTML to plain text', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    mockedAxios.get.mockResolvedValue({
      data: '<html><body><h1>Hello World</h1><p>Some content here.</p></body></html>',
    });

    const result = await handler({ url: 'https://example.com' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Hello World');
    expect(result.output).toContain('Some content here.');
    expect(result.output).not.toContain('<html>');
  });

  it('rejects missing url', async () => {
    const result = await handler({});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Invalid URL');
  });

  it('rejects non-http URLs', async () => {
    const result = await handler({ url: 'ftp://example.com/file' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('must start with http');
  });

  it('blocks private IP 127.x.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 } as any);

    const result = await handler({ url: 'http://localhost/secret' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('blocks private IP 10.x.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 } as any);

    const result = await handler({ url: 'http://internal-server.com/data' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('blocks private IP 172.16.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '172.16.0.1', family: 4 } as any);

    const result = await handler({ url: 'http://some-host.com' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('blocks private IP 192.168.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 } as any);

    const result = await handler({ url: 'http://router.local' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('truncates output to max_length', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    const longContent = '<p>' + 'A'.repeat(10000) + '</p>';
    mockedAxios.get.mockResolvedValue({ data: longContent });

    const result = await handler({ url: 'https://example.com', max_length: 100 });

    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(100);
  });

  it('handles fetch errors gracefully', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    mockedAxios.get.mockRejectedValue(new Error('timeout'));

    const result = await handler({ url: 'https://slow-site.com' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Failed to fetch');
  });
});
