import type { CacheOptions } from './interfaces/index.js';

import { time } from './utils/index.js';

/**
 * @description Handles in-memory caching.
 */
export class Cache {
  /**
   * Max number of tables to cache in memory.
   */
  public readonly cacheLimit: number;

  /**
   * Track table access times for Least Recently Used (LRU) eviction.
   */
  private tableAccessTimes: Map<string, number> = new Map();

  constructor(options: CacheOptions = {}) {
    this.cacheLimit = options.cacheLimit ?? 20;
  }

  /**
   * @description Track access to a table to update LRU information.
   */
  public trackTableAccess(tableName: string): void {
    this.tableAccessTimes.set(tableName, time());
  }

  /**
   * @description Find tables that should be evicted based on LRU policy.
   */
  public findTablesForEviction(currentTableCount: number): string[] {
    if (currentTableCount <= this.cacheLimit) return [];

    const evictionCount = currentTableCount - this.cacheLimit;
    const evictionCandidates = Array.from(this.tableAccessTimes.entries())
      .sort((a, b) => a[1] - b[1]) // Sort by access time (oldest first)
      .slice(0, evictionCount)
      .map(([tableName]) => tableName);

    for (const tableName of evictionCandidates) this.tableAccessTimes.delete(tableName);

    return evictionCandidates;
  }

  /**
   * @description Remove table from tracking.
   */
  public removeTable(tableName: string): void {
    this.tableAccessTimes.delete(tableName);
  }

  /**
   * @description Check if items are expired.
   */
  public findExpiredItems<T extends { x: number | null }>(
    items: Map<string, T>
  ): Array<[string, T]> {
    const currentTimestamp = time();
    const expiredItems: Array<[string, T]> = [];

    for (const [key, item] of items.entries()) {
      if (item.x && item.x < currentTimestamp) expiredItems.push([key, item]);
    }

    return expiredItems;
  }

  /**
   * @description Clear all cache tracking data.
   */
  public clear(): void {
    this.tableAccessTimes.clear();
  }
}
