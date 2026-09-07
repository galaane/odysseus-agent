import type { RegisteredElement } from './ElementRegistry.js';
import type { NetworkSummary } from './NetworkObserver.js';

export interface PageSummary {
  headings: string[];
  forms: Array<{ formId?: string; fields: string[] }>;
  links: Array<{ id: string; text: string; href?: string }>;
  notices?: string[];
  tables?: Array<{ headers: string[]; rowCount: number }>;
}

export interface PageSnapshot {
  timestamp: string;
  url: string;
  title: string;
  activeTabId: string;
  interactiveElements: RegisteredElement[];
  pageSummary: PageSummary;
  compressedObservationText: string;
  networkSummary?: NetworkSummary;
}
