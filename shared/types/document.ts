export type DocumentSourceType = 'file' | 'url';

export type DocumentStatus =
  | 'processing'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface DuplicateNotice {
  matchedDocumentId: string;
  matchedDocumentTitle: string;
  message: string;
}

export interface Document {
  id: string;
  threadId: string;
  title: string;
  sourceType: DocumentSourceType;
  sourceUrl?: string;
  mimeType: string;
  fileSize: number;
  contentFingerprint: string;
  status: DocumentStatus;
  statusMessage: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt?: string;
  duplicateNotice?: DuplicateNotice | null;
}

export interface DocumentSearchResult {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  relevanceScore: number;
}

export interface DocumentSearchStartEvent {
  type: 'document_search_start';
  msg_id: string;
}

export interface DocumentSearchResultEvent {
  type: 'document_search_result';
  msg_id: string;
  sources: DocumentSearchResult[];
}

export interface DocumentSearchEmptyEvent {
  type: 'document_search_empty';
  msg_id: string;
}
