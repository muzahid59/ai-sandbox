export function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function formatArguments(
  args: Record<string, unknown>
): Array<{ label: string; value: string }> {
  return Object.entries(args).map(([key, value]) => ({
    label: key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }));
}
