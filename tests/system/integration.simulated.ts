import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { MikroDB } from '../../src/MikroDB.js';

// Helper for creating test directories
const createTestDir = (name: string) => {
  const dir = join(process.cwd(), 'test-data', name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

  mkdirSync(dir, { recursive: true });
  return dir;
};

async function runFastifySimulation() {
  console.log('=== FASTIFY API SIMULATION TEST ===');

  const testDir = createTestDir('fastify-simulation');

  // Create database instance
  const db = new MikroDB({ databaseDirectory: testDir });
  await db.start();

  console.log('Simulating API requests...');

  // Simulate 50 concurrent API requests
  const requests = Array.from({ length: 50 }, async (_, i) => {
    // Simulate random delay as requests come in
    await sleep(Math.random() * 200);

    const tableName = `table${Math.floor(i / 10)}`;
    const key = `key${i}`;

    // Simulate an API handler
    async function apiHandler() {
      // Read operation
      const existingData = await db.get({
        tableName,
        key
      });

      // Write operation
      await db.write(
        {
          tableName,
          key,
          value: {
            requestId: i,
            timestamp: Date.now(),
            previousData: existingData
          }
        },
        // Some "important" writes get immediate flush
        {
          flushImmediately: i % 10 === 0
        }
      );

      return { success: true, requestId: i };
    }

    return apiHandler();
  });

  // Wait for all requests to complete
  const results = await Promise.all(requests);
  console.log(`Completed ${results.length} simulated API requests`);

  // Check if WAL was created
  const walExists = existsSync(join(testDir, 'wal.log'));
  console.log(`WAL file created: ${walExists}`);

  // Force checkpoint to ensure data is persisted
  await (db as any).checkpoint.checkpoint();
  console.log('Checkpoint completed');

  // Close the database
  await db.close();
  console.log('Database closed');

  // Reopen the database and verify data
  const reopenedDb = new MikroDB({ databaseDirectory: testDir });
  await reopenedDb.start();

  // Verify all data was persisted correctly
  let success = true;
  for (let i = 0; i < 50; i++) {
    const tableName = `table${Math.floor(i / 10)}`;
    const key = `key${i}`;

    const data = await reopenedDb.get({
      tableName,
      key
    });

    if (!data || data.requestId !== i) {
      console.error(`Data verification failed for request ${i}`);
      success = false;
      break;
    }
  }

  console.log(`Data verification after restart: ${success ? 'PASSED' : 'FAILED'}`);

  await reopenedDb.close();
  console.log('Test completed');
}

async function runCrashRecoveryTest() {
  console.log('=== CRASH RECOVERY TEST ===');

  const testDir = createTestDir('crash-recovery');

  // Create and start database
  const db = new MikroDB({ databaseDirectory: testDir });
  await db.start();

  // Insert some data
  for (let i = 0; i < 100; i++) {
    await db.write({
      tableName: 'crash-test',
      key: `item${i}`,
      value: { index: i, data: `important data ${i}` }
    });
  }

  // Verify some of the data exists
  const testItem = await db.get({
    tableName: 'crash-test',
    key: 'item50'
  });

  console.log(`Initial write verified: ${testItem.index === 50}`);

  // Force WAL to be flushed
  await (db as any).flushWAL();
  console.log('WAL flushed to disk');

  // Simulate crash by closing without shutdown
  console.log('Simulating crash (closing without proper shutdown)');
  // We're deliberately not calling db.close() to simulate a crash

  // Start a new database instance (simulating process restart)
  console.log('Restarting database after crash...');
  const recoveredDb = new MikroDB({ databaseDirectory: testDir });
  await recoveredDb.start();

  // Verify data was recovered
  let allRecovered = true;
  for (let i = 0; i < 100; i += 10) {
    // Check every 10th item
    const item = await recoveredDb.get({
      tableName: 'crash-test',
      key: `item${i}`
    });

    if (!item || item.index !== i) {
      console.error(`Failed to recover item${i}`);
      allRecovered = false;
      break;
    }
  }

  console.log(`Crash recovery test: ${allRecovered ? 'PASSED' : 'FAILED'}`);

  // Clean up
  await recoveredDb.close();
}

async function runWALCompactionTest() {
  console.log('=== WAL COMPACTION TEST ===');

  const testDir = createTestDir('wal-compaction');

  // Create database with low checkpoint threshold
  const db = new MikroDB({ databaseDirectory: testDir });
  // Patch the maxWalSizeBeforeCheckpoint to a small value
  Object.defineProperty(db, 'maxWalSizeBeforeCheckpoint', { value: 2000 }); // 2KB
  await db.start();

  console.log('Writing data to trigger WAL growth...');

  // Write enough data to trigger compaction
  const largeValue = { data: 'x'.repeat(100) };
  for (let i = 0; i < 50; i++) {
    await db.write({
      tableName: 'compaction-test',
      key: `key${i}`,
      value: largeValue
    });

    // Allow async operations to process
    await sleep(20);

    // Check WAL size occasionally
    if (i % 10 === 0 && existsSync(join(testDir, 'wal.log'))) {
      const walSize = readFileSync(join(testDir, 'wal.log'), 'utf8').length;
      console.log(`WAL size after ${i} writes: ${walSize} bytes`);
    }
  }

  // Force checkpoint to ensure compaction happened
  await (db as any).checkpoint.checkpoint();

  // Check final WAL size (should be small after checkpoint)
  const finalWalSize = readFileSync(join(testDir, 'wal.log'), 'utf8').length;
  console.log(`Final WAL size after checkpoint: ${finalWalSize} bytes`);
  console.log(`WAL compaction test: ${finalWalSize < 100 ? 'PASSED' : 'FAILED'}`);

  // Verify data is still accessible
  const testItem = await db.get({
    tableName: 'compaction-test',
    key: 'key25'
  });

  console.log(
    `Data still accessible after compaction: ${testItem && testItem.data.length === 100}`
  );

  await db.close();
}

async function runReliabilityTest() {
  console.log('=== RELIABILITY TEST ===');

  const testDir = createTestDir('reliability');
  const db = new MikroDB({ databaseDirectory: testDir });
  await db.start();

  console.log('Performing mixed read/write operations with occasional checkpoints...');

  // Set to track expected values
  const expectedValues = new Map();

  // Run a mix of operations for a period of time
  const startTime = Date.now();
  const duration = 5000; // 5 seconds
  let operationCount = 0;

  while (Date.now() - startTime < duration) {
    // Decide operation type (70% writes, 30% reads)
    const isWrite = Math.random() < 0.7;

    // Choose random table and key
    const tableIndex = Math.floor(Math.random() * 5);
    const keyIndex = Math.floor(Math.random() * 20);
    const tableName = `table${tableIndex}`;
    const key = `key${keyIndex}`;

    if (isWrite) {
      // Write operation
      const value = { timestamp: Date.now(), counter: operationCount };
      await db.write({
        tableName,
        key,
        value
      });

      // Update our expectations
      expectedValues.set(`${tableName}:${key}`, value);
    } else {
      // Read operation
      const value = await db.get({
        tableName,
        key
      });

      // If we've written this key before, verify the value matches
      const expectedKey = `${tableName}:${key}`;
      if (expectedValues.has(expectedKey)) {
        const expected = expectedValues.get(expectedKey);
        if (JSON.stringify(value) !== JSON.stringify(expected)) {
          console.error(`Consistency error: key ${expectedKey} has unexpected value`);
          console.error(`Expected: ${JSON.stringify(expected)}`);
          console.error(`Got: ${JSON.stringify(value)}`);
        }
      }
    }

    operationCount++;

    // Occasionally force a checkpoint
    if (operationCount % 100 === 0) {
      await (db as any).checkpoint.checkpoint();
      console.log(`Checkpoint after ${operationCount} operations`);
    }

    // Brief pause to allow async operations
    if (operationCount % 10 === 0) {
      await sleep(5);
    }
  }

  console.log(`Completed ${operationCount} operations in ${Date.now() - startTime}ms`);

  // Final verification after restarting DB
  await db.close();

  console.log('Restarting database to verify persistence...');
  const verifyDb = new MikroDB({ databaseDirectory: testDir });
  await verifyDb.start();

  let verificationErrors = 0;
  // Verify all expected values
  for (const [keyPair, expectedValue] of expectedValues.entries()) {
    const [tableName, key] = keyPair.split(':');
    const actualValue = await verifyDb.get({
      tableName,
      key
    });

    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      verificationErrors++;
      if (verificationErrors < 5) {
        // Limit error output
        console.error(`Verification error for ${keyPair}`);
        console.error(`Expected: ${JSON.stringify(expectedValue)}`);
        console.error(`Got: ${JSON.stringify(actualValue)}`);
      }
    }
  }

  console.log(
    `Final verification: ${verificationErrors === 0 ? 'SUCCESS' : `FAILED with ${verificationErrors} errors`}`
  );

  await verifyDb.close();
}

async function runAllTests() {
  try {
    await runFastifySimulation();
    console.log('\n');

    await runCrashRecoveryTest();
    console.log('\n');

    await runWALCompactionTest();
    console.log('\n');

    await runReliabilityTest();
    console.log('\n');

    console.log('All integration tests completed!');
  } catch (error) {
    console.error('Test suite failed:', error);
  } finally {
    process.exit();
  }
}

// Run all tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

export {
  runFastifySimulation,
  runCrashRecoveryTest,
  runWALCompactionTest,
  runReliabilityTest,
  runAllTests
};
