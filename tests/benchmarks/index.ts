import { TestData } from '../utils/TestData.js';
import { memoryUsage } from '../utils/memoryUsage.js';

import { config } from '../config.js';

const testData = new TestData();

/**
 * @description Runs a stress test, like a "benchmark".
 */
export async function benchmark(
  db: any,
  tableNames: string[],
  count = 10,
  shuffle = false
) {
  console.log('Memory use before tests', memoryUsage());

  performance.mark('start');

  const data = [];

  for (const tableName of tableNames) {
    data.push(...testData.generateDataForTable(tableName, count));
  }

  if (shuffle) testData.shuffle(data);

  await db.write(data);

  for (const tableName of tableNames) {
    if (config.dumpTables) await db.dump(tableName);
  }

  console.log('Memory use after tests', memoryUsage());

  performance.mark('end');
  performance.measure('Total Generation Time', 'start', 'end');

  const totalDuration = performance.getEntriesByName('Total Generation Time')[0]
    ?.duration;
  console.log(`Total Generation Time: ${totalDuration}ms`);

  performance.clearMarks();
  performance.clearMeasures();
}
