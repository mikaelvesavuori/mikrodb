import { TestData } from './TestData.js';

import { config } from '../config.js';

(() => {
  const testData = new TestData();

  for (const tableName of config.tableNames) {
    testData.generateDataForTable(tableName, config.count);
  }
})();
