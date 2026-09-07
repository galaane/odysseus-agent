import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { DocumentParser } from '../../src/research/index.js';

describe('Phase 11: DocumentParser', () => {
  let tempDir: string;
  let parser: DocumentParser;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'odysseus-docparser-test-'));
    parser = new DocumentParser();
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows if locked
    }
  });

  describe('JSON Document Parsing', () => {
    it('should parse structured JSON array and extract records', async () => {
      const filePath = join(tempDir, 'data.json');
      const data = [
        { id: 1, name: 'Sensor Alpha', status: 'active' },
        { id: 2, name: 'Sensor Beta', status: 'idle' },
      ];
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('json');
      expect(parsed.fileName).toBe('data.json');
      expect(parsed.rawText).toContain('JSON Array containing 2 records');
      expect(parsed.rawText).toContain('Sensor Alpha');
      expect(parsed.structuredData).toEqual(data);
      expect(parsed.metadata?.recordCount).toBe(2);
    });

    it('should parse structured JSON object', async () => {
      const filePath = join(tempDir, 'config.json');
      const obj = { title: 'Report', version: '2.0', metrics: { score: 98 } };
      writeFileSync(filePath, JSON.stringify(obj), 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('json');
      expect(parsed.structuredData).toEqual(obj);
      expect(parsed.rawText).toContain('JSON Object with top-level fields');
    });

    it('should handle malformed JSON gracefully', async () => {
      const filePath = join(tempDir, 'bad.json');
      writeFileSync(filePath, '{ bad json syntax ...', 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('json');
      expect(parsed.rawText).toBe('{ bad json syntax ...');
      expect(parsed.metadata?.parseError).toBeDefined();
    });
  });

  describe('CSV Document Parsing', () => {
    it('should parse CSV with headers and rows into structured objects', async () => {
      const filePath = join(tempDir, 'users.csv');
      const csvContent = 'ID,Name,Role\n101,Alice,Engineer\n102,Bob,Architect\n';
      writeFileSync(filePath, csvContent, 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('csv');
      expect(parsed.fileName).toBe('users.csv');
      expect(parsed.metadata?.rowCount).toBe(2);
      expect(parsed.metadata?.headers).toEqual(['ID', 'Name', 'Role']);
      expect(parsed.structuredData).toEqual([
        { ID: '101', Name: 'Alice', Role: 'Engineer' },
        { ID: '102', Name: 'Bob', Role: 'Architect' },
      ]);
      expect(parsed.rawText).toContain('Alice');
      expect(parsed.rawText).toContain('Bob');
    });

    it('should handle CSV with quotes and commas within fields', async () => {
      const filePath = join(tempDir, 'quotes.csv');
      const csvContent = 'City,"Description, Notes",Population\n"New York, NY","The Big Apple, USA",8300000\n';
      writeFileSync(filePath, csvContent, 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('csv');
      const records = parsed.structuredData as Array<Record<string, string>>;
      expect(records).toHaveLength(1);
      expect(records[0]['City']).toBe('New York, NY');
      expect(records[0]['Description, Notes']).toBe('The Big Apple, USA');
      expect(records[0]['Population']).toBe('8300000');
    });

    it('should handle empty CSV files', async () => {
      const filePath = join(tempDir, 'empty.csv');
      writeFileSync(filePath, '', 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('csv');
      expect(parsed.structuredData).toEqual([]);
      expect(parsed.rawText).toBe('CSV file is empty.');
    });
  });

  describe('HTML Document Parsing', () => {
    it('should extract text blocks and title while ignoring script and style tags', async () => {
      const filePath = join(tempDir, 'article.html');
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Article Page</title>
            <style>body { color: red; }</style>
            <script>console.log("ignore me");</script>
          </head>
          <body>
            <nav><a href="/">Home</a></nav>
            <main>
              <h1>Deep Sea Exploration</h1>
              <p>Autonomous submersibles explore the Mariana Trench at depths exceeding 10,000 meters.</p>
            </main>
          </body>
        </html>
      `;
      writeFileSync(filePath, htmlContent, 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('html');
      expect(parsed.metadata?.title).toBe('Test Article Page');
      expect(parsed.rawText).toContain('Deep Sea Exploration');
      expect(parsed.rawText).toContain('Autonomous submersibles explore the Mariana Trench');
      expect(parsed.rawText).not.toContain('color: red');
      expect(parsed.rawText).not.toContain('console.log');
    });
  });

  describe('Plain Text and Markdown Parsing', () => {
    it('should parse TXT and MD files with character, word, and line count', async () => {
      const filePath = join(tempDir, 'notes.md');
      const mdContent = '# Odysseus Notes\n\n- Fact A\n- Fact B\n- Fact C\n';
      writeFileSync(filePath, mdContent, 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('txt');
      expect(parsed.rawText).toBe(mdContent);
      expect(parsed.metadata?.lineCount).toBeGreaterThanOrEqual(4);
      expect(parsed.metadata?.wordCount).toBeGreaterThan(0);
    });
  });

  describe('PDF Parsing (Zero-Dependency FlateDecode)', () => {
    it('should decompress FlateDecode streams and extract textual BT ... ET operators', async () => {
      const filePath = join(tempDir, 'synthetic.pdf');

      // Create a minimalist valid PDF stream containing text operators: BT (Hello Odysseus PDF) Tj ET
      const textStreamContent = 'BT /F1 12 Tf 72 712 Td (Hello Odysseus PDF) Tj ET';
      const compressedStream = deflateSync(Buffer.from(textStreamContent, 'utf-8'));

      const pdfBuffer = Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressedStream.length + ' /Filter /FlateDecode >>\nstream\n'),
        compressedStream,
        Buffer.from('\nendstream\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n120\n%%EOF\n'),
      ]);

      writeFileSync(filePath, pdfBuffer);

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('pdf');
      expect(parsed.rawText).toContain('Hello Odysseus PDF');
      expect(parsed.metadata?.streamsDecompressed).toBeGreaterThanOrEqual(1);
    });

    it('should handle uncompressed raw PDF text streams', async () => {
      const filePath = join(tempDir, 'uncompressed.pdf');
      const uncompressedPdf = `%PDF-1.4
1 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
(Plain text PDF extraction) Tj
ET
endstream
endobj
%%EOF`;
      writeFileSync(filePath, uncompressedPdf, 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('pdf');
      expect(parsed.rawText).toContain('Plain text PDF extraction');
    });
  });

  describe('Error and Fallback Handling', () => {
    it('should throw when the file does not exist', async () => {
      await expect(parser.parse(join(tempDir, 'nonexistent.xyz'))).rejects.toThrow('File not found');
    });

    it('should parse unknown file extensions as fallback text', async () => {
      const filePath = join(tempDir, 'sample.customdata');
      writeFileSync(filePath, 'key=value\nfoo=bar\n', 'utf-8');

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('unknown');
      expect(parsed.rawText).toContain('key=value');
    });

    it('should detect binary files and return structured binary summary without corrupting text', async () => {
      const filePath = join(tempDir, 'binary.dat');
      const binaryData = Buffer.from([0x00, 0xff, 0xfe, 0x12, 0x00, 0x41, 0x42]);
      writeFileSync(filePath, binaryData);

      const parsed = await parser.parse(filePath);
      expect(parsed.fileType).toBe('unknown');
      expect(parsed.rawText).toContain('[Binary File: binary.dat');
      expect(parsed.metadata?.isBinary).toBe(true);
    });
  });
});
