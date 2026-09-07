import { EventEmitter } from 'node:events';

export interface TabState {
  id: string; // e.g. "tab_001"
  url: string;
  title: string;
  active: boolean;
  createdAt: string;
}

export interface DialogEventData {
  type: string;
  message: string;
  defaultPrompt?: string;
  tabId?: string;
}

export interface DownloadEventData {
  filename: string;
  downloadId: string;
  path?: string;
  fileSize?: number;
  url?: string;
  tabId?: string;
  taskId?: string;
}

export type BrowserEventMap = {
  'browser.started': void;
  'browser.stopped': void;
  'tab.created': TabState;
  'tab.closed': { tabId: string };
  'tab.activated': TabState;
  'navigation.started': { tabId: string; url: string };
  'navigation.completed': { tabId: string; url: string; title: string };
  'dialog.opened': DialogEventData;
  'download.started': DownloadEventData;
  'download.completed': DownloadEventData;
};

export class BrowserEventEmitter extends EventEmitter {
  public emitEvent<K extends keyof BrowserEventMap>(
    event: K,
    ...args: BrowserEventMap[K] extends void ? [] : [BrowserEventMap[K]]
  ): boolean {
    return this.emit(event, ...args);
  }

  public onEvent<K extends keyof BrowserEventMap>(
    event: K,
    listener: (data: BrowserEventMap[K]) => void
  ): this {
    return this.on(event, listener as (...args: unknown[]) => void);
  }

  public onceEvent<K extends keyof BrowserEventMap>(
    event: K,
    listener: (data: BrowserEventMap[K]) => void
  ): this {
    return this.once(event, listener as (...args: unknown[]) => void);
  }
}
