import { describe, it, expect } from 'vitest';
import { SpatialAttentionFilter } from '../../src/observer/SpatialAttentionFilter.js';
import { ObservationCompressor } from '../../src/observer/ObservationCompressor.js';
import { ElementRegistry, type RegisteredElement } from '../../src/observer/ElementRegistry.js';
import type { PageSummary } from '../../src/observer/PageSnapshot.js';

describe('Spatial Attention & Viewport-Aware DOM Pruning (Phase 23)', () => {
  const filter = new SpatialAttentionFilter();
  const compressor = new ObservationCompressor();

  it('should correctly partition elements based on viewport visibility', () => {
    const elements: RegisteredElement[] = [
      {
        id: 'el_001',
        role: 'button',
        name: 'Header Menu',
        isInViewport: true,
        boundingBox: { x: 10, y: 10, width: 100, height: 40 },
        locatorStrategy: { type: 'role', selector: 'button' },
      },
      {
        id: 'el_002',
        role: 'textbox',
        name: 'Search',
        isInViewport: true,
        boundingBox: { x: 120, y: 10, width: 200, height: 40 },
        locatorStrategy: { type: 'role', selector: 'textbox' },
      },
      {
        id: 'el_003',
        role: 'link',
        name: 'Footer Privacy',
        isInViewport: false,
        boundingBox: { x: 10, y: 1800, width: 120, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
    ];

    const partition = filter.partition(elements);
    expect(partition.hasSpatialMetadata).toBe(true);
    expect(partition.inViewport).toHaveLength(2);
    expect(partition.outOfViewport).toHaveLength(1);
    expect(partition.inViewport[0].id).toBe('el_001');
    expect(partition.outOfViewport[0].id).toBe('el_003');
  });

  it('should fallback gracefully when spatial metadata is absent', () => {
    const elements: RegisteredElement[] = [
      {
        id: 'el_001',
        role: 'button',
        name: 'Submit',
        locatorStrategy: { type: 'role', selector: 'button' },
      },
    ];

    const partition = filter.partition(elements);
    expect(partition.hasSpatialMetadata).toBe(false);
    expect(partition.inViewport).toHaveLength(1);
    expect(partition.outOfViewport).toHaveLength(0);
  });

  it('should cluster consecutive out-of-viewport links while preserving buttons', () => {
    const elements: RegisteredElement[] = [
      // 5 out-of-viewport footer links
      {
        id: 'el_010',
        role: 'link',
        name: 'About',
        isInViewport: false,
        boundingBox: { x: 10, y: 2000, width: 80, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      {
        id: 'el_011',
        role: 'link',
        name: 'Careers',
        isInViewport: false,
        boundingBox: { x: 100, y: 2000, width: 80, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      {
        id: 'el_012',
        role: 'link',
        name: 'Press',
        isInViewport: false,
        boundingBox: { x: 190, y: 2000, width: 80, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      {
        id: 'el_013',
        role: 'link',
        name: 'Contact',
        isInViewport: false,
        boundingBox: { x: 280, y: 2000, width: 80, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      {
        id: 'el_014',
        role: 'link',
        name: 'Sitemap',
        isInViewport: false,
        boundingBox: { x: 370, y: 2000, width: 80, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      // Action button below fold
      {
        id: 'el_015',
        role: 'button',
        name: 'Load More Results',
        isInViewport: false,
        boundingBox: { x: 200, y: 1500, width: 150, height: 40 },
        locatorStrategy: { type: 'role', selector: 'button' },
      },
    ];

    const clustered = filter.clusterOutOfViewport(elements, 4);
    expect(clustered).toHaveLength(2);
    // First is the cluster of 5 links
    expect(clustered[0].type).toBe('cluster');
    expect(clustered[0].clusterStartId).toBe('el_010');
    expect(clustered[0].clusterEndId).toBe('el_014');
    expect(clustered[0].clusterCount).toBe(5);
    expect(clustered[0].approximateY).toBe(2000);

    // Second is the preserved action button
    expect(clustered[1].type).toBe('single');
    expect(clustered[1].element?.id).toBe('el_015');
    expect(clustered[1].element?.name).toBe('Load More Results');
  });

  it('should format observations with prioritized in-viewport elements and clustered outside-viewport elements', () => {
    const elements: RegisteredElement[] = [
      {
        id: 'el_001',
        role: 'textbox',
        name: 'Search items',
        value: 'laptop',
        isInViewport: true,
        boundingBox: { x: 50, y: 20, width: 250, height: 35 },
        locatorStrategy: { type: 'role', selector: 'textbox' },
      },
      {
        id: 'el_002',
        role: 'button',
        name: 'Filter',
        isInViewport: true,
        boundingBox: { x: 310, y: 20, width: 80, height: 35 },
        locatorStrategy: { type: 'role', selector: 'button' },
      },
      // 4 footer links below viewport
      {
        id: 'el_003',
        role: 'link',
        name: 'Terms',
        isInViewport: false,
        boundingBox: { x: 10, y: 2500, width: 50, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      {
        id: 'el_004',
        role: 'link',
        name: 'Privacy',
        isInViewport: false,
        boundingBox: { x: 70, y: 2500, width: 50, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      {
        id: 'el_005',
        role: 'link',
        name: 'Cookies',
        isInViewport: false,
        boundingBox: { x: 130, y: 2500, width: 50, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
      {
        id: 'el_006',
        role: 'link',
        name: 'Legal',
        isInViewport: false,
        boundingBox: { x: 190, y: 2500, width: 50, height: 20 },
        locatorStrategy: { type: 'role', selector: 'link' },
      },
    ];

    const summary: PageSummary = {
      headings: ['Heading 1: "Product Catalog"'],
      forms: [],
      links: [],
      notices: [],
    };

    const text = compressor.compress({
      title: 'Store Catalog',
      url: 'https://store.example.com/catalog',
      elements,
      summary,
    });

    expect(text).toContain('Interactive Elements:');
    expect(text).toContain('[In Viewport]:');
    expect(text).toContain('- [el_001] textbox "Search items" (current: "laptop")');
    expect(text).toContain('- [el_002] button "Filter"');
    expect(text).toContain('[Outside Viewport - Scroll to Access]:');
    expect(text).toContain('- [el_003 - el_006] 4 links outside viewport (Y: ~2500px) [Scroll down to inspect]');
    expect(text).toContain('Content Summary:');
    expect(text).toContain('- Heading 1: "Product Catalog"');
  });

  it('should support spatial queries in ElementRegistry', () => {
    const registry = new ElementRegistry();
    registry.register({
      role: 'button',
      name: 'Nav Button',
      isInViewport: true,
      boundingBox: { x: 10, y: 10, width: 50, height: 30 },
      locatorStrategy: { type: 'role', selector: 'button' },
    });
    registry.register({
      role: 'link',
      name: 'Deep Footer Link',
      isInViewport: false,
      boundingBox: { x: 10, y: 3000, width: 50, height: 20 },
      locatorStrategy: { type: 'role', selector: 'link' },
    });

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.getInViewport()).toHaveLength(1);
    expect(registry.getInViewport()[0].name).toBe('Nav Button');
    expect(registry.getOutOfViewport()).toHaveLength(1);
    expect(registry.getOutOfViewport()[0].name).toBe('Deep Footer Link');
  });
});
