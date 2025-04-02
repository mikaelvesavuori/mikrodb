import { MikroDB } from '../../src/MikroDB.js';
import { benchmark } from './index.js';

import { config } from '../config.js';

async function benchmarkMikroDB() {
  const opsDivision = 1;

  process.env.MAX_WRITE_OPS_BEFORE_FLUSH = (config.count / opsDivision).toString();

  const dbPath = config.databaseName;
  const db = new MikroDB({ databaseDirectory: dbPath });
  await db.start();

  const { tableNames, count, shuffle } = config;

  await benchmark(db, tableNames, count, shuffle);

  process.env.MAX_WRITE_OPS_BEFORE_FLUSH = '';
  process.exit();
}

// Run
benchmarkMikroDB();
