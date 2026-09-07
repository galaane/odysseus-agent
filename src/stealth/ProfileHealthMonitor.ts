import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ProfileHealthReport,
  ProfileCleanupOptions,
  ProfileCleanupResult,
} from './types.js';
import type { Logger } from '../logging/Logger.js';

export class ProfileHealthMonitor {
  // Ephemeral cache directories safe to clean without losing session authentication
  private readonly ephemeralDirectories = [
    path.join('Default', 'Cache'),
    path.join('Default', 'Code Cache'),
    path.join('Default', 'GPUCache'),
    path.join('Default', 'DawnCache'),
    path.join('Default', 'ShaderCache'),
    path.join('Default', 'Service Worker', 'CacheStorage'),
    path.join('Crashpad', 'completed'),
    path.join('Crashpad', 'pending'),
    path.join('Crash Reports'),
    'BrowserMetrics',
  ];

  // Protected files/directories that must NEVER be purged
  private readonly protectedPatterns = [
    'Cookies',
    'Local Storage',
    'IndexedDB',
    'Preferences',
    'Secure Preferences',
    'Web Data',
    'Login Data',
  ];

  constructor(
    private readonly profileDir: string,
    private readonly logger?: Logger
  ) {}

  public getProfileDir(): string {
    return this.profileDir;
  }

  /**
   * Scans and reports health metrics for the persistent Chromium profile.
   */
  public async inspectProfile(): Promise<ProfileHealthReport> {
    const timestamp = Date.now();
    try {
      await fs.access(this.profileDir);
    } catch {
      return {
        profileDir: this.profileDir,
        diskUsageBytes: 0,
        cacheUsageBytes: 0,
        orphanedFilesCount: 0,
        status: 'optimal',
        timestamp,
      };
    }

    let totalDiskBytes = 0;
    let cacheBytes = 0;
    let orphanedCount = 0;

    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            try {
              const stat = await fs.stat(fullPath);
              totalDiskBytes += stat.size;
              if (this.isEphemeral(fullPath)) {
                cacheBytes += stat.size;
              }
              if (entry.name.endsWith('.tmp') || entry.name.endsWith('.dmp')) {
                orphanedCount++;
              }
            } catch {
              // Ignore file stat errors for locked files
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    };

    await scanDir(this.profileDir);

    let status: ProfileHealthReport['status'] = 'optimal';
    if (totalDiskBytes > 1_500_000_000) {
      // > 1.5 GB total
      status = 'critical';
    } else if (cacheBytes > 300_000_000 || orphanedCount > 15) {
      // > 300 MB cache or > 15 orphaned dump files
      status = 'needs_cleanup';
    }

    this.logger?.info('ProfileHealthMonitor', 'Inspected browser profile health', {
      totalDiskMb: (totalDiskBytes / (1024 * 1024)).toFixed(1),
      cacheMb: (cacheBytes / (1024 * 1024)).toFixed(1),
      orphanedCount,
      status,
    });

    return {
      profileDir: this.profileDir,
      diskUsageBytes: totalDiskBytes,
      cacheUsageBytes: cacheBytes,
      orphanedFilesCount: orphanedCount,
      status,
      timestamp,
    };
  }

  /**
   * Safely purges ephemeral cache folders and temporary dumps while strictly preserving
   * authentication cookies, session credentials, and user data.
   */
  public async cleanProfile(options?: ProfileCleanupOptions): Promise<ProfileCleanupResult> {
    const dryRun = options?.dryRun ?? false;
    let freedBytes = 0;
    let deletedFiles = 0;

    const removeDirContents = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Verify protection
          if (this.isProtected(fullPath)) {
            continue;
          }

          if (entry.isDirectory()) {
            await removeDirContents(fullPath);
            if (!dryRun) {
              await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
            }
          } else if (entry.isFile()) {
            try {
              const stat = await fs.stat(fullPath);
              freedBytes += stat.size;
              deletedFiles++;
              if (!dryRun) {
                await fs.unlink(fullPath).catch(() => {});
              }
            } catch {
              // Ignore stat or unlink errors
            }
          }
        }
      } catch {
        // Ignore read directory errors
      }
    };

    // Clean designated ephemeral cache directories
    for (const subDir of this.ephemeralDirectories) {
      const targetPath = path.join(this.profileDir, subDir);
      try {
        await fs.access(targetPath);
        await removeDirContents(targetPath);
      } catch {
        // Target doesn't exist
      }
    }

    this.logger?.info(
      'ProfileHealthMonitor',
      `Profile cleanup completed (dryRun=${dryRun}): freed ${(freedBytes / 1024).toFixed(1)} KB across ${deletedFiles} files.`
    );

    return {
      freedBytes,
      deletedFilesCount: deletedFiles,
      dryRun,
    };
  }

  /**
   * Enforces zero-deletion guarantee on critical session storage, cookies, and tokens.
   */
  public isProtected(targetPath: string): boolean {
    const norm = path.normalize(targetPath);
    return this.protectedPatterns.some((pattern) => norm.includes(path.normalize(pattern)));
  }

  /**
   * Identifies paths belonging to ephemeral cache directories.
   */
  public isEphemeral(targetPath: string): boolean {
    const norm = path.normalize(targetPath);
    return this.ephemeralDirectories.some((dir) => norm.includes(path.normalize(dir)));
  }
}
