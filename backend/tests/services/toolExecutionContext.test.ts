import { ToolExecutionContext } from '../../src/types/context';

describe('ToolExecutionContext — type structure', () => {
  it('has a userId field of type string', () => {
    const ctx: ToolExecutionContext = { userId: 'test-user-id' };
    expect(ctx.userId).toBe('test-user-id');
  });
});

describe('ToolRegistry — context propagation', () => {
  const mockRun = jest.fn().mockResolvedValue('tool result');

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../src/config/logger', () => ({
      __esModule: true,
      default: {
        child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
      },
    }));
  });

  it('passes context to tool.run()', async () => {
    const { toolRegistry } = await import('../../src/services/toolRegistry');

    const mockTool = {
      definition: {
        name: 'test_context_tool',
        description: 'Test context propagation',
        input_schema: { type: 'object' as const, properties: {} },
      },
      schema: {
        safeParse: (data: unknown) => ({ success: true, data }),
      } as any,
      run: mockRun,
    };

    (toolRegistry as any).tools.set('test_context_tool', mockTool);

    const ctx: ToolExecutionContext = { userId: 'propagated-user-id' };
    await toolRegistry.execute('test_context_tool', {}, ctx);

    expect(mockRun).toHaveBeenCalledWith({}, ctx);
  });

  it('non-Google tools execute correctly when context is passed', async () => {
    const { toolRegistry } = await import('../../src/services/toolRegistry');

    const calculatorMock = jest.fn().mockResolvedValue('42');
    const calcTool = {
      definition: {
        name: 'calculator_ctx_test',
        description: 'Calculator',
        input_schema: { type: 'object' as const, properties: {} },
      },
      schema: {
        safeParse: (data: unknown) => ({ success: true, data }),
      } as any,
      run: calculatorMock,
    };

    (toolRegistry as any).tools.set('calculator_ctx_test', calcTool);

    const ctx: ToolExecutionContext = { userId: 'any-user' };
    const result = await toolRegistry.execute('calculator_ctx_test', {}, ctx);

    expect(result.is_error).toBe(false);
    expect(result.output).toBe('42');
  });
});
