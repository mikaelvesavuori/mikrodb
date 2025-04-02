import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { MikroDB } from '../../src/MikroDB.js';

const TEST_DB_DIR = join(process.cwd(), 'stress-test-db');
const TABLES = 10;
const OPERATIONS_PER_TABLE = 300;
const BATCH_SIZE = 50;
const READ_PERCENTAGE = 70;
const KEY_RANGE = 500;

const stats = {
  totalOperations: 0,
  reads: 0,
  writes: 0,
  deletes: 0,
  startTime: 0,
  endTime: 0,
  errors: 0
};

/**
 * Run the stress test
 */
async function runStressTest() {
  console.log('Starting MikroDB stress test...');

  if (existsSync(TEST_DB_DIR)) rmSync(TEST_DB_DIR, { recursive: true, force: true });

  mkdirSync(TEST_DB_DIR, { recursive: true });

  const db = new MikroDB({ databaseDirectory: TEST_DB_DIR });
  await db.start();

  stats.startTime = Date.now();

  try {
    for (let i = 0; i < OPERATIONS_PER_TABLE; i += BATCH_SIZE) {
      const operationPromises = [];

      for (let tableIndex = 0; tableIndex < TABLES; tableIndex++) {
        const tableName = `stress-table-${tableIndex}`;

        for (let j = 0; j < BATCH_SIZE; j++) {
          const operationType = Math.random() * 100;

          const key = `key-${Math.floor(Math.random() * KEY_RANGE)}`;

          if (operationType < READ_PERCENTAGE) {
            operationPromises.push(
              (async () => {
                try {
                  const resp = await db.get({ tableName, key });
                  if (!resp) throw new Error();
                  stats.reads++;
                  stats.totalOperations++;
                } catch (err) {
                  console.error(`Read error for ${tableName}:${key}:`, err);
                  stats.errors++;
                }
              })()
            );
          } else if (operationType < 95) {
            operationPromises.push(
              (async () => {
                try {
                  await db.write({
                    tableName,
                    key,
                    value: {
                      timestamp: Date.now(),
                      iteration: i + j,
                      randomData: Math.random().toString(36).substring(2, 15)
                    }
                  });
                  stats.writes++;
                  stats.totalOperations++;
                } catch (err) {
                  console.error(`Write error for ${tableName}:${key}:`, err);
                  stats.errors++;
                }
              })()
            );
          } else {
            operationPromises.push(
              (async () => {
                try {
                  await db.delete({ tableName, key });
                  stats.deletes++;
                  stats.totalOperations++;
                } catch (_err) {
                  // Ignore errors on delete - key might not exist
                  // Don't count these as errors
                }
              })()
            );
          }
        }
      }

      await Promise.all(operationPromises);

      if ((i / BATCH_SIZE) % 10 === 0) {
        const progress = Math.round((i / OPERATIONS_PER_TABLE) * 100);
        console.log(`Progress: ${progress}% - Operations: ${stats.totalOperations}`);
      }
    }

    stats.endTime = Date.now();

    printStats();

    await db.flush();
    await db.close();
    console.log('Stress test completed successfully');
  } catch (error) {
    console.error('Stress test failed:', error);
    stats.endTime = Date.now();
    printStats();
  }
}

/**
 * Print statistics from the test run
 */
function printStats() {
  const duration = (stats.endTime - stats.startTime) / 1000; // in seconds

  console.log('\n----- STRESS TEST RESULTS -----');
  console.log(`Total time: ${duration.toFixed(2)} seconds`);
  console.log(`Total operations: ${stats.totalOperations}`);
  console.log(`  - Reads: ${stats.reads}`);
  console.log(`  - Writes: ${stats.writes}`);
  console.log(`  - Deletes: ${stats.deletes}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Operations per second: ${(stats.totalOperations / duration).toFixed(2)}`);

  try {
    const walSize = statSync(join(TEST_DB_DIR, 'wal.log')).size;
    console.log(`WAL file size: ${(walSize / 1024).toFixed(2)} KB`);

    const files = readdirSync(TEST_DB_DIR);
    let totalTableSize = 0;

    for (const file of files) {
      if (file.startsWith('stress-table-')) {
        const stats = statSync(join(TEST_DB_DIR, file));
        totalTableSize += stats.size;
      }
    }

    console.log(`Table files size: ${(totalTableSize / 1024).toFixed(2)} KB`);
    console.log(`Total database size: ${((walSize + totalTableSize) / 1024).toFixed(2)} KB`);
  } catch (error: any) {
    console.error('Could not calculate database size:', error.message);
  }

  console.log('-------------------------------');
}

// Run the stress test
runStressTest()
  .catch((err) => {
    console.error('Uncaught error in stress test:', err);
    process.exit(1);
  })
  .finally(() => process.exit());
