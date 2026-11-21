import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { TextChunk } from '../../../utils/text-splitter.util';

/**
 * 文档解析服务。
 * 负责将不同格式的文档（PDF/Word/PPT/Excel/TXT/Markdown）解析为纯文本。
 */
@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);

  /** 根据文件类型解析文档内容 */
  async parseDocument(options: {
    filePath: string;
    mimeType: string;
    fileName: string;
  }): Promise<TextChunk[]> {
    const { filePath, mimeType, fileName } = options;
    this.logger.log(`开始解析文档: ${fileName} (${mimeType})`);

    let rawText: string;

    if (mimeType === 'application/pdf') {
      rawText = await this.parsePdf(filePath);
    } else if (
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      rawText = await this.parseWord(filePath);
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) {
      rawText = await this.parsePptx(filePath);
    } else if (
      mimeType === 'application/vnd.ms-excel' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      rawText = await this.parseExcel(filePath);
    } else if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      rawText = await this.parsePlainText(filePath);
    } else {
      this.logger.warn(`不支持的文档格式: ${mimeType}，尝试作为纯文本处理`);
      rawText = await this.parsePlainText(filePath);
    }

    return [{ content: rawText, metadata: { source: fileName, mimeType } }];
  }

  private async parsePdf(filePath: string): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(await readFile(filePath)) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }

  private async parseWord(filePath: string): Promise<string> {
    const fs = await import('fs');
    const mammoth = await import('mammoth');
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  private async parsePptx(filePath: string): Promise<string> {
    const fs = await import('fs');
    const xmlParser = await import('fast-xml-parser');
    const buffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const slides: string[] = [];
    for (const slideFile of slideFiles) {
      const xml = await zip.files[slideFile].async('string');
      const parser = new xmlParser.XMLParser({
        ignoreAttributes: false,
        trimValues: true,
      });
      const parsed = parser.parse(xml);
      const texts = this.collectXmlText(parsed);
      if (texts.length > 0) {
        slides.push(texts.join('\n'));
      }
    }

    return slides.join('\n\n');
  }

  private async parseExcel(filePath: string): Promise<string> {
    const fs = await import('fs');
    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
        header: 1,
        raw: false,
        blankrows: false,
      });
      const content = rows
        .map((row) =>
          row.filter((cell) => cell !== null && cell !== undefined && cell !== '').join(' | '),
        )
        .filter((line) => line.trim().length > 0)
        .join('\n');
      return content ? `Sheet: ${sheetName}\n${content}` : '';
    }).filter((sheetText) => sheetText.length > 0);

    return sheets.join('\n\n');
  }

  private async parsePlainText(filePath: string): Promise<string> {
    const fs = await import('fs');
    return fs.readFileSync(filePath, 'utf-8');
  }

  private collectXmlText(node: unknown): string[] {
    if (typeof node === 'string') {
      const text = node.trim();
      return text ? [text] : [];
    }
    if (Array.isArray(node)) {
      return node.flatMap((item) => this.collectXmlText(item));
    }
    if (!node || typeof node !== 'object') {
      return [];
    }

    const values = Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
      // a:t 是 PPTX DrawingML 文本元素，只提取这里的内容
      if (key === 'a:t') {
        return this.collectXmlText(value);
      }
      // 继续递归查找容器内的 a:t 元素
      if (typeof value === 'object' && value !== null) {
        return this.collectXmlText(value);
      }
      return [];
    });

    return values;
  }
}
