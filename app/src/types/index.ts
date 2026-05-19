export type {
  Thread,
  CreateThreadRequest,
  UpdateThreadRequest,
  SSEEvent,
  MessageCreatedEvent,
  DeltaEvent,
  ToolUseStartEvent,
  ToolUseResultEvent,
  DoneEvent,
  ErrorEvent,
} from '@shared/types';

import type { Thread, MessageCreatedEvent, DeltaEvent, DoneEvent, ErrorEvent, ToolUseStartEvent, ToolUseResultEvent } from '@shared/types';

export interface UIMessage {
  id: string;
  text: string;
  sent: boolean;
  done: boolean;
  isError?: boolean;
  toolCalls?: UIToolCall[];
}

export interface UIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  output?: string;
}

export interface StreamCallbacks {
  onCreated?: (data: MessageCreatedEvent) => void;
  onDelta?: (data: DeltaEvent) => void;
  onDone?: (data: DoneEvent) => void;
  onError?: (data: ErrorEvent) => void;
  onToolUseStart?: (data: ToolUseStartEvent) => void;
  onToolUseResult?: (data: ToolUseResultEvent) => void;
}

export interface ChatContainerProps {
  threadId: string | undefined;
  onThreadCreated?: (thread: Thread) => void;
  onThreadUpdated?: (threadId: string) => void;
}

export interface ChatInputProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  handleSubmit: (event: React.FormEvent) => void;
  handleImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  startListening: () => void;
  stopListening: () => void;
  isListening: boolean;
  isLoading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  imageData: string | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedTools: string[];
  onToolsChange: (tools: string[]) => void;
}

export interface MessageBubbleProps {
  message: UIMessage;
}

export interface MessageListProps {
  messages: UIMessage[];
}

export interface SidebarProps {
  threads: Thread[];
  activeThreadId: string | undefined;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onDeleteThread: (threadId: string) => void;
}
