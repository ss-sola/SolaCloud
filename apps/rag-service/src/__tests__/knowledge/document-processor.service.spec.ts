import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { DocumentProcessorService } from '@/modules/knowledge/service/document-processor.service';

const fsReadFileSyncMock = vi.fn();

vi.mock('fs', () => ({
  readFileSync: fsReadFileSyncMock,
}));

describe('DocumentProcessorService', () => {
  let service: DocumentProcessorService;

  beforeEach(() => {
    service = new DocumentProcessorService();
    fsReadFileSyncMock.mockReset();
  });

  it('should parse xlsx sheets into plain text', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['姓名', '年龄'],
      ['张三', 18],
      ['李四', 20],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, '统计表');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    fsReadFileSyncMock.mockReturnValue(buffer);

    const result = await service.parseDocument({
      filePath: 'mock.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: 'mock.xlsx',
    });

    expect(result[0].content).toContain('Sheet: 统计表');
    expect(result[0].content).toContain('姓名 | 年龄');
    expect(result[0].content).toContain('张三 | 18');
  });

  it('should parse pptx slide text into plain text', async () => {
    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp>
              <p:txBody>
                <a:p>
                  <a:r><a:t>第一页标题</a:t></a:r>
                  <a:r><a:t>第一页内容</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree>
        </p:cSld>
      </p:sld>`,
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    fsReadFileSyncMock.mockReturnValue(buffer);

    const result = await service.parseDocument({
      filePath: 'mock.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileName: 'mock.pptx',
    });

    expect(result[0].content).toContain('第一页标题');
    expect(result[0].content).toContain('第一页内容');
  });
});
