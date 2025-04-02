import fs from 'node:fs/promises';
import path from 'node:path';

import { Table } from '../../src/Table.js';

async function test() {
  const testDir = path.resolve('./test-db');
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (_e) {}

  const db = new Table(
    {
      databaseDirectory: testDir,
      walFileName: 'wal.log',
      encryptionKey: 'test-key',
      walInterval: 2000
    },
    {} as any
  );

  await db.write(
    {
      tableName: 'test',
      key: 'testKey',
      value: { message: 'This should be encrypted' }
    },
    { flushImmediately: true }
  );

  const filePath = path.join(testDir, 'test');
  const fileContent = await fs.readFile(filePath);
  console.log('File starts with byte:', fileContent[0]);

  await db.flush();

  const plainDb = new Table(
    {
      databaseDirectory: testDir,
      walFileName: 'wal.log',
      walInterval: 2000
    },
    {} as any
  );

  const plainValue = await plainDb.get({ tableName: 'test', key: 'testKey' });
  console.log('Reading without key:', plainValue);
}

test();
