/**
 * @description MikroDB test configuration object.
 */
export const config = {
  /**
   * The database name.
   */
  databaseName: 'test-db',
  /**
   * Tables to use.
   */
  tableNames: ['users', 'orders', 'products', 'employees', 'events'],
  /**
   * Count of items to write per table.
   */
  count: 100,
  /**
   * Shuffle records or write them linearly?
   */
  shuffle: true,
  /**
   * Dump tables to JSON?
   */
  dumpTables: true
};
