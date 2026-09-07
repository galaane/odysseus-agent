import { SourceTracker } from './SourceTracker.js';
import { DocumentParser, type ParsedDocument } from './DocumentParser.js';
import { calculateDomainCorroboration, type Finding } from './Finding.js';
import type { Source } from './Source.js';
import type { Evidence } from './Evidence.js';
import type { Logger } from '../logging/Logger.js';

export interface ResearchReport {
  topic: string;
  generatedAt: string;
  totalSources: number;
  uniqueDomains: number;
  findings: Finding[];
  sources: Source[];
  summaryText: string;
}

export class ResearchEngine {
  private tracker = new SourceTracker();
  private parser = new DocumentParser();
  private findings: Map<string, Finding> = new Map();
  private evidenceItems: Evidence[] = [];
  private findingCounter = 0;
  private evidenceCounter = 0;

  constructor(private readonly logger?: Logger) {}

  public getSourceTracker(): SourceTracker {
    return this.tracker;
  }

  public getDocumentParser(): DocumentParser {
    return this.parser;
  }

  /**
   * Records a visited URL source.
   */
  public recordSource(url: string, title?: string, relevance?: number): Source {
    const source = this.tracker.recordSource(url, title, relevance);
    this.logger?.debug('ResearchEngine', `Recorded source: ${url} (${source.domain})`);
    return source;
  }

  /**
   * Registers a research claim/finding linked to source URLs with automated corroboration scoring.
   */
  public addFinding(
    claim: string,
    sourceUrls: string[],
    options?: { notes?: string; snippet?: string }
  ): Finding {
    this.findingCounter++;
    const id = `find_${String(this.findingCounter).padStart(3, '0')}`;

    // Ensure all source URLs are recorded
    const matchedSources: Source[] = [];
    const sourceIds: string[] = [];

    for (const url of sourceUrls) {
      let src = this.tracker.getSourceByUrl(url);
      if (!src) {
        src = this.tracker.recordSource(url);
      }
      matchedSources.push(src);
      sourceIds.push(src.id);
    }

    const confidence = calculateDomainCorroboration(matchedSources);

    const finding: Finding = {
      id,
      claim: claim.trim(),
      sourceIds,
      confidence,
      notes: options?.notes,
      createdAt: new Date().toISOString(),
    };

    this.findings.set(id, finding);

    // Record evidence snippet if provided
    if (options?.snippet && sourceIds.length > 0) {
      this.evidenceCounter++;
      this.evidenceItems.push({
        id: `evi_${String(this.evidenceCounter).padStart(3, '0')}`,
        findingId: id,
        sourceId: sourceIds[0],
        snippet: options.snippet.trim(),
        extractedAt: new Date().toISOString(),
      });
    }

    this.logger?.info('ResearchEngine', `Registered finding: "${claim}" (Confidence: ${confidence}, Domains: ${matchedSources.length})`);
    return finding;
  }

  public getFindings(): Finding[] {
    return Array.from(this.findings.values());
  }

  public getEvidence(): Evidence[] {
    return [...this.evidenceItems];
  }

  public getEvidenceForFinding(findingId: string): Evidence[] {
    return this.evidenceItems.filter((e) => e.findingId === findingId);
  }

  /**
   * Generates a structured research synthesis report (alias for synthesizeReport).
   */
  public generateReport(topic = 'Autonomous Research Synthesis'): ResearchReport {
    return this.synthesizeReport(topic);
  }

  /**
   * Parses a downloaded file and registers its textual insights into research context.
   */
  public async processDownloadedDocument(filePath: string, sourceUrl?: string): Promise<ParsedDocument> {
    this.logger?.info('ResearchEngine', `Processing downloaded document at: ${filePath}`);
    const doc = await this.parser.parse(filePath);

    if (sourceUrl) {
      const src = this.tracker.recordSource(sourceUrl, doc.fileName);
      this.addFinding(`Document ${doc.fileName} parsed (${doc.fileType}) with ${doc.rawText.length} characters of content.`, [sourceUrl], {
        notes: `Extracted from downloaded file ${doc.fileName}`,
        snippet: doc.rawText.slice(0, 300),
      });
      this.logger?.info('ResearchEngine', `Linked downloaded document ${doc.fileName} to source: ${src.url}`);
    }

    return doc;
  }

  /**
   * Generates a structured research synthesis report across all captured findings and sources.
   */
  public synthesizeReport(topic = 'Autonomous Research Synthesis'): ResearchReport {
    const findings = this.getFindings();
    const sources = this.tracker.getAllSources();
    const uniqueDomains = this.tracker.getUniqueDomains();

    const summaryLines: string[] = [
      `# Research Report: ${topic}`,
      `Generated: ${new Date().toISOString()}`,
      `Total Sources: ${sources.length} | Independent Domains: ${uniqueDomains.length} (${uniqueDomains.join(', ')})`,
      '',
      '## Key Findings & Claims',
    ];

    if (findings.length === 0) {
      summaryLines.push('No verified findings recorded.');
    } else {
      for (const [i, f] of findings.entries()) {
        const citedSources = f.sourceIds
          .map((id) => this.tracker.getSource(id)?.url)
          .filter(Boolean)
          .join(', ');

        summaryLines.push(
          `${i + 1}. **${f.claim}**`,
          `   - Confidence: ${((f.confidence ?? 1) * 100).toFixed(1)}%`,
          `   - Sources: ${citedSources || 'Unknown'}`,
          f.notes ? `   - Notes: ${f.notes}` : ''
        );
      }
    }

    return {
      topic,
      generatedAt: new Date().toISOString(),
      totalSources: sources.length,
      uniqueDomains: uniqueDomains.length,
      findings,
      sources,
      summaryText: summaryLines.filter(Boolean).join('\n'),
    };
  }

  public clear(): void {
    this.tracker.clear();
    this.findings.clear();
    this.evidenceItems = [];
    this.findingCounter = 0;
    this.evidenceCounter = 0;
  }
}
