import type { TabState } from './BrowserEvents.js';

export interface BrowserState {
  connected: boolean;
  currentTabId: string | null;
  tabs: TabState[];
  currentUrl: string | null;
  pageTitle: string | null;
}
