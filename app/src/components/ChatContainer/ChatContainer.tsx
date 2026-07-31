import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchThread, createThread, sendMessage, uploadDocument, listDocuments, deleteDocument, cancelDocument } from '../../api';
import MessageList from '../MessageList/MessageList';
import ChatInput from '../ChatInput/ChatInput';
import DocumentUpload from '../DocumentUpload';
import DocumentPanel from '../DocumentPanel';
import type { UIMessage, ChatContainerProps, UIDocumentSource } from '../../types';
import type { Document } from '@shared/types/document';
import styles from './ChatContainer.module.css';

interface DispatchPayload {
  text: string;
  image: string | null;
}

const ChatContainer: React.FC<ChatContainerProps> = ({
  threadId,
  onThreadCreated,
  onThreadUpdated,
  onMessageComplete,
}) => {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [imageData, setImageData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedModel, setSelectedModel] = useState('qwen3.6');
  const [selectedTools, setSelectedTools] = useState([
    'calculator',
    'web_search',
    'fetch_url',
    'google_calendar',
    'read_emails',
    'search_emails',
    'summarize_emails',
    'draft_email',
    'reply_email',
  ]);
  const [threadNotFound, setThreadNotFound] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const pendingSourcesRef = useRef<UIDocumentSource[]>([]);
  const recognition = useRef<SpeechRecognition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextFetchRef = useRef(false);

  useEffect(() => {
    setThreadNotFound(false);

    if (!threadId) {
      setMessages([]);
      setDocuments([]);
      return;
    }

    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    let cancelled = false;

    fetchThread(threadId)
      .then(({ thread, messages: threadMessages }) => {
        if (cancelled) return;
        setSelectedModel(thread.model);
        setMessages(
          threadMessages.map((m) => ({
            id: m.id,
            text: Array.isArray(m.content)
              ? m.content
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text ?? '')
                  .join(' ')
              : '',
            sent: m.role === 'user',
            done: true,
          }))
        );
      })
      .then(() => {
        if (!cancelled) {
          listDocuments(threadId!).then(docs => {
            if (!cancelled) setDocuments(docs);
          }).catch(() => {});
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to load thread:', err);
        setThreadNotFound(true);
        const timer = setTimeout(() => {
          if (!cancelled) {
            navigate('/chat/new', { replace: true });
          }
        }, 3000);
        return () => clearTimeout(timer);
      });

    return () => {
      cancelled = true;
    };
  }, [threadId, navigate]);

  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      window.mozSpeechRecognition ||
      window.msSpeechRecognition;

    if (!SpeechRecognitionCtor) return;

    recognition.current = new SpeechRecognitionCtor();
    recognition.current.lang = 'en-US';
    recognition.current.interimResults = true;
    recognition.current.continuous = true;

    recognition.current.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');
      setInputValue(transcript);
    };

    recognition.current.onend = () => {
      setIsListening(false);
    };

    return () => {
      if (recognition.current) {
        recognition.current.abort();
      }
    };
  }, []);

  const startListening = () => {
    setIsListening(true);
    if (recognition.current) {
      recognition.current.start();
    }
  };

  const stopListening = () => {
    if (recognition.current) {
      recognition.current.stop();
    }
    setIsListening(false);
  };

  const dispatchMessage = useCallback(
    async (payload: DispatchPayload) => {
      const tempAssistantId = 'temp-assistant-' + Date.now();
      try {
        setIsLoading(true);

        const tempUserId = 'temp-user-' + Date.now();

        const fileToUpload = pendingFile;
        const attachedDoc = fileToUpload ? { name: fileToUpload.name, size: fileToUpload.size, type: fileToUpload.type, uploading: true } : undefined;

        setMessages((prev) => [
          ...prev,
          { id: tempUserId, text: payload.text, sent: true, done: true, attachedDocument: attachedDoc },
        ]);
        setInputValue('');
        setImageData(null);
        setPendingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';

        let currentThreadId = threadId;
        if (!currentThreadId) {
          const thread = await createThread(selectedModel);
          currentThreadId = thread.id;
          skipNextFetchRef.current = true;
          onThreadCreated?.(thread);
        }

        if (fileToUpload) {
          await uploadDocument(currentThreadId, fileToUpload);
          setMessages((prev) => prev.map((m) =>
            m.id === tempUserId && m.attachedDocument
              ? { ...m, attachedDocument: { ...m.attachedDocument, uploading: false } }
              : m
          ));
          refreshDocuments();
        }

        const content: Array<{ type: string; text?: string; url?: string }> = [
          { type: 'text', text: payload.text || (fileToUpload ? `I've attached ${fileToUpload.name}` : '') },
        ];
        if (payload.image) {
          content.push({ type: 'image_url', url: payload.image });
        }

        setMessages((prev) => [
          ...prev,
          { id: tempAssistantId, text: '', sent: false, done: false },
        ]);

        await sendMessage(currentThreadId, content, selectedTools, {
          onCreated: (data) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === tempUserId)
                  return { ...m, id: (data as Record<string, string>).user_msg_id };
                if (m.id === tempAssistantId)
                  return { ...m, id: (data as Record<string, string>).assistant_msg_id };
                return m;
              })
            );
          },
          onDelta: (data) => {
            setMessages((prev) =>
              prev.map((m) => (!m.sent && !m.done ? { ...m, text: m.text + data.text } : m))
            );
          },
          onDocumentSearchResult: (sources) => {
            pendingSourcesRef.current = sources;
          },
          onDone: () => {
            const docSources = pendingSourcesRef.current;
            pendingSourcesRef.current = [];
            setMessages((prev) => prev.map((m) => (!m.sent && !m.done ? { ...m, done: true, documentSources: docSources.length > 0 ? docSources : undefined } : m)));
            setIsLoading(false);
            onThreadUpdated?.(currentThreadId!);
            onMessageComplete?.();
          },
          onError: (data) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId
                  ? {
                      ...m,
                      text: `Error: ${data.message || 'Something went wrong'}`,
                      done: true,
                      isError: true,
                    }
                  : m
              )
            );
            setIsLoading(false);
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to send message';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantId
              ? { ...m, text: `Error: ${msg}`, done: true, isError: true }
              : m
          )
        );
        setIsLoading(false);
      }
    },
    [threadId, selectedModel, selectedTools, pendingFile, onThreadCreated, onThreadUpdated]
  );

  const refreshDocuments = useCallback(() => {
    if (threadId) {
      listDocuments(threadId).then(setDocuments).catch(() => {});
    }
  }, [threadId]);

  const handleDeleteDocument = useCallback(async (documentId: string) => {
    if (!threadId) return;
    await deleteDocument(threadId, documentId);
    setDocuments(prev => prev.filter(d => d.id !== documentId));
  }, [threadId]);

  const handleCancelDocument = useCallback(async (documentId: string) => {
    if (!threadId) return;
    await cancelDocument(threadId, documentId);
    refreshDocuments();
  }, [threadId, refreshDocuments]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputValue && !pendingFile) return;

    if (isListening) {
      stopListening();
    }

    dispatchMessage({
      text: inputValue,
      image: imageData,
    });
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageData(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const inputProps = {
    inputValue,
    setInputValue,
    handleSubmit,
    handleImageChange,
    startListening,
    stopListening,
    isListening,
    isLoading,
    fileInputRef,
    imageData,
    selectedModel,
    onModelChange: setSelectedModel,
    selectedTools,
    onToolsChange: setSelectedTools,
  };

  if (threadNotFound) {
    return (
      <div className={styles.container}>
        <div className={styles.errorScreen}>
          <div className={styles.errorIcon}>&#9888;</div>
          <h1 className={styles.errorHeading}>Thread not found</h1>
          <p className={styles.errorSubtext}>Redirecting to a new chat...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {messages.length === 0 ? (
        <div className={styles.welcomeScreen}>
          <div className={styles.welcomeIcon}>&#10022;</div>
          <h1 className={styles.welcomeHeading}>How can I help you today?</h1>
          <ChatInput {...inputProps} />
        </div>
      ) : (
        <>
          {threadId && documents.length > 0 && (
            <DocumentPanel
              threadId={threadId}
              documents={documents}
              onDelete={handleDeleteDocument}
              onCancel={handleCancelDocument}
              onRefresh={refreshDocuments}
            />
          )}
          <MessageList messages={messages} />
          <ChatInput {...inputProps}
            pendingFile={pendingFile}
            onRemovePendingFile={() => setPendingFile(null)}
            documentUpload={threadId ? <DocumentUpload threadId={threadId} onFileAttach={setPendingFile} onUploadComplete={refreshDocuments} /> : undefined}
          />
        </>
      )}
    </div>
  );
};

export default ChatContainer;
