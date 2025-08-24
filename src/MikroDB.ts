import { join } from 'node:path';

import type {
  DeleteOperation,
  EventConfig,
  GetOperation,
  MikroDBOptions,
  WriteOperation,
  WriteOperationOptions
} from './interfaces/index.js';

import { Checkpoint } from './Checkpoint.js';
import { Table } from './Table.js';

import { configDefaults } from './utils/configDefaults.js';

/**
 * @description MikroDB is a Node.js-native Key-Value database
 * inspired by sqlite, but with more of the behavior and
 * semantics from Cloudflare KV and DynamoDB.
 *
 * @example
 * const db = new MikroDB({ databaseDirectory: 'my-db' }); // Optional: Will be `mikrodb` by default
 * await db.start(); // Required call to start everything up
 *
 * const tableName = 'my-table';
 * const key = 'my-key';
 *
 * await db.write({
 *   tableName,
 *   key,
 *   value: {
 *     message: 'This is how you can write an object!'
 *   }
 * });
 *
 * await db.get({ tableName, key });
 *
 * await db.delete({ tableName, key });
 *
 * await db.close();
 */
export class MikroDB {
  private readonly table: Table;
  private readonly checkpoint: Checkpoint;

  constructor(options?: MikroDBOptions) {
    const defaults = configDefaults();

    const databaseDirectory =
      options?.databaseDirectory || defaults.db.databaseDirectory;
    const walFileName = options?.walFileName || defaults.db.walFileName;
    const walInterval = options?.walInterval || defaults.db.walInterval;
    const encryptionKey = options?.encryptionKey || defaults.db.encryptionKey;
    const maxWriteOpsBeforeFlush =
      options?.maxWriteOpsBeforeFlush || defaults.db.maxWriteOpsBeforeFlush;
    const events = options?.events || {};

    if (options?.debug) process.env.DEBUG = 'true';
    if (options?.maxWriteOpsBeforeFlush)
      process.env.MAX_WRITE_OPS_BEFORE_FLUSH =
        maxWriteOpsBeforeFlush.toString();

    this.table = new Table(
      {
        databaseDirectory,
        walFileName,
        walInterval,
        encryptionKey
      },
      events as EventConfig
    );

    const wal = this.table.getWAL();

    this.table
      .getWAL()
      .setCheckpointCallback(() => this.checkpoint.checkpoint(true));

    this.checkpoint = new Checkpoint({
      table: this.table,
      wal,
      walFile: join(databaseDirectory, walFileName),
      checkpointIntervalMs: walInterval
    });

    this.checkpoint
      .start()
      .catch((error) =>
        console.error('Failed to start checkpoint service:', error)
      );
  }

  /**
   * @description Setup and start internal processes.
   */
  public async start() {
    await this.table.start();
    await this.checkpoint.start();
  }

  /**
   * @description Get an item from the database.
   * @example
   * // Get everything in table
   * await db.get({ tableName: 'my-table' });
   *
   * // Get a specific key in the table
   * await db.get({ tableName: 'my-table', key: 'my-item' });
   *
   * // You can use several types of filters
   * await db.get({
   *  tableName: 'my-table',
   *  options: {
   *    filter: {
   *      age:
   *        {
   *          operator: 'gt',
   *          value: 21
   *         }
   *       }
   *     }
   * });
   */
  public async get(operation: GetOperation) {
    return await this.table.get(operation);
  }

  /**
   * @description Get the size of a table, if it exists.
   */
  public async getTableSize(tableName: string) {
    return await this.table.getTableSize(tableName);
  }

  /**
   * @description Write one or more items to the database.
   * @example
   * await db.write({
   *   tableName,
   *   key,
   *   value: { name: 'John Doe', age: 30 },
   *   expectedVersion: 3 // Optional
   * });
   */
  public async write(
    operation: WriteOperation | WriteOperation[],
    options?: WriteOperationOptions
  ) {
    return await this.table.write(operation, options);
  }

  /**
   * @description Delete an item from the database.
   * @example
   * await db.delete({ tableName: 'users', key: 'john.doe' });
   * await db.delete({ tableName: 'users', key: 'john.doe', expectedVersion: 4 }); // Remove version 4 of this key
   */
  public async delete(operation: DeleteOperation) {
    const { tableName, key } = operation;
    const expectedVersion = operation?.expectedVersion || null;
    return await this.table.delete(tableName, key, expectedVersion);
  }

  /**
   * @description Deletes a table.
   */
  public async deleteTable(tableName: string) {
    return await this.table.deleteTable(tableName);
  }

  /**
   * @description Alias for `flush()`.
   */
  public async close() {
    if (this.checkpoint) this.checkpoint.stop();
    if (this.table?.getWAL()) this.table.getWAL().stop();

    try {
      await this.flush();
    } catch (error) {
      console.error('Error flushing during close:', error);
    }
  }

  /**
   * @description Flushes all pending operations to disk.
   * This ensures all Write Ahead Log (WAL) entries and writes are persisted.
   */
  public async flush() {
    await this.table.flush();
  }

  /**
   * @description Flush only the Write Ahead Log (WAL).
   */
  public async flushWAL() {
    await this.table.flushWAL();
  }

  /**
   * @description Dump a single—or if no table name is provided, all—tables to JSON file(s) on disk.
   */
  public async dump(tableName?: string) {
    await this.table.dump(tableName);
  }

  /**
   * @description Manually start a cleanup task to remove expired items.
   */
  public async cleanupExpiredItems() {
    await this.table.cleanupExpiredItems();
  }
}
