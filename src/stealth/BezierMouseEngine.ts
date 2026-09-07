import type { Page } from 'playwright-core';
import type { Point, BezierTrajectory, MouseMovementOptions, EntropyMode } from './types.js';
import type { Logger } from '../logging/Logger.js';

export class BezierMouseEngine {
  private lastPosition: Point = { x: 0, y: 0 };

  constructor(private readonly logger?: Logger) {}

  public getCurrentPosition(): Point {
    return { ...this.lastPosition };
  }

  public setPosition(pos: Point): void {
    this.lastPosition = { ...pos };
  }

  /**
   * Computes a point on a Cubic Bézier curve at parameter t in [0, 1].
   */
  public cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
    const clampedT = Math.max(0, Math.min(1, t));
    const u = 1 - clampedT;
    const tt = clampedT * clampedT;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * clampedT;

    const x = uuu * p0.x + 3 * uu * clampedT * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    const y = uuu * p0.y + 3 * uu * clampedT * p1.y + 3 * u * tt * p2.y + ttt * p3.y;

    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    };
  }

  /**
   * Smooth bell-shaped ease-in-out interpolation function.
   */
  public easeInOut(s: number): number {
    const clamped = Math.max(0, Math.min(1, s));
    return clamped * clamped * (3 - 2 * clamped);
  }

  /**
   * Generates a realistic human Bézier trajectory between start and end coordinates.
   */
  public generateTrajectory(
    start: Point,
    end: Point,
    options?: MouseMovementOptions
  ): BezierTrajectory {
    const mode: EntropyMode = options?.mode || 'natural_human';

    if (mode === 'fast') {
      return {
        start,
        end,
        controlPoint1: start,
        controlPoint2: end,
        points: [start, end],
        durationMs: 0,
      };
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Number of intermediate sampling steps proportional to distance
    const defaultSteps = mode === 'deliberate' ? 24 : 16;
    const stepCount = Math.max(6, Math.min(60, options?.steps ?? Math.round(distance / 25) + defaultSteps));

    // Perpendicular vector for natural curve deviation
    const maxDeviation = options?.deviation ?? Math.min(120, Math.max(20, distance * 0.25));
    const randomOffset1 = (Math.random() - 0.5) * 2 * maxDeviation;
    const randomOffset2 = (Math.random() - 0.5) * 2 * maxDeviation;

    // Normal vector perpendicular to trajectory
    const nx = distance > 0 ? -dy / distance : 0;
    const ny = distance > 0 ? dx / distance : 0;

    // Control points randomized along 1/3 and 2/3 of chord with lateral displacement
    const cp1: Point = {
      x: start.x + dx * 0.33 + nx * randomOffset1,
      y: start.y + dy * 0.33 + ny * randomOffset1,
    };

    const cp2: Point = {
      x: start.x + dx * 0.66 + nx * randomOffset2,
      y: start.y + dy * 0.66 + ny * randomOffset2,
    };

    // Calculate micro-overshoot if enabled
    let targetEnd = end;
    if (options?.overshoot && distance > 50) {
      const overshootDist = 3 + Math.random() * 4;
      targetEnd = {
        x: end.x + (distance > 0 ? (dx / distance) * overshootDist : 0),
        y: end.y + (distance > 0 ? (dy / distance) * overshootDist : 0),
      };
    }

    const points: Point[] = [];
    for (let i = 0; i <= stepCount; i++) {
      const linearT = i / stepCount;
      const easedT = this.easeInOut(linearT);
      const pt = this.cubicBezier(start, cp1, cp2, targetEnd, easedT);
      points.push(pt);
    }

    // If overshot, add a gentle settle back to exact end point
    if (options?.overshoot && distance > 50) {
      points.push({
        x: Number(((targetEnd.x + end.x) / 2).toFixed(2)),
        y: Number(((targetEnd.y + end.y) / 2).toFixed(2)),
      });
      points.push(end);
    }

    const durationMs = mode === 'deliberate' ? 250 + distance * 0.8 : 120 + distance * 0.5;

    return {
      start,
      end,
      controlPoint1: cp1,
      controlPoint2: cp2,
      points,
      durationMs: Math.round(durationMs),
    };
  }

  /**
   * Moves mouse along a realistic Bézier trajectory using Playwright Core.
   */
  public async move(
    page: Page,
    target: Point,
    options?: MouseMovementOptions
  ): Promise<void> {
    const trajectory = this.generateTrajectory(this.lastPosition, target, options);

    if (trajectory.points.length <= 2 || options?.mode === 'fast') {
      await page.mouse.move(target.x, target.y);
      this.lastPosition = { ...target };
      return;
    }

    const stepDelay = Math.max(2, Math.round(trajectory.durationMs / trajectory.points.length));

    for (const pt of trajectory.points) {
      await page.mouse.move(pt.x, pt.y);
      if (stepDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      }
    }

    this.lastPosition = { ...target };
  }

  /**
   * Moves to target coordinates organically and performs a human-like click.
   */
  public async click(
    page: Page,
    target: Point,
    options?: MouseMovementOptions
  ): Promise<void> {
    // Add small sub-pixel human jitter (+/- 2px) to target point
    const jitteredTarget: Point = {
      x: target.x + (Math.random() - 0.5) * 3,
      y: target.y + (Math.random() - 0.5) * 3,
    };

    await this.move(page, jitteredTarget, options);

    // Pre-click hesitation (25ms to 75ms)
    if (options?.mode !== 'fast') {
      const hesitation = 25 + Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, hesitation));
    }

    await page.mouse.down();

    // Mouse button hold duration (40ms to 90ms)
    if (options?.mode !== 'fast') {
      const holdTime = 40 + Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, holdTime));
    }

    await page.mouse.up();
    this.lastPosition = { ...jitteredTarget };
  }
}
