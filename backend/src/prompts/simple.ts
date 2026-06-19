export function getSimplePrompt(options: { date: string; timezone: string }): string {
  return `You are a helpful AI assistant. Current date: ${options.date}. User timezone: ${options.timezone}.

Answer questions directly and concisely based on your knowledge. If you don't know current information (today's news, live events, real-time data), say "I don't have access to current [X]" - don't make up answers.`;
}
