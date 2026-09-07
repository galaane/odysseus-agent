import type { Page, Route } from 'playwright-core';
import type { ChaosProfile, ChaosFaultType } from './types.js';
import type { Logger } from '../logging/Logger.js';

export class ChaosInjector {
  private injectedFaults: ChaosFaultType[] = [];
  private activeTeardowns: Array<() => Promise<void>> = [];

  constructor(private readonly logger?: Logger) {}

  public getInjectedFaults(): ChaosFaultType[] {
    return [...this.injectedFaults];
  }

  public clearInjectedFaults(): void {
    this.injectedFaults = [];
  }

  /**
   * Attaches Playwright network interception to simulate latency and non-critical HTTP 500s.
   */
  public async attachNetworkChaos(page: Page, profile: ChaosProfile): Promise<() => Promise<void>> {
    const hasLatency = profile.activeFaults.includes('network_latency');
    const has500 = profile.activeFaults.includes('network_500');

    if (!hasLatency && !has500) {
      return async () => {};
    }

    const handler = async (route: Route) => {
      const request = route.request();
      const url = request.url();

      // Check for simulated HTTP 500 on secondary / non-critical endpoints
      if (
        has500 &&
        Math.random() < profile.faultProbability &&
        (url.includes('/api/recommendations') ||
          url.includes('/api/analytics') ||
          url.includes('/api/metrics') ||
          url.includes('/telemetry'))
      ) {
        this.injectedFaults.push('network_500');
        this.logger?.warn('ChaosInjector', `Simulated HTTP 500 error injected for: ${url}`);
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Chaos injected internal server error' }),
        });
      }

      // Check for artificial network latency
      if (hasLatency && Math.random() < profile.faultProbability) {
        const min = profile.networkLatencyMs?.min || 300;
        const max = profile.networkLatencyMs?.max || 1200;
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;

        this.injectedFaults.push('network_latency');
        this.logger?.debug('ChaosInjector', `Injecting artificial delay of ${delay}ms for: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      return route.continue();
    };

    await page.route('**/*', handler);

    const teardown = async () => {
      try {
        await page.unroute('**/*', handler);
      } catch {
        // Ignore teardown errors if page closed
      }
    };

    this.activeTeardowns.push(teardown);
    return teardown;
  }

  /**
   * Injects an unexpected modal or banner obstruction into the test site DOM.
   */
  public async injectModalOverlay(
    page: Page,
    type: 'cookie' | 'promo' = 'cookie'
  ): Promise<boolean> {
    try {
      if (type === 'cookie') {
        await page.evaluate(() => {
          if (document.getElementById('chaos-cookie-banner')) return;
          const banner = document.createElement('div');
          banner.id = 'chaos-cookie-banner';
          banner.setAttribute('role', 'dialog');
          banner.setAttribute('aria-label', 'Cookie Consent Notice');
          banner.style.cssText = `
            position: fixed; bottom: 0; left: 0; right: 0; z-index: 99999;
            background: #1e293b; color: white; padding: 20px; text-align: center;
            box-shadow: 0 -4px 12px rgba(0,0,0,0.3); font-family: sans-serif;
          `;
          banner.innerHTML = `
            <p style="margin: 0 0 10px 0; font-size: 14px;">We use essential cookies to ensure optimal functionality.</p>
            <button id="chaos-cookie-dismiss" style="padding: 8px 18px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
              Accept All
            </button>
          `;
          document.body.appendChild(banner);
          const btn = document.getElementById('chaos-cookie-dismiss');
          btn?.addEventListener('click', () => banner.remove());
        });
        this.injectedFaults.push('cookie_banner_injection');
      } else {
        await page.evaluate(() => {
          if (document.getElementById('chaos-promo-modal')) return;
          const backdrop = document.createElement('div');
          backdrop.id = 'chaos-promo-modal';
          backdrop.setAttribute('role', 'dialog');
          backdrop.setAttribute('aria-label', 'Special Promotional Offer');
          backdrop.style.cssText = `
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
          `;
          backdrop.innerHTML = `
            <div style="background: white; padding: 28px; border-radius: 8px; max-width: 400px; text-align: center; position: relative;">
              <button id="chaos-promo-close" aria-label="Close" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 18px; cursor: pointer;">✕</button>
              <h3 style="margin-top: 0; color: #0f172a;">Exclusive 20% Discount</h3>
              <p style="color: #64748b;">Subscribe today to claim your discount voucher.</p>
            </div>
          `;
          document.body.appendChild(backdrop);
          const closeBtn = document.getElementById('chaos-promo-close');
          closeBtn?.addEventListener('click', () => backdrop.remove());
        });
        this.injectedFaults.push('promo_modal_injection');
      }

      this.logger?.info('ChaosInjector', `Injected surprise ${type} overlay into DOM`);
      return true;
    } catch (err) {
      this.logger?.warn('ChaosInjector', `Failed to inject modal overlay: ${String(err)}`);
      return false;
    }
  }

  /**
   * Mutates DOM class names or dynamic IDs to stress-test ElementRegistry & Self-Healing.
   */
  public async mutateDomAttributes(page: Page, selector: string, prefix = 'mutated_'): Promise<boolean> {
    try {
      const mutated = await page.evaluate(
        ({ sel, pfx }) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          if (el.id) {
            el.id = `${pfx}${el.id}`;
          }
          if (el.className) {
            el.className = `${pfx}${el.className}`;
          }
          return true;
        },
        { sel: selector, pfx: prefix }
      );

      if (mutated) {
        this.injectedFaults.push('dom_mutation');
        this.logger?.info('ChaosInjector', `Mutated DOM attributes on selector [${selector}]`);
      }
      return mutated;
    } catch {
      return false;
    }
  }

  /**
   * Temporarily removes and re-inserts a DOM element to verify Playwright locator recovery.
   */
  public async simulateStaleElement(page: Page, selector: string): Promise<boolean> {
    try {
      const detached = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || !el.parentElement) return false;
        const parent = el.parentElement;
        const next = el.nextSibling;
        parent.removeChild(el);
        setTimeout(() => {
          parent.insertBefore(el, next);
        }, 150);
        return true;
      }, selector);

      if (detached) {
        this.injectedFaults.push('stale_element');
        this.logger?.info('ChaosInjector', `Simulated stale/detached element cycle on [${selector}]`);
      }
      return detached;
    } catch {
      return false;
    }
  }

  /**
   * Evaluates current step and probabilistically injects an active chaos fault.
   */
  public async stepPerturbation(page: Page, profile: ChaosProfile): Promise<ChaosFaultType | null> {
    if (profile.activeFaults.length === 0) return null;
    if (Math.random() > profile.faultProbability) return null;

    // Pick random fault from active list
    const candidateFaults = profile.activeFaults.filter(
      (f) => f !== 'network_latency' && f !== 'network_500' // handled via route interception
    );

    if (candidateFaults.length === 0) return null;

    const chosenFault = candidateFaults[Math.floor(Math.random() * candidateFaults.length)];

    switch (chosenFault) {
      case 'cookie_banner_injection':
        await this.injectModalOverlay(page, 'cookie');
        return 'cookie_banner_injection';
      case 'promo_modal_injection':
        await this.injectModalOverlay(page, 'promo');
        return 'promo_modal_injection';
      case 'dom_mutation':
        await this.mutateDomAttributes(page, 'button, a, input');
        return 'dom_mutation';
      case 'stale_element':
        await this.simulateStaleElement(page, 'button');
        return 'stale_element';
      default:
        return null;
    }
  }

  /**
   * Tears down all active network interceptions and cleanups.
   */
  public async teardown(): Promise<void> {
    for (const teardown of this.activeTeardowns) {
      await teardown().catch(() => {});
    }
    this.activeTeardowns = [];
  }
}
