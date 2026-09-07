import { readFileSync, existsSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';

export interface ParsedDocument {
  filePath: string;
  fileName: string;
  fileType: 'pdf' | 'csv' | 'json' | 'html' | 'txt' | 'unknown';
  rawText: string;
  structuredData?: unknown;
  metadata?: Record<string, unknown>;
}

export class DocumentParser {
  /**
   * Parses a file from the local filesystem and extracts structured text.
   */
  public async parse(filePath: string): Promise<ParsedDocument> {
    if (!existsSync(filePath)) {
      throw new Error(`File not found at path: ${filePath}`);
    }

    const fileName = basename(filePath);
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
      case '.json':
        return this.parseJson(filePath, fileName);
      case '.csv':
        return this.parseCsv(filePath, fileName);
      case '.html':
      case '.htm':
        return this.parseHtml(filePath, fileName);
      case '.txt':
      case '.md':
        return this.parseText(filePath, fileName);
      case '.pdf':
        return this.parsePdf(filePath, fileName);
      default:
        return this.parseFallback(filePath, fileName);
    }
  }

  private parseJson(filePath: string, fileName: string): ParsedDocument {
    const content = readFileSync(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(content);
      let summary = '';
      if (Array.isArray(parsed)) {
        summary = `JSON Array containing ${parsed.length} records.\n`;
        if (parsed.length > 0 && typeof parsed[0] === 'object') {
          summary += `Sample keys: ${Object.keys(parsed[0] || {}).join(', ')}\n`;
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        summary = `JSON Object with top-level fields: ${Object.keys(parsed).join(', ')}\n`;
      }

      return {
        filePath,
        fileName,
        fileType: 'json',
        rawText: `${summary}\n${JSON.stringify(parsed, null, 2)}`,
        structuredData: parsed,
        metadata: {
          sizeBytes: content.length,
          recordCount: Array.isArray(parsed) ? parsed.length : 1,
        },
      };
    } catch (err) {
      return {
        filePath,
        fileName,
        fileType: 'json',
        rawText: content,
        metadata: { parseError: String(err) },
      };
    }
  }

  private parseCsv(filePath: string, fileName: string): ParsedDocument {
    const content = readFileSync(filePath, 'utf-8');
    const rows = this.tokenizeCsv(content);

    if (rows.length === 0) {
      return {
        filePath,
        fileName,
        fileType: 'csv',
        rawText: 'CSV file is empty.',
        structuredData: [],
      };
    }

    const headers = rows[0] || [];
    const dataRows = rows.slice(1);

    const structuredData = dataRows.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });

    // Format as Markdown table (preview up to 50 rows)
    const previewRows = dataRows.slice(0, 50);
    const mdHeader = `| ${headers.join(' | ')} |`;
    const mdSeparator = `| ${headers.map(() => '---').join(' | ')} |`;
    const mdBody = previewRows.map((r) => `| ${r.join(' | ')} |`).join('\n');

    const rawText = `CSV Table (${dataRows.length} rows, ${headers.length} columns):\n\n${mdHeader}\n${mdSeparator}\n${mdBody}`;

    return {
      filePath,
      fileName,
      fileType: 'csv',
      rawText,
      structuredData,
      metadata: {
        totalRows: dataRows.length,
        rowCount: dataRows.length,
        columnCount: headers.length,
        headers,
      },
    };
  }

  private tokenizeCsv(content: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
    }

    return rows;
  }

  private parseHtml(filePath: string, fileName: string): ParsedDocument {
    const content = readFileSync(filePath, 'utf-8');

    // Extract page title if available
    const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    // 1. Remove script, style, noscript blocks
    let cleaned = content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

    // 2. Convert structural block tags to newlines
    cleaned = cleaned
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
      .replace(/<(br|hr)\s*\/?>/gi, '\n');

    // 3. Strip all remaining HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    // 4. Decode common HTML entities
    cleaned = cleaned
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // 5. Normalize whitespace and empty lines
    const rawText = cleaned
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');

    return {
      filePath,
      fileName,
      fileType: 'html',
      rawText,
      metadata: {
        title,
        rawLengthBytes: content.length,
        extractedLines: rawText.split('\n').length,
      },
    };
  }

  private parseText(filePath: string, fileName: string): ParsedDocument {
    const rawText = readFileSync(filePath, 'utf-8');
    const words = rawText.trim().split(/\s+/).filter(Boolean);
    return {
      filePath,
      fileName,
      fileType: 'txt',
      rawText,
      metadata: {
        lineCount: rawText.split('\n').length,
        charCount: rawText.length,
        wordCount: words.length,
      },
    };
  }

  private parsePdf(filePath: string, fileName: string): ParsedDocument {
    const buffer = readFileSync(filePath);
    const extractedTextParts: string[] = [];
    let decompressedStreams = 0;

    // 1. Scan for compressed streams (FlateDecode)
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    const bufferString = buffer.toString('binary');
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(bufferString)) !== null) {
      const streamData = match[1];
      let decoded = '';

      // Attempt zlib inflate decompression
      try {
        const streamBuf = Buffer.from(streamData, 'binary');
        decoded = inflateSync(streamBuf).toString('utf-8');
        decompressedStreams++;
      } catch {
        // Fallback: uncompressed stream data
        decoded = streamData;
      }

      // Extract text enclosed in text blocks BT ... ET
      const btMatches = decoded.match(/BT[\s\S]*?ET/g);
      if (btMatches) {
        for (const bt of btMatches) {
          // Extract string literals in ( ... ) Tj or [( ... )] TJ
          const tjMatches = bt.match(/\(([^)]*)\)\s*Tj/g);
          if (tjMatches) {
            for (const tj of tjMatches) {
              const textContent = tj.replace(/^\(|\)\s*Tj$/g, '');
              extractedTextParts.push(textContent);
            }
          }

          const arrayMatches = bt.match(/\[(.*?)\]\s*TJ/g);
          if (arrayMatches) {
            for (const arr of arrayMatches) {
              const innerStrings = arr.match(/\(([^)]*)\)/g);
              if (innerStrings) {
                const combined = innerStrings.map((s) => s.slice(1, -1)).join('');
                extractedTextParts.push(combined);
              }
            }
          }
        }
      }
    }

    // 2. Direct scan for plain text string literals in PDF if stream parsing found nothing
    if (extractedTextParts.length === 0) {
      const textMatches = bufferString.match(/\(([^)]+)\)\s*(?:Tj|'|")/g);
      if (textMatches) {
        for (const m of textMatches) {
          const clean = m.replace(/[()]/g, '').replace(/Tj|'|"/g, '').trim();
          if (clean.length > 1 && /[a-zA-Z0-9]/.test(clean)) {
            extractedTextParts.push(clean);
          }
        }
      }
    }

    const rawText = extractedTextParts.length > 0
      ? extractedTextParts.join(' ')
      : `[PDF Document: ${fileName} (${buffer.length} bytes, binary content)]`;

    return {
      filePath,
      fileName,
      fileType: 'pdf',
      rawText,
      metadata: {
        sizeBytes: buffer.length,
        extractedSegments: extractedTextParts.length,
        streamsDecompressed: decompressedStreams,
      },
    };
  }

  private parseFallback(filePath: string, fileName: string): ParsedDocument {
    const buffer = readFileSync(filePath);
    const sampleLength = Math.min(buffer.length, 512);
    let isBinary = false;
    for (let i = 0; i < sampleLength; i++) {
      if (buffer[i] === 0) {
        isBinary = true;
        break;
      }
    }

    if (isBinary) {
      return {
        filePath,
        fileName,
        fileType: 'unknown',
        rawText: `[Binary File: ${fileName} (${buffer.length} bytes)]`,
        metadata: {
          isBinary: true,
          sizeBytes: buffer.length,
        },
      };
    }

    const content = buffer.toString('utf-8');
    return {
      filePath,
      fileName,
      fileType: 'unknown',
      rawText: content,
      metadata: {
        isBinary: false,
        sizeBytes: buffer.length,
      },
    };
  }
}
