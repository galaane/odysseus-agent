import type { RegisteredElement } from './ElementRegistry.js';

export interface SpatialPartition {
  inViewport: RegisteredElement[];
  outOfViewport: RegisteredElement[];
  hasSpatialMetadata: boolean;
}

export interface ClusteredOutElement {
  type: 'single' | 'cluster';
  element?: RegisteredElement;
  clusterStartId?: string;
  clusterEndId?: string;
  clusterCount?: number;
  role?: string;
  approximateY?: number;
}

export class SpatialAttentionFilter {
  /**
   * Partitions registered elements into in-viewport and out-of-viewport sets.
   * If spatial metadata is completely absent (e.g. in legacy tests), all elements are considered in-viewport.
   */
  public partition(elements: RegisteredElement[]): SpatialPartition {
    const hasSpatialMetadata = elements.some((el) => el.isInViewport !== undefined);

    if (!hasSpatialMetadata) {
      return {
        inViewport: [...elements],
        outOfViewport: [],
        hasSpatialMetadata: false,
      };
    }

    const inViewport: RegisteredElement[] = [];
    const outOfViewport: RegisteredElement[] = [];

    for (const el of elements) {
      if (el.isInViewport !== false) {
        inViewport.push(el);
      } else {
        outOfViewport.push(el);
      }
    }

    return {
      inViewport,
      outOfViewport,
      hasSpatialMetadata: true,
    };
  }

  /**
   * Assigns an interactive importance score to an element for prioritization.
   */
  public getImportanceScore(el: RegisteredElement): number {
    const role = el.role.toLowerCase();
    switch (role) {
      case 'textbox':
      case 'searchbox':
      case 'combobox':
      case 'select':
        return 100;
      case 'button':
        return 90;
      case 'checkbox':
      case 'radio':
      case 'switch':
        return 75;
      case 'tab':
      case 'menuitem':
        return 60;
      case 'link':
        return 40;
      default:
        return 30;
    }
  }

  /**
   * Clusters consecutive out-of-viewport elements (e.g. long lists of links)
   * to save valuable tokens while preserving actionable buttons and form controls.
   */
  public clusterOutOfViewport(
    elements: RegisteredElement[],
    clusterThreshold = 4
  ): ClusteredOutElement[] {
    const result: ClusteredOutElement[] = [];
    let currentLinkCluster: RegisteredElement[] = [];

    const flushCluster = () => {
      if (currentLinkCluster.length === 0) return;

      if (currentLinkCluster.length >= clusterThreshold) {
        const first = currentLinkCluster[0];
        const last = currentLinkCluster[currentLinkCluster.length - 1];
        const avgY = Math.round(
          currentLinkCluster.reduce((sum, el) => sum + (el.boundingBox?.y || 0), 0) /
            currentLinkCluster.length
        );

        result.push({
          type: 'cluster',
          clusterStartId: first.id,
          clusterEndId: last.id,
          clusterCount: currentLinkCluster.length,
          role: 'links',
          approximateY: avgY > 0 ? avgY : undefined,
        });
      } else {
        for (const el of currentLinkCluster) {
          result.push({ type: 'single', element: el });
        }
      }
      currentLinkCluster = [];
    };

    for (const el of elements) {
      const isLowPriorityLink = el.role.toLowerCase() === 'link';

      if (isLowPriorityLink) {
        currentLinkCluster.push(el);
      } else {
        flushCluster();
        result.push({ type: 'single', element: el });
      }
    }

    flushCluster();
    return result;
  }
}
