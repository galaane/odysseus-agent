import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, Locator } from 'playwright-core';
import { ElementRegistry } from '../../src/observer/ElementRegistry.js';
import { BrowserError, ErrorCodes } from '../../src/browser/BrowserError.js';

describe('ElementRegistry Subsystem', () => {
  let registry: ElementRegistry;
  let mockPage: Page;
  let mockLocator: Locator;

  beforeEach(() => {
    registry = new ElementRegistry();
    mockLocator = {
      click: vi.fn(),
      fill: vi.fn(),
    } as unknown as Locator;

    mockPage = {
      getByRole: vi.fn(() => mockLocator),
      getByText: vi.fn(() => mockLocator),
      getByTestId: vi.fn(() => mockLocator),
      locator: vi.fn(() => mockLocator),
    } as unknown as Page;

    registry.reset(mockPage);
  });

  it('should allocate monotonic transient IDs (el_001, el_002, el_003)', () => {
    const id1 = registry.register({
      role: 'button',
      name: 'Sign In',
      locatorStrategy: { type: 'role', selector: 'button', options: { name: 'Sign In' } },
    });
    const id2 = registry.register({
      role: 'textbox',
      name: 'Email',
      locatorStrategy: { type: 'role', selector: 'textbox', options: { name: 'Email' } },
    });
    const id3 = registry.register({
      role: 'link',
      name: 'Help',
      locatorStrategy: { type: 'text', selector: 'Help' },
    });

    expect(id1).toBe('el_001');
    expect(id2).toBe('el_002');
    expect(id3).toBe('el_003');
    expect(registry.size).toBe(3);

    const el1 = registry.get('el_001');
    expect(el1).toBeDefined();
    expect(el1?.name).toBe('Sign In');
  });

  it('should resolve locator by role correctly', () => {
    const id = registry.register({
      role: 'button',
      name: 'Submit',
      locatorStrategy: { type: 'role', selector: 'button', options: { name: 'Submit', exact: false } },
    });

    const locator = registry.resolveLocator(id);
    expect(locator).toBe(mockLocator);
    expect(mockPage.getByRole).toHaveBeenCalledWith('button', { name: 'Submit', exact: false });
  });

  it('should resolve locator by text correctly', () => {
    const id = registry.register({
      role: 'link',
      name: 'Contact Us',
      locatorStrategy: { type: 'text', selector: 'Contact Us', options: { exact: true } },
    });

    const locator = registry.resolveLocator(id);
    expect(locator).toBe(mockLocator);
    expect(mockPage.getByText).toHaveBeenCalledWith('Contact Us', { exact: true });
  });

  it('should resolve locator by testid correctly', () => {
    const id = registry.register({
      role: 'textbox',
      name: 'Password Input',
      locatorStrategy: { type: 'testid', selector: 'password-input' },
    });

    const locator = registry.resolveLocator(id);
    expect(locator).toBe(mockLocator);
    expect(mockPage.getByTestId).toHaveBeenCalledWith('password-input');
  });

  it('should resolve locator by css correctly', () => {
    const id = registry.register({
      role: 'checkbox',
      name: 'Remember Me',
      locatorStrategy: { type: 'css', selector: '#remember-me' },
    });

    const locator = registry.resolveLocator(id);
    expect(locator).toBe(mockLocator);
    expect(mockPage.locator).toHaveBeenCalledWith('#remember-me');
  });

  it('should throw BrowserError(ELEMENT_NOT_FOUND) when element ID is invalid', () => {
    expect(() => registry.resolveLocator('el_999')).toThrowError(BrowserError);
    try {
      registry.resolveLocator('el_999');
    } catch (err) {
      const bErr = err as BrowserError;
      expect(bErr.code).toBe(ErrorCodes.ELEMENT_NOT_FOUND);
    }
  });

  it('should throw BrowserError(ELEMENT_NOT_FOUND) when page is not set', () => {
    registry.clear();
    expect(() => registry.resolveLocator('el_001')).toThrowError(BrowserError);
  });

  it('should reset registry on page reload / navigation', () => {
    registry.register({
      role: 'button',
      name: 'Old Button',
      locatorStrategy: { type: 'css', selector: '.btn' },
    });
    expect(registry.size).toBe(1);

    const newMockPage = {
      getByRole: vi.fn(),
      locator: vi.fn(),
    } as unknown as Page;

    registry.reset(newMockPage);
    expect(registry.size).toBe(0);
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.get('el_001')).toBeUndefined();
  });
});
