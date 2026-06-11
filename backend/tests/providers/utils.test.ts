import { extractTextContent, mapToolResult, buildToolCallContentBlock } from '../../src/providers/utils';

describe('extractTextContent', () => {
  it('returns string content directly', () => {
    expect(extractTextContent('hello world')).toBe('hello world');
  });

  it('extracts text from content blocks', () => {
    const content = [
      { type: 'text' as const, text: 'hello' },
      { type: 'text' as const, text: 'world' },
    ];
    expect(extractTextContent(content)).toBe('hello world');
  });

  it('filters out non-text blocks', () => {
    const content = [
      { type: 'text' as const, text: 'hello' },
      { type: 'tool_use' as const, id: '1', name: 'calc', input: {} },
      { type: 'text' as const, text: 'world' },
    ];
    expect(extractTextContent(content)).toBe('hello world');
  });

  it('returns empty string for empty array', () => {
    expect(extractTextContent([])).toBe('');
  });

  it('passes through unknown content block types without error', () => {
    const content: any[] = [
      { type: 'text', text: 'hello' },
      { type: 'unknown_future_type', data: 'something' },
    ];
    expect(extractTextContent(content)).toBe('hello');
  });
});

describe('mapToolResult', () => {
  it('extracts tool result from content blocks', () => {
    const content = [
      { type: 'tool_result' as const, tool_use_id: 'call_1', content: 'result text', is_error: false },
    ];
    expect(mapToolResult(content)).toEqual({
      tool_use_id: 'call_1',
      content: 'result text',
    });
  });

  it('returns null when no tool_result block exists', () => {
    const content = [{ type: 'text' as const, text: 'hello' }];
    expect(mapToolResult(content)).toBeNull();
  });

  it('returns empty content string when content field is missing', () => {
    const content = [
      { type: 'tool_result' as const, tool_use_id: 'call_1' } as any,
    ];
    expect(mapToolResult(content)).toEqual({
      tool_use_id: 'call_1',
      content: '',
    });
  });
});

describe('buildToolCallContentBlock', () => {
  it('creates a tool_use content block from a ToolCall', () => {
    const toolCall = { id: 'call_1', name: 'calculator', arguments: { expression: '2+2' } };
    expect(buildToolCallContentBlock(toolCall)).toEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'calculator',
      input: { expression: '2+2' },
    });
  });

  it('handles empty arguments', () => {
    const toolCall = { id: 'call_2', name: 'list_tools', arguments: {} };
    expect(buildToolCallContentBlock(toolCall)).toEqual({
      type: 'tool_use',
      id: 'call_2',
      name: 'list_tools',
      input: {},
    });
  });
});
