import fs, { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MikroDB } from '../../src/MikroDB.js';

let db: MikroDB;

const testDir = join(process.cwd(), 'test-db');

beforeEach(async () => {
  mkdirSync(testDir, { recursive: true });

  db = new MikroDB({ databaseDirectory: testDir } as any);
  await db.start();
});

afterEach(async () => {
  await db.close();
  if (existsSync(testDir)) await rm(testDir, { recursive: true, force: true });
});

describe('Initialization', () => {
  test('It should create the database directory if it does not exist', () => {
    expect(fs.existsSync(testDir)).toBe(true);
  });

  test('It should set up custom change data capture events', async () => {
    const consoleSpy = vi.spyOn(console, 'log');

    const tableName = 'test-table';
    const key = 'test-key';
    const value = 'test-value';

    const db = new MikroDB({
      databaseDirectory: testDir,
      events: {
        targets: [
          {
            name: 'internal',
            events: ['item.deleted', 'item.expired', 'item.written', 'table.deleted']
          }
        ],
        listeners: [
          {
            event: 'item.deleted',
            handler: (data: any) => console.log('Item deleted', data)
          },
          {
            event: 'item.expired',
            handler: (data: any) => console.log('Item expired', data)
          },
          {
            event: 'item.written',
            handler: (data: any) => console.log('Item written', data)
          },
          {
            event: 'table.deleted',
            handler: (data: any) => console.log('Table deleted', data)
          }
        ]
      }
    } as any);

    await db.start();

    await db.write({
      tableName,
      key: `${key}-1`,
      value,
      expiration: Date.now() + 1 // Quick enough to almost immediately expire, no need to wait
    });

    await db.write({
      tableName,
      key: `${key}-2`,
      value
    });

    await db.delete({ tableName, key: `${key}-2` });

    await db.deleteTable('test-table');

    expect(consoleSpy).toHaveBeenCalledTimes(4); // 2 x writes, 1 x delete item, 1 x delete table

    consoleSpy.mockRestore();
  });
});

describe('Table management', () => {
  test('It should load table from disk if it does not exist in memory', async () => {
    const uniqueDir = join(testDir, `test-${Date.now()}`);
    if (!existsSync(uniqueDir)) mkdirSync(uniqueDir, { recursive: true });

    const firstDb = new MikroDB({ databaseDirectory: uniqueDir } as any);
    await firstDb.start();

    const tableName = 'users';
    const key = 'user123';
    const value = { name: 'John Doe' };

    await firstDb.write({ tableName, key, value });

    await firstDb.close();

    const newDb = new MikroDB({ databaseDirectory: uniqueDir } as any);
    await newDb.start();

    const result = await newDb.get({ tableName, key });

    expect(result).toEqual(value);
  });
});

describe('Writing data', () => {
  test('It should write data to the database and WAL', async () => {
    const tableName = 'users';
    const key = 'user123';
    const value = { name: 'John Doe' };
    await db.write({ tableName, key, value });
    expect(await db.get({ tableName, key })).toEqual(value);
  });

  test('It should write item with version control', async () => {
    const _db = db as any;

    const tableName = 'users';
    const key = 'user1';

    await _db.write({
      tableName,
      key,
      value: { name: 'John' }
    });

    const result = await _db.write({
      tableName,
      key,
      value: { name: 'Jane' }
    });

    expect(result).toBe(true);

    const item = _db.table.getItem('users', 'user1');
    expect(item.value).toEqual({ name: 'Jane' });
    expect(item.version).toBe(2);
  });

  test('It should fail write if expected version does not match', async () => {
    const _db = db as any;

    const tableName = 'users';
    const key = 'user1';

    await _db.write({
      tableName,
      key,
      value: { name: 'John' }
    });

    const result = await _db.write({
      tableName,
      key,
      value: { name: 'Jane' },
      expectedVersion: 5 // Current version is 1
    });

    expect(result).toBe(false);

    const data = await _db.get({ tableName: 'users', key: 'user1' });

    expect(data).toEqual({ name: 'John' });
  });

  test('It should support expiration time', async () => {
    const _db = db as any;
    const expiration = Date.now() + 60 * 1000; // 1 minute in the future

    await _db.write({
      tableName: 'users',
      key: 'user1',
      value: { name: 'John' },
      expiration
    });

    const item = _db.table.getItem('users', 'user1');
    expect(item.expiration).toBe(expiration);
  });

  describe('Write concurrency', () => {
    test('It should handle batch write operations', async () => {
      const operations = [
        { tableName: 'users', key: 'user1', value: { name: 'John' } },
        { tableName: 'users', key: 'user2', value: { name: 'Jane' } },
        { tableName: 'products', key: 'prod1', value: { name: 'Phone' } }
      ];

      const result = await db.write(operations, { concurrencyLimit: 2 });

      expect(result).toBe(true);

      expect(await db.get({ tableName: 'users', key: 'user1' })).toEqual({
        name: 'John'
      });
      expect(await db.get({ tableName: 'users', key: 'user2' })).toEqual({
        name: 'Jane'
      });
      expect(await db.get({ tableName: 'products', key: 'prod1' })).toEqual({
        name: 'Phone'
      });
    });

    test('It should write a single operation', async () => {
      const result = await db.write({
        tableName: 'users',
        key: 'user1',
        value: { name: 'John' }
      });

      expect(result).toBe(true);

      expect(await db.get({ tableName: 'users', key: 'user1' })).toEqual({
        name: 'John'
      });
    });

    test('It should flush after maxWriteOpsBeforeFlush operations', async () => {
      const db: any = new MikroDB({ databaseDirectory: testDir, maxWriteOpsBeforeFlush: 1 } as any);
      await db.start();

      const flushWritesSpy = vi.spyOn(db.table, 'flushWrites');

      const operations = [
        { tableName: 'users', key: 'user1', value: { name: 'John' } },
        { tableName: 'users', key: 'user2', value: { name: 'Jane' } },
        { tableName: 'users', key: 'user3', value: { name: 'Bob' } }
      ];

      await db.write(operations);

      expect(flushWritesSpy).toHaveBeenCalled();
      expect(flushWritesSpy.mock.calls.length).toBeGreaterThan(0);
    });

    test('It should handle concurrent writes to different tables', async () => {
      const originalLimit = (db as any).table.cache.cacheLimit;
      (db as any).table.cache.cacheLimit = 30; // Enough for all test tables

      try {
        const promises = [];
        const tables = 11;
        const entriesPerTable = 20;

        for (let i = 0; i < tables; i++) {
          for (let j = 0; j < entriesPerTable; j++) {
            promises.push(
              db.write({
                tableName: `concurrent-table-${i}`,
                key: `key-${j}`,
                value: { table: i, entry: j }
              })
            );
          }
        }

        await Promise.all(promises);

        for (let i = 0; i < tables; i++) {
          for (let j = 0; j < entriesPerTable; j++) {
            const result = await db.get({
              tableName: `concurrent-table-${i}`,
              key: `key-${j}`
            });

            expect(result).toEqual({ table: i, entry: j });
          }
        }
      } finally {
        (db as any).table.cache.cacheLimit = originalLimit;
      }
    });

    test('It should handle batch writes efficiently', async () => {
      const batchTestDir = join(testDir, `batch-test-${Date.now()}`);
      mkdirSync(batchTestDir, { recursive: true });

      try {
        const batchDb = new MikroDB({ databaseDirectory: batchTestDir } as any);
        await batchDb.start();

        const batchSize = 200;
        const operations = [];

        for (let i = 0; i < batchSize; i++) {
          operations.push({
            tableName: 'batch-perf',
            key: `key-${i}`,
            value: { data: `value-${i}` }
          });
        }

        const samples = 3;
        const durations = [];

        for (let sample = 0; sample < samples; sample++) {
          const sampleOperations = operations.map((op) => ({
            ...op,
            tableName: `batch-perf-${sample}`
          }));

          const startTime = Date.now();
          await batchDb.write(sampleOperations);
          const endTime = Date.now();
          durations.push(endTime - startTime);
        }

        durations.sort((a, b) => a - b);
        const medianDuration = durations[Math.floor(durations.length / 2)];

        const randomIndex = Math.floor(Math.random() * batchSize);
        const result = await batchDb.get({
          tableName: 'batch-perf-0',
          key: `key-${randomIndex}`
        });

        expect(result).toEqual({ data: `value-${randomIndex}` });

        expect(medianDuration).toBeLessThan(300);

        await batchDb.close();
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 200));

        if (existsSync(batchTestDir)) {
          await rm(batchTestDir, { recursive: true, force: true }).catch((err) =>
            console.error(`Failed to clean up batch test dir: ${err.message}`)
          );
        }
      }
    });

    test('It should perform well with read operations after large WAL', async () => {
      const perfTestDir = join(testDir, `perf-test-${Date.now()}`);
      mkdirSync(perfTestDir, { recursive: true });

      try {
        const perfDb = new MikroDB({ databaseDirectory: perfTestDir } as any);
        await perfDb.start();

        const writeCount = 500;
        const operations = [];

        for (let i = 0; i < writeCount; i++) {
          operations.push({
            tableName: 'read-perf',
            key: `key-${i}`,
            value: { data: `value-${i}` }
          });
        }

        await perfDb.write(operations);

        for (let i = 0; i < 10; i++) {
          const warmupIndex = Math.floor(Math.random() * writeCount);
          await perfDb.get({
            tableName: 'read-perf',
            key: `key-${warmupIndex}`
          });
        }

        const readCount = 300;
        const readTimes = [];

        for (let i = 0; i < readCount; i++) {
          const randomIndex = Math.floor(Math.random() * writeCount);
          const startRead = Date.now();
          await perfDb.get({
            tableName: 'read-perf',
            key: `key-${randomIndex}`
          });
          const endRead = Date.now();
          readTimes.push(endRead - startRead);
        }

        const totalTime = readTimes.reduce((sum, time) => sum + time, 0);
        const avgReadTime = totalTime / readCount;

        // Remove outliers - ignore the slowest 5% of reads
        const sortedTimes = [...readTimes].sort((a, b) => a - b);
        const trimmedTimes = sortedTimes.slice(0, Math.floor(readCount * 0.95));
        const trimmedAvg = trimmedTimes.reduce((sum, time) => sum + time, 0) / trimmedTimes.length;

        console.log(`${readCount} random reads with large WAL:`);
        console.log(`- Average read time: ${avgReadTime.toFixed(2)}ms`);
        console.log(`- Average read time (95th percentile): ${trimmedAvg.toFixed(2)}ms`);

        expect(trimmedAvg).toBeLessThan(100);

        await perfDb.close();
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 200));

        if (existsSync(perfTestDir)) {
          await rm(perfTestDir, { recursive: true, force: true }).catch((err) =>
            console.error(`Failed to clean up perf test dir: ${err.message}`)
          );
        }
      }
    });
  });

  describe('Flushing writes', () => {
    test('It should flush buffered writes to disk', async () => {
      const _db = db as any;

      await db.write({
        tableName: 'users',
        key: 'user1',
        value: { name: 'John' }
      });

      const record = _db.table.getItem('users', 'user1');
      _db.table.writeBuffer = [JSON.stringify({ tableName: 'users', key: 'user1', record })];

      await _db.table.flushWrites();

      expect(await _db.table.writeBuffer).toEqual([]);

      expect(existsSync(join(testDir, 'users'))).toBe(true);
    });

    test('It should not attempt to flush an empty write buffer', async () => {
      const _db = db as any;
      _db.table.writeBuffer = [];

      const writeFileSpy = vi.spyOn(fs.promises, 'writeFile');

      await _db.table.flushWrites();

      expect(writeFileSpy).not.toHaveBeenCalled();
    });
  });
});

describe('Reading data', () => {
  test('It should read data from the active table', async () => {
    const tableName = 'users';
    const key = 'user123';
    const value = { name: 'John Doe' };
    await db.write({ tableName, key, value });
    expect(await db.get({ tableName, key })).toEqual(value);
  });
});

describe('Deleting data', () => {
  test('It should delete data', async () => {
    const tableName = 'users';
    const key = 'user123';
    const value = { name: 'John Doe' };

    await db.write({ tableName, key, value });

    expect(await db.delete({ tableName, key })).toBe(true);
    expect(await db.get({ tableName, key })).toBeUndefined();
  });

  test('It should delete data with a given version', async () => {
    const tableName = 'users';
    const key = 'user123';
    const value = { name: 'John Doe' };

    await db.write({ tableName, key, value });
    await db.write({ tableName, key, value });
    await db.write({ tableName, key, value });

    expect(await db.delete({ tableName, key, expectedVersion: 3 })).toBe(true);
    expect(await db.get({ tableName, key })).toBeUndefined();
  });
});

describe('Expired item cleanup', () => {
  test('It should clean up expired items', async () => {
    const tableName = 'users';
    const key = 'user123';
    const value = { name: 'John Doe' };

    await db.write({
      tableName,
      key,
      value,
      expectedVersion: null,
      expiration: Date.now() - 1000
    });

    await db.cleanupExpiredItems();

    expect(await db.get({ tableName, key })).toBeUndefined();
  });
});

describe('Cache', () => {
  test('It should track table access times for LRU cache eviction', async () => {
    const trackAccessSpy = vi.spyOn((db as any).table, 'trackTableAccess');

    await db.get({ tableName: 'access-tracking', key: 'nonexistent-key' });

    expect(trackAccessSpy).toHaveBeenCalledWith('access-tracking');

    await db.write({
      tableName: 'another-table',
      key: 'key1',
      value: { data: 'test' }
    });

    expect(trackAccessSpy).toHaveBeenCalledWith('another-table');
  });
});

describe('Checkpoint', () => {
  describe('Checkpoint detection', () => {
    test('It should detect incomplete checkpoint and run recovery', async () => {
      const uniqueTestDir = join(testDir, `checkpoint-test-${Date.now()}`);
      mkdirSync(uniqueTestDir, { recursive: true });

      try {
        const checkpointFile = join(uniqueTestDir, 'wal.log.checkpoint');
        await writeFile(checkpointFile, Date.now().toString(), 'utf8');

        console.log(`Checkpoint file created at: ${checkpointFile}`);
        expect(existsSync(checkpointFile)).toBe(true);

        const newDb = new MikroDB({ databaseDirectory: uniqueTestDir } as any);

        // @ts-ignore
        const checkpointSpy = vi.spyOn(newDb.checkpoint, 'checkpoint');

        await newDb.start();

        expect(checkpointSpy).toHaveBeenCalledWith(true);

        await new Promise((resolve) => setTimeout(resolve, 200));

        await newDb.close();
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (existsSync(uniqueTestDir)) await rm(uniqueTestDir, { recursive: true, force: true });
      }
    });
  });

  describe('Checkpoint functionality', () => {
    test('It should not start checkpoint if already checkpointing', async () => {
      const _db = db as any;
      _db.isCheckpointing = true;

      await _db.checkpoint.checkpoint();

      expect(await _db.isCheckpointing).toBe(true);
    });

    test('It should not start checkpoint if last checkpoint was recent', async () => {
      const _db = db as any;
      _db.checkpoint.lastCheckpointTime = Date.now();

      await _db.checkpoint.checkpoint();

      expect(await _db.checkpoint.isCheckpointing).toBe(false);
    });

    test('It should handle checkpoint process', async () => {
      await db.write({
        tableName: 'users',
        key: 'user1',
        value: { name: 'John' }
      });

      const _db = db as any;
      _db.checkpoint.lastCheckpointTime = 0; // Ensure checkpoint runs

      await _db.checkpoint.checkpoint();

      expect(await _db.checkpoint.isCheckpointing).toBe(false);
      expect(await _db.checkpoint.lastCheckpointTime).not.toBe(0);
    });
  });
});

describe('WAL handling', () => {
  describe('Load WAL from disk', () => {
    test('It should load WAL data and replay operations', async () => {
      await db.write({
        tableName: 'users',
        key: 'user1',
        value: { name: 'John' }
      });

      const newDb = new MikroDB({ databaseDirectory: testDir } as any);
      await newDb.start();

      await db.flush();

      expect(await newDb.get({ tableName: 'users', key: 'user1' })).toEqual({
        name: 'John'
      });
    });

    test('It should skip expired items during WAL replay', async () => {
      await db.write({
        tableName: 'users',
        key: 'expiredUser',
        value: { name: 'Expired' },
        expiration: Date.now() - 1000
      });

      const newDb = new MikroDB({ databaseDirectory: testDir } as any);
      await newDb.start();

      expect(await newDb.get({ tableName: 'users', key: 'expiredUser' })).toBeUndefined();
    });

    test('It should handle WAL with delete operations', async () => {
      await db.write({
        tableName: 'users',
        key: 'user1',
        value: { name: 'John' }
      });
      await db.delete({ tableName: 'users', key: 'user1' });

      await db.flush();

      const newDb = new MikroDB({ databaseDirectory: testDir } as any);
      await newDb.start();

      expect(await newDb.get({ tableName: 'users', key: 'user1' })).toBeUndefined();
    });

    test('It should only load WAL entries for the requested table', async () => {
      const loadWALSpy = vi.spyOn((db as any).table.wal, 'loadWAL');

      await db.write({
        tableName: 'table1',
        key: 'key1',
        value: { table: 1 }
      });

      await db.write({
        tableName: 'table2',
        key: 'key2',
        value: { table: 2 }
      });

      await db.flush();

      await db.get({ tableName: 'table1', key: 'key1' });

      expect(loadWALSpy).toHaveBeenCalledWith('table1');

      loadWALSpy.mockClear();

      await db.get({ tableName: 'table2', key: 'key2' });

      expect(loadWALSpy).toHaveBeenCalledWith('table2');
    });
  });

  describe('Flush WAL', () => {
    test('It should flush WAL when explicitly requested', async () => {
      await db.write({
        tableName: 'flush-test',
        key: 'key1',
        value: { data: 'test data' }
      });

      const flushSpy = vi.spyOn(db as any, 'flush');

      await db.flush();

      expect(flushSpy).toHaveBeenCalled();

      const walFile = join(testDir, 'wal.log');
      expect(existsSync(walFile)).toBe(true);
      expect(statSync(walFile).size).toBeGreaterThan(0);
    });

    test('It should flush WAL immediately when requested in write operation', async () => {
      const flushSpy = vi.spyOn((db as any).table.wal, 'flushWAL');

      await db.write(
        {
          tableName: 'immediate-flush',
          key: 'key1',
          value: { data: 'test data' }
        },
        {
          flushImmediately: true
        }
      );

      expect(flushSpy).toHaveBeenCalled();

      const walFile = join(testDir, 'wal.log');
      expect(existsSync(walFile)).toBe(true);
      expect(statSync(walFile).size).toBeGreaterThan(0);
    });

    test('It should flush the WAL after multiple write operations', async () => {
      const db = new MikroDB({ databaseDirectory: testDir } as any);
      const tableName = 'users';
      for (let i = 0; i < 100; i++)
        await db.write({
          tableName,
          key: `user${i}`,
          value: { name: `User ${i}` }
        });

      const walPath = join(testDir, 'wal.log');
      expect(fs.existsSync(walPath)).toBe(true);
      expect(fs.readFileSync(walPath, 'utf8')).toContain('W');
    });

    test('It should append operations to WAL buffer and flush to disk', async () => {
      const db = new MikroDB({ databaseDirectory: testDir } as any);

      await db.write(
        {
          tableName: 'test',
          key: 'key1',
          value: { data: 'test data' }
        },
        {
          flushImmediately: true
        }
      );

      const walFile = join(testDir, 'wal.log');
      expect(existsSync(walFile)).toBe(true);

      const walContent = readFileSync(walFile, 'utf8');
      expect(walContent).toContain('key1');
      expect(walContent).toContain('test data');
      expect(walContent).toContain('W test');
    });

    test('It should flush WAL when buffer entries exceed limit', async () => {
      // @ts-ignore - accessing private property
      db.checkpoint.wal.maxWalBufferEntries = 5;
      console.log('DB', db);

      const flushSpy = vi.spyOn((db as any).table.wal, 'flushWAL');

      for (let i = 0; i < 6; i++) {
        // Should exceed maxWalBufferEntries
        await db.write({
          tableName: 'test',
          key: `key${i}`,
          value: { data: `test data ${i}` }
        });
      }

      expect(flushSpy).toHaveBeenCalled();

      const walFile = join(testDir, 'wal.log');
      expect(existsSync(walFile)).toBe(true);
    });

    test('It should flush WAL when buffer size exceeds limit', async () => {
      const db = new MikroDB({ databaseDirectory: `${testDir}-buffer-excess` } as any);
      const flushSpy = vi.spyOn((db as any).table.wal, 'flushWAL');

      const largeValue = { data: 'x'.repeat(20000) }; // Large data to exceed buffer size
      await db.write({
        tableName: 'test',
        key: 'large-key',
        value: largeValue
      });

      expect(flushSpy).toHaveBeenCalled();
    });

    // FIXME: Unclear why this does not work in CI
    test.skipIf(process.env.CI === 'true')(
      'It should trigger checkpoint when WAL size exceeds limit',
      async () => {
        const uniqueTestDir = join(testDir, `size-excess-${Date.now()}`);
        mkdirSync(uniqueTestDir, { recursive: true });

        try {
          const db = new MikroDB({
            databaseDirectory: uniqueTestDir,
            checkpointInterval: 10000,
            walInterval: 10000
          } as any);

          await db.start();

          // Replace the checkpoint method to avoid actual file operations
          const originalCheckpoint = (db as any).checkpoint.checkpoint;
          (db as any).checkpoint.checkpoint = async () => {
            // Just record the call without doing the actual work
            return true;
          };

          const checkpointSpy = vi.spyOn((db as any).checkpoint, 'checkpoint');

          (db as any).table.getWAL().maxWalSizeBeforeCheckpoint = 10;

          await db.write(
            {
              tableName: 'test',
              key: 'init-key',
              value: { data: 'initial' }
            },
            {
              flushImmediately: true
            }
          );

          (db as any).table.getWAL().setCheckpointCallback(() => {
            return (db as any).checkpoint.checkpoint();
          });

          const largeValue = { data: 'x'.repeat(100) };
          for (let i = 0; i < 20; i++) {
            await db.write(
              {
                tableName: 'test',
                key: `large-key-${i}`,
                value: largeValue
              },
              {
                flushImmediately: true
              }
            );
          }

          await (db as any).table.wal.flushWAL();

          expect(checkpointSpy).toHaveBeenCalled();

          (db as any).checkpoint.checkpoint = originalCheckpoint;

          await db.close();
        } finally {
          await new Promise((resolve) => setTimeout(resolve, 500));

          if (existsSync(uniqueTestDir)) {
            await rm(uniqueTestDir, { recursive: true, force: true }).catch((err) =>
              console.error(`Failed to clean up test dir: ${err.message}`)
            );
          }
        }
      }
    );

    test('It should flush WAL buffer to disk', async () => {
      const _db = db as any;

      _db.table.wal.walBuffer = ['W users v:1 x:0 user1 {"name":"Jane"}\n'];

      await _db.flushWAL();

      expect(await _db.table.wal.walBuffer).toEqual([]);

      const walContent = await readFile(join(testDir, 'wal.log'), 'utf8');
      expect(walContent).toContain('W users v:1 x:0 user1 {"name":"Jane"}');
    });

    test('It should not attempt to flush an empty WAL buffer', async () => {
      const _db = db as any;
      _db.table.wal.walBuffer = [];

      const appendFileSpy = vi.spyOn(fs.promises, 'appendFile');

      await _db.table.wal.flushWAL();

      expect(appendFileSpy).not.toHaveBeenCalled();
    });

    test('It should simulate API request context with WAL flushing', async () => {
      const flushSpy = vi.spyOn((db as any).table.wal, 'flushWAL');

      const simulateApiRequest = async (requestId: number) => {
        await db.get({
          tableName: 'api-requests',
          key: `previous-${requestId}`
        });

        await db.write({
          tableName: 'api-requests',
          key: `request-${requestId}`,
          value: {
            timestamp: Date.now(),
            processed: true
          }
        });

        if (requestId % 5 === 0) await db.flush();
      };

      const requests = [];
      for (let i = 1; i <= 20; i++) {
        requests.push(simulateApiRequest(i));
      }

      await Promise.all(requests);

      // Check how many times flush was called explicitly
      // Should be at least 4 times (for requestIds 5, 10, 15, 20)
      expect(flushSpy.mock.calls.length).toBeGreaterThanOrEqual(4);

      const walFile = join(testDir, 'wal.log');
      expect(existsSync(walFile)).toBe(true);
    });
  });
});

describe('Data integrity and recovery', () => {
  test('It should recover data after restart', async () => {
    const db = new MikroDB({ databaseDirectory: testDir } as any);

    await db.write(
      {
        tableName: 'recovery',
        key: 'test-key',
        value: { important: 'data' }
      },
      {
        flushImmediately: true
      }
    );

    await db.close();

    const newDb = new MikroDB({ databaseDirectory: testDir } as any);
    await newDb.start();

    const result = await newDb.get({ tableName: 'recovery', key: 'test-key' });
    expect(result).toEqual({ important: 'data' });
  });

  //test('It should recover from incomplete checkpoint', async () => {
  // TODO: Rewrite a functioning test here
  //});

  test('It should maintain operations order in WAL', async () => {
    const db = new MikroDB({ databaseDirectory: testDir } as any);

    await db.write({
      tableName: 'sequence',
      key: 'seq-key',
      value: { step: 1, value: 'initial' }
    });

    await db.write({
      tableName: 'sequence',
      key: 'seq-key',
      value: { step: 2, value: 'updated' }
    });

    await db.write({
      tableName: 'sequence',
      key: 'seq-key',
      value: { step: 3, value: 'final' }
    });

    await db.flush();

    await db.close();

    const newDb = new MikroDB({ databaseDirectory: testDir } as any);
    await newDb.start();

    // Verify final state is correct (operations were applied in order)
    const result = await newDb.get({ tableName: 'sequence', key: 'seq-key' });
    expect(result).toEqual({ step: 3, value: 'final' });
  });

  test('It should handle delete operations in WAL correctly', async () => {
    const db = new MikroDB({ databaseDirectory: testDir } as any);

    await db.write({
      tableName: 'deletion',
      key: 'item1',
      value: { id: 1 }
    });

    await db.write({
      tableName: 'deletion',
      key: 'item2',
      value: { id: 2 }
    });

    await db.delete({ tableName: 'deletion', key: 'item1' });

    await db.flush();
    await db.close();

    const newDb = new MikroDB({ databaseDirectory: testDir } as any);
    await newDb.start();

    const result1 = await newDb.get({ tableName: 'deletion', key: 'item1' });
    expect(result1).toBeUndefined();

    const result2 = await newDb.get({ tableName: 'deletion', key: 'item2' });
    expect(result2).toEqual({ id: 2 });
  });
});
