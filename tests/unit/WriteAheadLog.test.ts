import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { WriteAheadLog } from '../../src/WriteAheadLog.js';
import { NotFoundError } from '../../src/errors/index.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeUnlink = async (filePath: string) => {
  try {
    if (existsSync(filePath)) await unlink(filePath);
  } catch (error) {
    console.warn(`Warning: Could not delete file ${filePath}`, error);
  }
};

const testDir = join(process.cwd(), 'test-wal-dir');
const walFile = join(
  testDir,
  `test-${Date.now()}-${Math.round(Math.random() * 1000)}.wal`
);
const walInterval = 10;
let wal: WriteAheadLog;

beforeEach(async () => {
  try {
    await mkdir(testDir, { recursive: true });
  } catch (error) {
    // @ts-expect-error
    if (!(error as any).code === 'EEXIST') throw error;
  }

  await safeUnlink(walFile);

  wal = new WriteAheadLog(walFile, walInterval);
});

afterEach(async () => {
  await delay(walInterval * 2);

  try {
    await wal.flushWAL();
  } catch (_error) {
    // Ignore flush errors during cleanup
  }

  await safeUnlink(walFile);
});

describe('Initialization', () => {
  test('It should initialize with empty buffer', () => {
    expect(wal.walBuffer).toEqual([]);
  });

  test('It should start with the correct file path and interval', () => {
    // @ts-expect-error
    expect(wal.walFile).toBe(walFile);
    // @ts-expect-error
    expect(wal.walInterval).toBe(walInterval);
  });
});

describe('Buffer management and flushing', () => {
  test('It should append to WAL buffer', async () => {
    await wal.appendToWAL('testTable', 'W', 'key1', { test: 'data' }, 1);
    expect(wal.walBuffer.length).toBe(1);
  });

  test('It should flush buffer to disk when reaching max entries limit', async () => {
    // @ts-expect-error - Set a smaller buffer limit for testing
    const originalMaxEntries = wal.maxWalBufferEntries;
    // @ts-expect-error - Accessing private property for testing
    wal.maxWalBufferEntries = 3;

    try {
      // Add entries just below the limit
      await wal.appendToWAL('testTable', 'W', 'key1', { test: 'data1' }, 1);
      await wal.appendToWAL('testTable', 'W', 'key2', { test: 'data2' }, 2);
      expect(wal.walBuffer.length).toBe(2);

      // Add one more to trigger flush
      await wal.appendToWAL('testTable', 'W', 'key3', { test: 'data3' }, 3);
      await delay(50); // Short delay to ensure flush completes

      // Buffer should be empty after flush
      expect(wal.walBuffer.length).toBe(0);

      // File should exist and have content
      expect(existsSync(walFile)).toBe(true);
      const content = readFileSync(walFile, 'utf8');
      expect(content).toContain('key1');
      expect(content).toContain('key2');
      expect(content).toContain('key3');
    } finally {
      // Restore original value
      // @ts-expect-error - Accessing private property for testing
      wal.maxWalBufferEntries = originalMaxEntries;
    }
  });

  test('It should flush buffer to disk when reaching max buffer size', async () => {
    // @ts-expect-error - Set a smaller buffer size limit for testing
    const originalMaxSize = wal.maxWalBufferSize;
    // @ts-expect-error - Accessing private property for testing
    wal.maxWalBufferSize = 100;

    try {
      // Create a large entry to trigger size-based flush
      const largeData = { test: 'a'.repeat(200) };
      await wal.appendToWAL('testTable', 'W', 'largeKey', largeData, 1);
      await delay(50); // Short delay to ensure flush completes

      expect(wal.walBuffer.length).toBe(0);

      expect(existsSync(walFile)).toBe(true);
      const content = readFileSync(walFile, 'utf8');
      expect(content).toContain('largeKey');
    } finally {
      // @ts-expect-error - Accessing private property for testing
      wal.maxWalBufferSize = originalMaxSize;
    }
  });

  test('It should flush buffer manually', async () => {
    await wal.appendToWAL('testTable', 'W', 'key1', { test: 'data' }, 1);
    await wal.flushWAL();

    expect(wal.walBuffer.length).toBe(0);

    expect(existsSync(walFile)).toBe(true);
    const content = readFileSync(walFile, 'utf8');
    expect(content).toContain('key1');
  });

  test('It should handle empty buffer flush', async () => {
    await wal.flushWAL();
    expect(wal.walBuffer.length).toBe(0);
  });
});

describe('Append operations', () => {
  test('It should correctly format WAL entries', async () => {
    await wal.appendToWAL('testTable', 'W', 'key1', { test: 'data' }, 1, 0);
    await wal.flushWAL();

    const content = readFileSync(walFile, 'utf8');

    const pattern = /^\d+ W testTable v:1 x:0 key1 {"test":"data"}\n$/;
    expect(pattern.test(content)).toBe(true);
  });

  test('It should handle write operations', async () => {
    await wal.appendToWAL('testTable', 'W', 'key1', { test: 'data' }, 1);
    await wal.flushWAL();

    const content = readFileSync(walFile, 'utf8');
    expect(content).toContain('W testTable');
  });

  test('It should handle delete operations', async () => {
    await wal.appendToWAL('testTable', 'D', 'key1', null, 1);
    await wal.flushWAL();

    const content = readFileSync(walFile, 'utf8');
    expect(content).toContain('D testTable');
  });

  test('It should store entries with expiration time', async () => {
    const futureTime = Date.now() + 60000; // 1 minute in the future
    await wal.appendToWAL(
      'testTable',
      'W',
      'key1',
      { test: 'data' },
      1,
      futureTime
    );
    await wal.flushWAL();

    const content = readFileSync(walFile, 'utf8');
    expect(content).toContain(`x:${futureTime}`);
  });
});

describe('Loading WAL entries', () => {
  test('It should load all WAL entries', async () => {
    await wal.appendToWAL('table1', 'W', 'key1', { test: 'data1' }, 1);
    await wal.appendToWAL('table2', 'W', 'key2', { test: 'data2' }, 2);
    await wal.appendToWAL('table1', 'D', 'key3', null, 3);
    await wal.flushWAL();

    const operations = await wal.loadWAL();
    expect(operations.length).toBe(3);

    expect(operations[0].operation).toBe('W');
    expect(operations[0].tableName).toBe('table1');
    expect(operations[0].key).toBe('key1');
    expect(operations[0].data?.value).toEqual({ test: 'data1' });

    expect(operations[2].operation).toBe('D');
    expect(operations[2].tableName).toBe('table1');
    expect(operations[2].key).toBe('key3');
  });

  test('It should filter by table', async () => {
    await wal.appendToWAL('table1', 'W', 'key1', { test: 'data1' }, 1);
    await wal.appendToWAL('table2', 'W', 'key2', { test: 'data2' }, 2);
    await wal.appendToWAL('table1', 'W', 'key1', { test: 'data3' }, 3);
    await wal.flushWAL();

    await wal.appendToWAL('table1', 'W', 'key1', { test: 'data1' }, 100); // This should not show up as it is after flush

    const operations = await wal.loadWAL('table1');
    expect(operations.length).toBe(2);
    expect(operations[0].tableName).toBe('table1');
    expect(operations[1].tableName).toBe('table1');
  });

  test('It should handle non-existent WAL file', async () => {
    await safeUnlink(walFile);
    await expect(wal.loadWAL()).rejects.toThrowError(NotFoundError);
  });

  test('It should handle malformed JSON in WAL entries', async () => {
    const malformedEntry = `${Date.now()} W testTable v:1 x:0 badKey {malformed:json}\n`;
    const validEntry = `${Date.now()} W testTable v:2 x:0 goodKey {"valid":"json"}\n`;

    await mkdir(testDir, { recursive: true });
    await writeFile(walFile, malformedEntry + validEntry);

    const operations = await wal.loadWAL();
    expect(operations.length).toBe(1);
    expect(operations[0].key).toBe('goodKey');
  });
});

describe('Checking for new WAL entries', () => {
  test('It should detect new entries for a table', async () => {
    const table = 'testTable';
    expect(await wal.hasNewWALEntriesForTable(table)).toBe(false);

    await wal.appendToWAL(table, 'W', 'key1', { test: 'data' }, 1);
    await wal.flushWAL();

    expect(await wal.hasNewWALEntriesForTable(table)).toBe(true);

    await wal.loadWAL(table);

    expect(await wal.hasNewWALEntriesForTable(table)).toBe(false);
  });

  test('It should handle non-existent WAL file in checks', async () => {
    await safeUnlink(walFile);

    await expect(
      wal.hasNewWALEntriesForTable('testTable')
    ).rejects.toThrowError(NotFoundError);
  });
});

describe('Checkpoint callback', () => {
  test('It should set and trigger checkpoint callback', async () => {
    let checkpointCalled = false;

    wal.setCheckpointCallback(async () => {
      checkpointCalled = true;
      await Promise.resolve();
    });

    // @ts-expect-error - Accessing private property for testing
    const originalLimit = wal.maxWalSizeBeforeCheckpoint;
    // @ts-expect-error - Accessing private property for testing
    wal.maxWalSizeBeforeCheckpoint = 10;

    try {
      await wal.appendToWAL(
        'testTable',
        'W',
        'key1',
        { test: 'initial data' },
        1
      );
      await wal.flushWAL();

      await wal.appendToWAL(
        'testTable',
        'W',
        'key2',
        { test: 'data'.repeat(50) },
        2
      );
      await wal.flushWAL();

      await delay(300);

      expect(checkpointCalled).toBe(true);
    } finally {
      // @ts-expect-error - Accessing private property for testing
      wal.maxWalSizeBeforeCheckpoint = originalLimit;
    }
  });

  test('It should handle missing checkpoint callback', async () => {
    // @ts-expect-error - Set a very small WAL size limit
    const originalLimit = wal.maxWalSizeBeforeCheckpoint;
    // @ts-expect-error - Accessing private property for testing
    wal.maxWalSizeBeforeCheckpoint = 10;

    try {
      // This should not throw an error despite no callback being set
      await wal.appendToWAL(
        'testTable',
        'W',
        'key1',
        { test: 'data'.repeat(20) },
        1
      );
      await wal.flushWAL();

      // Wait to ensure no errors occur
      await delay(100);
    } finally {
      // Restore original value
      // @ts-expect-error - Accessing private property for testing
      wal.maxWalSizeBeforeCheckpoint = originalLimit;
    }
  });
});

describe('Position tracking', () => {
  test('It should track and clear WAL positions', async () => {
    await wal.appendToWAL('table1', 'W', 'key1', { test: 'data1' }, 1);
    await wal.flushWAL();

    // Load to set position tracking
    await wal.loadWAL('table1');

    await wal.appendToWAL('table1', 'W', 'key2', { test: 'data2' }, 2);
    await wal.flushWAL();

    // Should show new entries available
    expect(await wal.hasNewWALEntriesForTable('table1')).toBe(true);

    wal.clearPositions();

    // After clearing, should detect new entries again from the start
    expect(await wal.hasNewWALEntriesForTable('table1')).toBe(true);
  });

  test('It should only process new entries after position tracking', async () => {
    await wal.appendToWAL('table1', 'W', 'key1', { test: 'data1' }, 1);
    await wal.flushWAL();

    await wal.loadWAL('table1');

    await wal.appendToWAL('table1', 'W', 'key2', { test: 'data2' }, 2);
    await wal.flushWAL();

    // Load again - should only get the second entry
    const operations = await wal.loadWAL('table1');
    expect(operations.length).toBe(1);
    expect(operations[0].key).toBe('key2');
  });
});

describe('Expiration handling', () => {
  test('It should handle expired items during WAL loading', async () => {
    const now = Date.now();
    const pastExpiration = now - 10000; // 10 seconds in the past

    await wal.appendToWAL(
      'testTable',
      'W',
      'key1',
      { test: 'expired' },
      1,
      pastExpiration
    );
    await wal.appendToWAL('testTable', 'W', 'key2', { test: 'valid' }, 2, 0); // No expiration
    await wal.flushWAL();

    const operations = await wal.loadWAL();

    // Should only include the non-expired entry
    expect(operations.length).toBe(1);
    expect(operations[0].key).toBe('key2');
  });

  test('It should include items with future expiration times', async () => {
    const now = Date.now();
    const futureExpiration = now + 10000; // 10 seconds in the future

    await wal.appendToWAL(
      'testTable',
      'W',
      'key1',
      { test: 'future' },
      1,
      futureExpiration
    );
    await wal.flushWAL();

    const operations = await wal.loadWAL();
    expect(operations.length).toBe(1);
    expect(operations[0].key).toBe('key1');
    expect(operations[0].data?.expiration).toBe(futureExpiration);
  });
});

describe('Error handling', () => {
  test('It should restore buffer if flush fails', async () => {
    const errorTestFile = join(
      testDir,
      `error-test-${Date.now()}-${Math.round(Math.random() * 10000)}.wal`
    );

    const errorWal = new WriteAheadLog(errorTestFile, walInterval);

    // Create a situation where writing would fail - make a directory with the same name
    try {
      // First make sure no file exists with this name
      await safeUnlink(errorTestFile);

      // Now create a directory with the same name
      await mkdir(errorTestFile, { recursive: true });

      // Add something to the buffer
      await errorWal.appendToWAL('testTable', 'W', 'key1', { test: 'data' }, 1);
      const originalBufferLength = errorWal.walBuffer.length;

      try {
        // This should fail because we can't write to a directory
        await errorWal.flushWAL();
        // If we get here, the system allowed writing to the directory (unlikely)
        console.warn("Warning: Flush didn't throw as expected in error test");
      } catch (_error) {
        // Buffer should be preserved on error
        expect(errorWal.walBuffer.length).toBe(originalBufferLength);
      }
    } finally {
      // Clean up - need to use rmdir for directories
      try {
        await rm(errorTestFile, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn(
          'Warning: Failed to clean up test directory',
          cleanupError
        );
      }
    }
  });
});

describe('Automatic flush interval', () => {
  test('It should automatically flush buffer after interval', async () => {
    const testWalFile = join(
      testDir,
      `auto-flush-${Date.now()}-${Math.round(Math.random() * 10000)}.wal`
    );

    const autoFlushWal = new WriteAheadLog(testWalFile, walInterval);

    // Add to buffer but don't manually flush
    await autoFlushWal.appendToWAL(
      'testTable',
      'W',
      'key1',
      { test: 'data' },
      1
    );
    expect(autoFlushWal.walBuffer.length).toBe(1);

    // Wait for automatic flush interval (a bit longer to be safe)
    await delay(walInterval * 3);

    // Buffer should be empty
    expect(autoFlushWal.walBuffer.length).toBe(0);

    try {
      const stats = statSync(testWalFile);
      expect(stats.isFile()).toBe(true);

      const content = readFileSync(testWalFile, 'utf8');
      expect(content).toContain('key1');
    } finally {
      await safeUnlink(testWalFile);
    }
  });
});
