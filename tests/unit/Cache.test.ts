import { beforeEach, describe, expect, test } from 'vitest';

import { Cache } from '../../src/Cache.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let cache: Cache;

beforeEach(() => {
  cache = new Cache({ cacheLimit: 2 });
});

describe('Initialization', () => {
  test('It should initialize with default cache limit', () => {
    const cache = new Cache();
    expect(cache.cacheLimit).toBe(20);
  });

  test('It should initialize with custom cache limit', () => {
    const options = { cacheLimit: 10 };
    const cache = new Cache(options);
    expect(cache.cacheLimit).toBe(10);
  });
});

describe('Table access tracking and eviction', () => {
  test('It should return empty array if current table count is within limit', () => {
    cache.trackTableAccess('table1');
    cache.trackTableAccess('table2');

    const evictionCandidates = cache.findTablesForEviction(2);
    expect(evictionCandidates).toEqual([]);
  });

  test('It should find tables for eviction based on LRU policy', async () => {
    cache.trackTableAccess('table1');
    await delay(10);

    cache.trackTableAccess('table2');
    await delay(10);

    cache.trackTableAccess('table3');

    const evictionCandidates = cache.findTablesForEviction(3);
    expect(evictionCandidates).toEqual(['table1']);
  });

  test('It should find tables for eviction based on most recent access', async () => {
    cache.trackTableAccess('table1');
    await delay(10);

    cache.trackTableAccess('table2');
    await delay(10);

    cache.trackTableAccess('table1');
    await delay(10);

    cache.trackTableAccess('table3');

    const evictionCandidates = cache.findTablesForEviction(3);
    expect(evictionCandidates).toEqual(['table2']);
  });

  test('It should evict multiple tables if needed', async () => {
    const smallCache = new Cache({ cacheLimit: 2 });

    smallCache.trackTableAccess('table1');
    await delay(10);

    smallCache.trackTableAccess('table2');
    await delay(10);

    smallCache.trackTableAccess('table3');
    await delay(10);

    smallCache.trackTableAccess('table4');

    const evictionCandidates = smallCache.findTablesForEviction(4);
    expect(evictionCandidates).toEqual(['table1', 'table2']);
  });

  test('It should remove evicted tables from access times tracking', async () => {
    cache.trackTableAccess('table1');
    await delay(10);

    cache.trackTableAccess('table2');
    await delay(10);

    cache.trackTableAccess('table3');

    const evictionCandidates1 = cache.findTablesForEviction(3);
    expect(evictionCandidates1).toEqual(['table1']);

    await delay(10);
    cache.trackTableAccess('table4');

    const evictionCandidates2 = cache.findTablesForEviction(3);
    expect(evictionCandidates2).toEqual(['table2']);
  });
});

describe('Remove table', () => {
  test('It should remove table from tracking', async () => {
    cache.trackTableAccess('table1');
    await delay(10);

    cache.trackTableAccess('table2');

    cache.removeTable('table1');

    await delay(10);
    cache.trackTableAccess('table3');

    const evictionCandidates = cache.findTablesForEviction(3);
    expect(evictionCandidates).not.toContain('table1');
    expect(evictionCandidates).toEqual(['table2']);
  });

  test('It should handle removing non-existent table', () => {
    expect(() => cache.removeTable('nonExistentTable')).not.toThrow();
  });
});

describe('Find expired items', () => {
  test('It should find expired items', () => {
    const currentTime = Date.now();
    const items = new Map([
      ['key1', { x: currentTime - 1000 }],
      ['key2', { x: currentTime + 1000 }],
      ['key3', { x: null }]
    ]);

    const expiredItems = cache.findExpiredItems(items);
    expect(expiredItems.length).toBe(1);
    expect(expiredItems[0][0]).toBe('key1');
    expect(expiredItems[0][1].x).toBe(currentTime - 1000);
  });

  test('It should handle empty map', () => {
    const items = new Map();
    const expiredItems = cache.findExpiredItems(items);
    expect(expiredItems.length).toBe(0);
  });

  test('It should handle items with no expiration', () => {
    const items = new Map([
      ['key1', { x: null }],
      ['key2', { x: null }]
    ]);

    const expiredItems = cache.findExpiredItems(items);
    expect(expiredItems.length).toBe(0);
  });

  test('It should return all expired items', () => {
    const currentTime = Date.now();
    const items = new Map([
      ['key1', { x: currentTime - 2000 }],
      ['key2', { x: currentTime - 1000 }],
      ['key3', { x: currentTime + 1000 }]
    ]);

    const expiredItems = cache.findExpiredItems(items);
    expect(expiredItems.length).toBe(2);

    const expiredKeys = expiredItems.map((item) => item[0]);
    expect(expiredKeys).toContain('key1');
    expect(expiredKeys).toContain('key2');
    expect(expiredKeys).not.toContain('key3');
  });

  test('It should not find items with future expiration times', () => {
    const currentTime = Date.now();
    const items = new Map([
      ['key1', { x: currentTime + 1000 }],
      ['key2', { x: currentTime + 5000 }]
    ]);

    const expiredItems = cache.findExpiredItems(items);
    expect(expiredItems.length).toBe(0);
  });
});

describe('Clear', () => {
  test('It should clear all cache tracking data', async () => {
    cache.trackTableAccess('table1');
    await delay(10);

    cache.trackTableAccess('table2');
    await delay(10);

    cache.trackTableAccess('table3');

    let evictionCandidates = cache.findTablesForEviction(3);
    expect(evictionCandidates.length).toBe(1);

    cache.clear();

    evictionCandidates = cache.findTablesForEviction(3);
    expect(evictionCandidates.length).toBe(0);

    await delay(10);
    cache.trackTableAccess('tableA');
    await delay(10);

    cache.trackTableAccess('tableB');
    await delay(10);

    cache.trackTableAccess('tableC');

    evictionCandidates = cache.findTablesForEviction(3);
    expect(evictionCandidates.length).toBe(1);
    expect(evictionCandidates[0]).toBe('tableA');
  });
});
