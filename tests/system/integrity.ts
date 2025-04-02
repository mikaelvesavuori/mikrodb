import path from 'node:path';

import { config } from '../config.js';
import { IntegrityCheck } from '../utils/IntegrityCheck.js';

const logFilePath = path.join(process.cwd(), './test-db/wal.log');
const expectedCount = config.count;
const tables = config.tableNames;

const integrityCheck = new IntegrityCheck();
const useDump = true;

for (const table of tables) {
  let dbPath = table;
  if (useDump) dbPath += '_dump.json';
  const filePath = path.join(process.cwd(), `./test-db/${dbPath}`);

  const options = {
    filePath,
    logFilePath,
    startValue: `${table}-`,
    expectedItemCount: expectedCount,
    expectedLogLineCount: expectedCount * tables.length
  };

  integrityCheck.runIntegrityChecks(options);
}
