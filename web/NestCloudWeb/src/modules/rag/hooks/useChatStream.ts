import { useCallback, useRef, useState } from 'react';
import { RagApi } from '../api/ragApi';
import type { ChatMessage, SourceReference, FileAttachment } from '../types/rag.types';

interface UseChatStreamState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentStreamContent: string;
  currentSources: SourceReference[];
  isRegenerating: boolean;
}

interface UseChatStreamOptions {
  onDone?: () => void;
}

export function useChatStream(sessionId: number | null, options?: UseChatStreamOptions) {
  const [state, setState] = useState<UseChatStreamState>({
    messages: [],
    isStreaming: false,
    currentStreamContent: '',
    currentSources: [],
    isRegenerating: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  /** 加载历史消息 */
  const loadMessages = useCallback(async () => {
    if (!sessionId) return;
    const messages = await RagApi.getSessionMessages(sessionId);
    setState((prev) => ({ ...prev, messages }));
  }, [sessionId]);

  /** 发送消息 */
  const sendMessage = useCallback(
    (query: string, files?: FileAttachment[]) => {
      if (!sessionId || state.isStreaming) return;

      // 添加用户消息到列表
      const userMessage: ChatMessage = {
        id: Date.now(),
        sessionId,
        role: 'user',
        content: query,
        attachments: files?.length ? files : undefined,
        createdAt: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isStreaming: true,
        currentStreamContent: '',
        currentSources: [],
      }));

      // 发起 SSE 流式请求
      abortRef.current = RagApi.sendMessageStream(
        {
          sessionId,
          query,
          files: files?.length
            ? files.map((f) => ({
                fileId: f.fileId,
                fileUrl: f.url,
                originalName: f.name,
                mimeType: f.mimeType,
                size: f.size,
              }))
            : undefined,
        },
        {
          onToken: (token) => {
            setState((prev) => ({
              ...prev,
              currentStreamContent: prev.currentStreamContent + token,
            }));
          },
          onSources: (sources) => {
            setState((prev) => ({
              ...prev,
              currentSources: (sources as SourceReference[]) ?? [],
            }));
          },
          onDone: () => {
            setState((prev) => {
              const assistantMessage: ChatMessage = {
                id: Date.now() + 1,
                sessionId: sessionId!,
                role: 'assistant',
                content: prev.currentStreamContent,
                sources: prev.currentSources,
                createdAt: new Date().toISOString(),
              };
              options?.onDone?.();
              return {
                ...prev,
                messages: [...prev.messages, assistantMessage],
                isStreaming: false,
                currentStreamContent: '',
                currentSources: [],
              };
            });
          },
          onError: (message) => {
            setState((prev) => {
              // 如果已经有内容，说明流式传输中断，保留已有内容
              const errorMessage = prev.currentStreamContent
                ? prev.currentStreamContent
                : `抱歉，出现了错误：${message}`;

              const assistantMessage: ChatMessage = {
                id: Date.now() + 1,
                sessionId: sessionId!,
                role: 'assistant',
                content: errorMessage,
                createdAt: new Date().toISOString(),
              };

              return {
                ...prev,
                messages: [...prev.messages, assistantMessage],
                isStreaming: false,
                currentStreamContent: '',
                currentSources: [],
              };
            });
          },
        },
      );
    },
    [sessionId, state.isStreaming],
  );

  /** 取消当前流式请求 */
  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  /** 重新生成指定用户消息的 AI 回复 */
  const regenerate = useCallback(
    (lastUserId: number) => {
      if (!sessionId) return;

      // 查找 lastUserId 对应的用户消息
      const msgIndex = state.messages.findIndex((m) => m.id === lastUserId);
      if (msgIndex < 0) return;
      const targetUserMsg = state.messages[msgIndex];
      if (targetUserMsg.role !== 'user') return;

      // 移除紧邻的 assistant 消息
      const nextMsg = state.messages[msgIndex + 1];
      if (nextMsg && nextMsg.role === 'assistant') {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.filter((m) => m.id !== nextMsg.id),
        }));
      }

      // 中止可能正在进行的流式请求
      abortRef.current?.abort();

      // 清空流式状态
      setState((prev) => ({
        ...prev,
        currentStreamContent: '',
        currentSources: [],
        isStreaming: true,
        isRegenerating: true,
      }));

      // 构建附件列表
      const fileAttachments = targetUserMsg.attachments?.map((f) => ({
        fileId: f.fileId,
        fileUrl: f.url,
        originalName: f.name,
        mimeType: f.mimeType,
        size: f.size,
      }));

      // 发起 SSE 流式请求
      abortRef.current = RagApi.sendMessageStream(
        {
          sessionId,
          query: targetUserMsg.content,
          files: fileAttachments,
          regenerate: true,
          lastUserId,
        },
        {
          onToken: (token) => {
            setState((prev) => ({
              ...prev,
              currentStreamContent: prev.currentStreamContent + token,
            }));
          },
          onSources: (sources) => {
            setState((prev) => ({
              ...prev,
              currentSources: (sources as SourceReference[]) ?? [],
            }));
          },
          onDone: () => {
            setState((prev) => {
              const assistantMessage: ChatMessage = {
                id: Date.now() + 1,
                sessionId: sessionId!,
                role: 'assistant',
                content: prev.currentStreamContent,
                sources: prev.currentSources,
                createdAt: new Date().toISOString(),
              };
              options?.onDone?.();
              return {
                ...prev,
                messages: [...prev.messages, assistantMessage],
                isStreaming: false,
                isRegenerating: false,
                currentStreamContent: '',
                currentSources: [],
              };
            });
          },
          onError: (message) => {
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              isRegenerating: false,
              currentStreamContent: '',
              currentSources: [],
            }));
          },
        },
      );
    },
    [sessionId, state.messages, state.isStreaming, options],
  );

  return {
    ...state,
    loadMessages,
    sendMessage,
    cancelStream,
    regenerate,
  };
}
