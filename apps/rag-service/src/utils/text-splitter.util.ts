import { Injectable } from '@nestjs/common';
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from '../constants/rag.constants';

/** 文本分片结果 */
export interface TextChunk {
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * 文本分片工具类。
 * 将长文本按指定大小和重叠量切分成多个片段。
 */
@Injectable()
export class TextSplitterUtil {
  /** 将文本切分为固定大小的片段 */
  static splitText(
    text: string,
    options?: { chunkSize?: number; chunkOverlap?: number; metadata?: Record<string, unknown> },
  ): TextChunk[] {
    const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

    if (!text || text.trim().length === 0) {
      return [];
    }

    const cleanText = text.replace(/\r\n/g, '\n');
    const chunks: TextChunk[] = [];
    let start = 0;
    let index = 0;

    while (start < cleanText.length) {
      let end = start + chunkSize;
      if (end >= cleanText.length) {
        end = cleanText.length;
      } else {
        // 尝试在段落/句子边界断开
        const breakPoint = TextSplitterUtil.findBreakPoint(cleanText, start, end);
        if (breakPoint > start) {
          end = breakPoint;
        }
      }

      const chunk = cleanText.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push({
          content: chunk,
          metadata: { ...options?.metadata, chunkIndex: index },
        });
        index++;
      }

      start = end - chunkOverlap;
      if (start >= cleanText.length) break;
      if (end === cleanText.length) break;
    }

    return chunks;
  }

  /** 查找最近的段落或句子边界作为断点 */
  private static findBreakPoint(text: string, start: number, end: number): number {
    const searchFrom = Math.max(end - 200, start);
    const region = text.slice(searchFrom, end);

    // 优先在段落边界断开
    const paragraphBreak = region.lastIndexOf('\n\n');
    if (paragraphBreak >= 0) {
      return searchFrom + paragraphBreak + 2;
    }

    // 其次在换行处断开
    const lineBreak = region.lastIndexOf('\n');
    if (lineBreak >= 0) {
      return searchFrom + lineBreak + 1;
    }

    // 再次在句号处断开
    const sentenceBreak = Math.max(
      region.lastIndexOf('。'),
      region.lastIndexOf('. '),
      region.lastIndexOf('？'),
      region.lastIndexOf('！'),
    );
    if (sentenceBreak >= 0) {
      return searchFrom + sentenceBreak + 1;
    }

    return end;
  }
}
