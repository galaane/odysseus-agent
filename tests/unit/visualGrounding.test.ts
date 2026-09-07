import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { SetOfMarksAnnotator } from '../../src/observer/SetOfMarksAnnotator.js';
import { ScreenshotObserver } from '../../src/observer/ScreenshotObserver.js';
import type { RegisteredElement } from '../../src/observer/ElementRegistry.js';

describe('Phase 24: Visual Set-of-Marks (SoM) Grounding Subsystem', () => {
  const sampleElements: RegisteredElement[] = [
    {
      id: 'el_001',
      role: 'button',
      name: 'Submit Application',
      isInViewport: true,
      boundingBox: { x: 100, y: 150, width: 120, height: 40 },
      locatorStrategy: { type: 'role', selector: 'button' },
    },
    {
      id: 'el_002',
      role: 'textbox',
      name: 'User Email',
      isInViewport: true,
      boundingBox: { x: 100, y: 10, width: 200, height: 35 }, // near top edge
      locatorStrategy: { type: 'role', selector: 'textbox' },
    },
    {
      id: 'el_003',
      role: 'link',
      name: 'Footer Link',
      isInViewport: false, // out of viewport
      boundingBox: { x: 50, y: 1200, width: 80, height: 20 },
      locatorStrategy: { type: 'role', selector: 'link' },
    },
    {
      id: 'el_004',
      role: 'link',
      name: 'Invisible Link',
      isInViewport: true,
      boundingBox: { x: 0, y: 0, width: 0, height: 0 }, // zero size
      locatorStrategy: { type: 'role', selector: 'link' },
    },
    {
      id: 'el_005',
      role: 'button',
      name: 'No Bounding Box',
      isInViewport: true,
      locatorStrategy: { type: 'role', selector: 'button' },
    },
  ];

  describe('SetOfMarksAnnotator.filterAnnotatableElements', () => {
    it('should filter only in-viewport elements with non-zero bounding box dimensions', () => {
      const annotator = new SetOfMarksAnnotator();
      const filtered = annotator.filterAnnotatableElements(sampleElements);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.id)).toEqual(['el_001', 'el_002']);
      expect(filtered[0]).toEqual({
        id: 'el_001',
        x: 100,
        y: 150,
        width: 120,
        height: 40,
      });
    });

    it('should return empty array if no elements have bounding boxes', () => {
      const annotator = new SetOfMarksAnnotator();
      const filtered = annotator.filterAnnotatableElements([sampleElements[4]]);
      expect(filtered).toEqual([]);
    });
  });

  describe('SetOfMarksAnnotator.inject and remove', () => {
    it('should execute DOM injection script via page.evaluate', async () => {
      const annotator = new SetOfMarksAnnotator();
      let evaluatedScript: unknown = null;
      let evaluatedArgs: unknown = null;

      const mockPage = {
        evaluate: vi.fn().mockImplementation(async (fn, args) => {
          evaluatedScript = fn;
          evaluatedArgs = args;
          return undefined;
        }),
      } as unknown as Page;

      const count = await annotator.inject(mockPage, sampleElements);

      expect(count).toBe(2);
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      expect(evaluatedArgs).toEqual({
        containerId: SetOfMarksAnnotator.OVERLAY_CONTAINER_ID,
        items: [
          { id: 'el_001', x: 100, y: 150, width: 120, height: 40 },
          { id: 'el_002', x: 100, y: 10, width: 200, height: 35 },
        ],
      });
    });

    it('should execute DOM removal script via page.evaluate', async () => {
      const annotator = new SetOfMarksAnnotator();
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;

      await annotator.remove(mockPage);

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        SetOfMarksAnnotator.OVERLAY_CONTAINER_ID
      );
    });

    it('should soft-fail gracefully if page.evaluate throws', async () => {
      const annotator = new SetOfMarksAnnotator();
      const mockPage = {
        evaluate: vi.fn().mockRejectedValue(new Error('Context destroyed')),
      } as unknown as Page;

      const count = await annotator.inject(mockPage, sampleElements);
      expect(count).toBe(0);

      await expect(annotator.remove(mockPage)).resolves.not.toThrow();
    });
  });

  describe('SetOfMarksAnnotator.annotateAndCapture', () => {
    it('should clean up overlay in finally block even if capture function throws', async () => {
      const annotator = new SetOfMarksAnnotator();
      const removeSpy = vi.spyOn(annotator, 'remove').mockResolvedValue();
      const injectSpy = vi.spyOn(annotator, 'inject').mockResolvedValue(2);

      const mockPage = {} as Page;

      await expect(
        annotator.annotateAndCapture(mockPage, sampleElements, async () => {
          throw new Error('Screenshot failed unexpectedly');
        })
      ).rejects.toThrow('Screenshot failed unexpectedly');

      expect(injectSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy).toHaveBeenCalledTimes(1);
    });

    it('should return capture result when successful and remove overlay', async () => {
      const annotator = new SetOfMarksAnnotator();
      const removeSpy = vi.spyOn(annotator, 'remove').mockResolvedValue();
      const injectSpy = vi.spyOn(annotator, 'inject').mockResolvedValue(2);

      const mockPage = {} as Page;

      const result = await annotator.annotateAndCapture(mockPage, sampleElements, async () => {
        return 'mock-annotated-base64-content';
      });

      expect(result).toBe('mock-annotated-base64-content');
      expect(injectSpy).toHaveBeenCalledTimes(1);
      expect(removeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('ScreenshotObserver.captureAnnotatedBase64', () => {
    it('should capture Base64 screenshot with Set-of-Marks annotation', async () => {
      const observer = new ScreenshotObserver();
      const mockBuffer = Buffer.from('mock-annotated-png-binary');

      const mockPage = {
        evaluate: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(mockBuffer),
      } as unknown as Page;

      const base64 = await observer.captureAnnotatedBase64(mockPage, sampleElements);

      expect(base64).toBe(mockBuffer.toString('base64'));
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        fullPage: false,
        type: 'png',
      });
      // Verify evaluate called for inject and remove
      expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    });

    it('should throw BROWSER_NOT_CONNECTED if page is null', async () => {
      const observer = new ScreenshotObserver();
      await expect(
        observer.captureAnnotatedBase64(null as unknown as Page, sampleElements)
      ).rejects.toThrow('Cannot capture screenshot: page is null');
    });
  });
});
