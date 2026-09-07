import type { Page } from 'playwright-core';
import type { KeystrokeOptions, EntropyMode } from './types.js';
import type { Logger } from '../logging/Logger.js';

export class KeystrokeJitterEngine {
  constructor(private readonly logger?: Logger) {}

  /**
   * Calculates realistic human keystroke delay with Gaussian-approximated distribution
   * and linguistic cognitive boundaries (spaces, punctuation).
   */
  public calculateKeystrokeDelay(char: string, options?: KeystrokeOptions): number {
    const mode: EntropyMode = options?.mode || 'natural_human';
    if (mode === 'fast') return 0;

    const minDelay = options?.minDelayMs ?? (mode === 'deliberate' ? 60 : 35);
    const maxDelay = options?.maxDelayMs ?? (mode === 'deliberate' ? 160 : 110);

    // Approximate Gaussian via Central Limit Theorem (mean of 2 random uniform samples)
    const baseJitter = (Math.random() + Math.random()) / 2;
    let delay = minDelay + (maxDelay - minDelay) * baseJitter;

    // Cognitive pauses on word boundaries and punctuation
    const cognitivePauses = options?.cognitivePauseWord ?? true;
    if (cognitivePauses) {
      if (char === ' ') {
        // Space bar: thinking pause between words (80ms to 180ms extra)
        delay += 80 + Math.random() * 100;
      } else if (['.', ',', '!', '?', ';', ':'].includes(char)) {
        // Sentence/clause terminator pause (120ms to 250ms extra)
        delay += 120 + Math.random() * 130;
      } else if (/[0-9]/.test(char)) {
        // Numbers require slightly more visual targeting
        delay += 20 + Math.random() * 30;
      }
    }

    return Math.round(delay);
  }

  /**
   * Computes a full sequence of characters and their delays for testing or pre-planning.
   */
  public getTypingSchedule(
    text: string,
    options?: KeystrokeOptions
  ): Array<{ char: string; delayMs: number }> {
    return Array.from(text).map((char) => ({
      char,
      delayMs: this.calculateKeystrokeDelay(char, options),
    }));
  }

  /**
   * Types text organically into the active focused element on the page.
   */
  public async typeText(
    page: Page,
    text: string,
    options?: KeystrokeOptions
  ): Promise<void> {
    if (!text) return;

    const mode: EntropyMode = options?.mode || 'natural_human';
    if (mode === 'fast') {
      await page.keyboard.type(text, { delay: 0 });
      return;
    }

    const schedule = this.getTypingSchedule(text, options);

    for (const item of schedule) {
      await page.keyboard.type(item.char, { delay: 0 });
      if (item.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, item.delayMs));
      }
    }
  }
}
