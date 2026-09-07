export interface Point {
  x: number;
  y: number;
}

export type EntropyMode = 'natural_human' | 'deliberate' | 'fast';

export interface BezierTrajectory {
  start: Point;
  end: Point;
  controlPoint1: Point;
  controlPoint2: Point;
  points: Point[];
  durationMs: number;
}

export interface MouseMovementOptions {
  steps?: number;
  overshoot?: boolean;
  deviation?: number;
  mode?: EntropyMode;
}

export interface KeystrokeOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  cognitivePauseWord?: boolean;
  mode?: EntropyMode;
}

export interface ProfileHealthReport {
  profileDir: string;
  diskUsageBytes: number;
  cacheUsageBytes: number;
  orphanedFilesCount: number;
  status: 'optimal' | 'needs_cleanup' | 'critical';
  timestamp: number;
}

export interface ProfileCleanupOptions {
  maxCacheAgeHours?: number;
  removeCrashDumps?: boolean;
  removeShaderCache?: boolean;
  removeOrphanedBlobs?: boolean;
  dryRun?: boolean;
}

export interface ProfileCleanupResult {
  freedBytes: number;
  deletedFilesCount: number;
  dryRun: boolean;
}
