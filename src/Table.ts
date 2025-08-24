import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MikroEvent } from 'mikroevent';

import type {
  ChangeDataCaptureEventName,
  EventConfig,
  GetOperation,
  ItemVersionIntegrityResult,
  TableOptions,
  WriteOperation,
  WriteOperationOptions
} from './interfaces/index.js';

import { Cache } from './Cache.js';
import { Encryption } from './Encryption.js';
import { Persistence } from './Persistence.js';
import { Query } from './Query.js';
import { WriteAheadLog } from './WriteAheadLog.js';

import { configDefaults } from './utils/configDefaults.js';
import { time } from './utils/index.js';
import { writeToDisk } from './utils/writeToDisk.js';

/**
 * @description Handles table access, including reads, writes, etc.
 */
export class Table {
  /**
   * Directory where the table files will be stored.
   */
  private readonly databaseDirectory: string;

  /**
   * Write-ahead log file path.
   */
  private readonly walFile: string;

  /**
   * Tracks the currently active table.
   */
  private activeTable: string | null = null;

  /**
   * In-memory store for active tables.
   */
  private data: Map<string, Map<string, any>> = new Map();

  /**
   * Buffer to store committed write operations before flushing them to disk.
   */
  private writeBuffer: string[] = [];

  /**
   * The maximum number of writes that happen before flushing data to disk.
   */
  private readonly maxWriteOpsBeforeFlush = process.env
    .MAX_WRITE_OPS_BEFORE_FLUSH
    ? Number.parseInt(process.env.MAX_WRITE_OPS_BEFORE_FLUSH, 10)
    : configDefaults().db.maxWriteOpsBeforeFlush;

  /**
   * Optional encryption key to use for encrypt and decrypt actions.
   */
  private readonly encryptionKey: string | null;

  // Class references
  private readonly cache: Cache;
  private readonly encryption: Encryption;
  private readonly persistence: Persistence;
  private readonly query: Query;
  private readonly wal: WriteAheadLog;
  private readonly mikroEvent: MikroEvent;

  constructor(options: TableOptions, eventOptions: EventConfig) {
    const { databaseDirectory, walFileName, walInterval } = options;

    this.databaseDirectory = databaseDirectory;
    this.walFile = join(this.databaseDirectory, walFileName);
    this.encryptionKey = options.encryptionKey ? options.encryptionKey : null;

    if (!existsSync(this.databaseDirectory)) mkdirSync(this.databaseDirectory);

    this.cache = new Cache();
    this.encryption = new Encryption();
    this.persistence = new Persistence();
    this.query = new Query();
    this.wal = new WriteAheadLog(this.walFile, walInterval);
    this.mikroEvent = new MikroEvent();

    this.setupEvents(eventOptions);
  }

  /**
   * @description Start the table and apply any stale/dormant WAL entries at once.
   */
  public async start() {
    await this.applyWALEntries();
  }

  /**
   * @description Setup change data capture to stream events with MikroEvent.
   * @see https://github.com/mikaelvesavuori/mikroevent
   */
  private setupEvents(config: EventConfig) {
    config?.targets?.forEach((target) => {
      this.mikroEvent.addTarget({
        name: target.name,
        url: target.url,
        headers: target.headers,
        events: target.events
      });
    });

    config?.listeners?.map((listener) =>
      this.mikroEvent.on(listener.event, listener.handler)
    );
  }

  /**
   * @description Switch the active table by loading it into memory if it's not already loaded.
   * The table will be created if it does not exist.
   */
  public async setActiveTable(tableName: string) {
    if (this.activeTable === tableName) return;

    if (!this.hasTable(tableName)) await this.loadTable(tableName);

    await this.applyWALEntries(tableName);

    await this.evictTablesIfNeeded();

    this.activeTable = tableName;
  }

  /**
   * @description Apply WAL entries with optional table filtering.
   */
  private async applyWALEntries(tableName?: string): Promise<void> {
    const operations = await this.wal.loadWAL(tableName);
    if (operations.length === 0) return;

    const tables = tableName
      ? [tableName]
      : [...new Set(operations.map((op) => op.tableName))];

    for (const table of tables) {
      const tableOps = operations.filter((op) => op.tableName === table);

      if (tableName && !this.hasTable(table)) await this.loadTable(table);
      else this.createTable(table);

      for (const op of tableOps) {
        if (op.operation === 'W' && op.data)
          this.setItem(table, op.key, op.data);
        else if (op.operation === 'D') await this.deleteItem(table, op.key);
      }
    }
  }

  /**
   * @description Load the table from disk into memory using a binary format.
   */
  private async loadTable(tableName: string): Promise<void> {
    if (this.hasTable(tableName)) return;

    const filePath = join(this.databaseDirectory, tableName);

    if (!existsSync(filePath)) {
      this.createTable(tableName);
      return;
    }

    const encryptedBuffer = await readFile(filePath);
    let fileBuffer = encryptedBuffer;

    if (
      this.encryptionKey &&
      encryptedBuffer.length > 0 &&
      encryptedBuffer[0] === 1
    ) {
      try {
        const encryptedData = this.encryption.deserialize(encryptedBuffer);
        const key = this.encryption.generateKey(this.encryptionKey, 'salt');
        const decryptedString = this.encryption.decrypt(encryptedData, key);
        fileBuffer = Buffer.from(decryptedString, 'binary');
      } catch (error) {
        console.error(`Failed to decrypt ${tableName}:`, error);
      }
    }

    if (encryptedBuffer.length < 8) {
      console.warn(`Table file ${tableName} is too small, recreating...`);
      this.createTable(tableName);
      return;
    }

    const tableData = this.persistence.readTableFromBinaryBuffer(fileBuffer);
    this.data.set(tableName, tableData);

    if (this.data.size > this.cache.cacheLimit)
      setImmediate(() => this.evictTablesIfNeeded());
  }

  /**
   * @description Get data with optional filtering and sorting.
   */
  public async get(operation: GetOperation) {
    const { tableName } = operation;
    const key = operation.key;
    const options = operation.options;

    await this.setActiveTable(tableName);

    if (!options) {
      // No key or options provided, get all items
      if (!key) return [...this.getAll(tableName)];

      // A key but no options, so get a single item KV-style
      return this.getItem(tableName, key)?.value;
    }

    const table = this.getTable(tableName);
    let results = await this.query.query(table, options.filter, options.limit);

    if (options.sort) results = results.sort(options.sort);

    if (options.offset != null || options.limit != null) {
      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : undefined;
      results = results.slice(start, end);
    }

    return results;
  }

  /**
   * @description Perform a batch write operation, which allows multiple writes to different tables.
   */
  public async write(
    operation: WriteOperation | WriteOperation[],
    options: WriteOperationOptions = {}
  ): Promise<boolean> {
    const { concurrencyLimit = 10, flushImmediately = false } = options;

    const operations = Array.isArray(operation) ? operation : [operation];
    const totalOperations = operations.length;
    let processedOperations = 0;

    while (processedOperations < totalOperations) {
      // Process in batches of concurrencyLimit
      const batch = operations.slice(
        processedOperations,
        processedOperations + concurrencyLimit
      );

      const promises = batch.map((operation) =>
        this.writeItem(operation, false)
      );
      const results = await Promise.all(promises);

      if (results.includes(false)) return false;

      processedOperations += batch.length;

      // Flush writes when we've processed maxWriteOpsBeforeFlush items
      if (this.writeBuffer.length >= this.maxWriteOpsBeforeFlush)
        await this.flushWrites();
    }

    // If requested or batch is complete, ensure everything is flushed
    if (flushImmediately || totalOperations >= 0) await this.flush();

    return true;
  }

  /**
   * @description Write data to the active table with version control and expiration.
   */
  private async writeItem(
    operation: WriteOperation,
    flushImmediately = false
  ): Promise<boolean> {
    const {
      tableName,
      key,
      value,
      expectedVersion = null,
      expiration = 0
    } = operation;

    await this.setActiveTable(tableName);

    const { success, newVersion } = this.getItemVersion(
      tableName,
      key,
      expectedVersion
    );
    if (!success) return false;

    await this.wal.appendToWAL(
      tableName,
      'W',
      key,
      value,
      newVersion,
      expiration
    );

    this.setItem(tableName, key, {
      value,
      v: newVersion,
      t: time(),
      x: expiration
    });

    this.addToWriteBuffer(tableName, key);

    if (flushImmediately) await this.flush();

    return true;
  }

  /**
   * @description Delete a key from a table with version control and expiration.
   */
  public async delete(
    tableName: string,
    key: string,
    expectedVersion: number | null = null,
    flushImmediately = false
  ): Promise<boolean> {
    await this.setActiveTable(tableName);

    if (!this.hasTable(tableName) || !this.hasKey(tableName, key)) {
      console.log(`Key ${key} not found in table ${tableName}`);
      return false;
    }

    const { success, currentVersion, expiration } = this.getItemVersion(
      tableName,
      key,
      expectedVersion
    );
    if (!success) return false;

    await this.wal.appendToWAL(
      tableName,
      'D',
      key,
      null,
      currentVersion,
      expiration
    );

    await this.deleteItem(tableName, key);

    if (flushImmediately) await this.flush();

    return true;
  }

  /**
   * @description Get a version of an item.
   */
  private getItemVersion(
    tableName: string,
    key: string,
    expectedVersion: number | null
  ): ItemVersionIntegrityResult {
    const currentRecord = this.getItem(tableName, key);
    const currentVersion = currentRecord ? currentRecord.version : 0;
    const newVersion = currentVersion + 1;
    const expiration = currentRecord ? currentRecord.expiration || 0 : 0;

    let success = true;

    if (expectedVersion !== null && currentVersion !== expectedVersion) {
      console.log(
        `Version mismatch for ${tableName}:${key}. Expected ${expectedVersion}, found ${currentVersion}`
      );
      success = false;
    }

    return { success, currentRecord, currentVersion, newVersion, expiration };
  }

  ////////////////////////////////////
  // Public methods towards MikroDB //
  ////////////////////////////////////

  /**
   * @description Create a table if it does not exist.
   */
  public createTable(tableName: string) {
    this.trackTableAccess(tableName);

    if (!this.hasTable(tableName)) this.data.set(tableName, new Map());
  }

  /**
   * @description Get a table.
   */
  public getTable(tableName: string) {
    this.trackTableAccess(tableName);

    if (!this.hasTable(tableName)) return new Map<string, Map<string, any>>();
    return this.data.get(tableName) as Map<string, any>;
  }

  /**
   * @description Get the size of a table.
   */
  public async getTableSize(tableName: string) {
    await this.setActiveTable(tableName);
    this.trackTableAccess(tableName);

    return this.data.get(tableName)?.size;
  }

  /**
   * @description Delete a table.
   */
  public async deleteTable(tableName: string) {
    this.trackTableAccess(tableName);

    this.data.delete(tableName);

    const operation: ChangeDataCaptureEventName = 'table.deleted';
    const { success, errors } = await this.mikroEvent.emit(operation, {
      operation,
      table: tableName
    });
    if (!success) console.error('Error when emitting events:', errors);
  }

  /**
   * @description Check if a table exists.
   */
  public hasTable(tableName: string) {
    this.trackTableAccess(tableName);

    return this.data.has(tableName);
  }

  /**
   * @description Check if a table has a given key.
   */
  public hasKey(tableName: string, key: string) {
    this.trackTableAccess(tableName);
    return this.data.get(tableName)?.has(key);
  }

  /**
   * @description Get an item.
   */
  public getItem(tableName: string, key: string) {
    this.trackTableAccess(tableName);
    const item = this.data.get(tableName)?.get(key);

    if (!item) return;
    if (item?.x !== 0 && Date.now() > item?.x) {
      this.deleteItem(tableName, key); // FIXME? This should be awaited but ignoring that for now as that would mean substantial changes...
      return;
    }

    return {
      value: item.value,
      version: item.v,
      timestamp: item.t,
      expiration: item.x
    };
  }

  /**
   * @description Get all items from a table.
   */
  public getAll(tableName: string) {
    this.trackTableAccess(tableName);
    const data = this.data.get(tableName);
    if (!data) return [];

    return Array.from(data);
  }

  /**
   * @description Set an item in a table.
   */
  private setItem(tableName: string, key: string, item: any) {
    this.trackTableAccess(tableName);
    this.createTable(tableName);

    this.data.get(tableName)?.set(key, item);
  }

  /**
   * @description Delete an item from a table.
   */
  private async deleteItem(tableName: string, key: string) {
    this.data.get(tableName)?.delete(key);

    const operation: ChangeDataCaptureEventName = 'item.deleted';
    const { success, errors } = await this.mikroEvent.emit(operation, {
      operation,
      table: tableName,
      key
    });
    if (!success) console.error('Error when emitting events:', errors);
  }

  /**
   * @description Add item to write buffer.
   */
  private addToWriteBuffer(tableName: string, key: string) {
    const record = this.getItem(tableName, key);
    this.writeBuffer.push(JSON.stringify({ tableName, key, record }));
  }

  /**
   * @description Update in methods that access tables.
   */
  private trackTableAccess(tableName: string) {
    this.cache.trackTableAccess(tableName);
  }

  /**
   * @description Flush the WAL and any writes.
   */
  public async flush() {
    await this.flushWAL();
    await this.flushWrites();
  }

  /**
   * @description Flush only the WAL.
   */
  public async flushWAL() {
    await this.wal.flushWAL();
  }

  /**
   * @description Flush buffered writes to their respective table files using a binary format.
   */
  public async flushWrites() {
    if (this.writeBuffer.length === 0) return;

    try {
      const tableOperations = new Map<string, Map<string, any>>();
      const bufferSnapshot = [...this.writeBuffer];

      for (const entry of bufferSnapshot) {
        const operation = JSON.parse(entry);

        if (!tableOperations.has(operation.tableName))
          tableOperations.set(operation.tableName, new Map());

        // biome-ignore lint/style/noNonNullAssertion: Will not be a problem
        const tableData = tableOperations.get(operation.tableName)!;
        tableData.set(operation.key, operation.record);

        const operationName: ChangeDataCaptureEventName = 'item.written';
        const { success, errors } = await this.mikroEvent.emit(operationName, {
          operation: operationName,
          table: operation.tableName,
          key: operation.key,
          record: operation.record
        });
        if (!success) console.error('Error when emitting events:', errors);
      }

      const writePromises = Array.from(tableOperations.entries()).map(
        async ([tableName]) => {
          const fullTableData = this.getTable(tableName);
          const tablePath = join(this.databaseDirectory, tableName);
          await writeToDisk(tablePath, fullTableData, this.encryptionKey);
        }
      );

      await Promise.all(writePromises);

      // Clear only the processed entries
      this.writeBuffer = this.writeBuffer.slice(bufferSnapshot.length);
    } catch (error: any) {
      console.error(`Failed to flush writes: ${error.message}`);
    }
  }

  /**
   * @description Write (flush) a table to disk.
   */
  public async flushTableToDisk(tableName: string): Promise<void> {
    await this.setActiveTable(tableName);

    const tableData = this.getTable(tableName);
    if (tableData.size === 0) return;

    for (const [key, _] of tableData.entries())
      this.addToWriteBuffer(tableName, key);

    await this.flushWrites();
  }

  /**
   * @description Evict any tables that are flagged for cleaning.
   */
  private async evictTablesIfNeeded() {
    const tablesToEvict = this.cache.findTablesForEviction(this.data.size);

    for (const tableName of tablesToEvict) {
      // First, ensure any pending changes are written to disk
      await this.flushTableToDisk(tableName);

      this.data.delete(tableName);
    }
  }

  /**
   * @description Remove expired items from all tables.
   */
  public async cleanupExpiredItems() {
    for (const [tableName, tableData] of this.data.entries()) {
      const expiredItems = this.cache.findExpiredItems(tableData);

      for (const [key, item] of expiredItems) {
        await this.wal.appendToWAL(tableName, 'D', key, null, item.v, item.x);
        tableData.delete(key);

        const operation: ChangeDataCaptureEventName = 'item.expired';
        const { success, errors } = await this.mikroEvent.emit(operation, {
          operation,
          table: tableName,
          key,
          record: item
        });
        if (!success) console.error('Error when emitting events:', errors);
      }
    }
  }

  /**
   * @description Dump (write) one or more tables to disk in JSON format.
   */
  public async dump(tableName?: string) {
    if (tableName) await this.setActiveTable(tableName);

    // biome-ignore lint/style/noNonNullAssertion: The activeTable value should always exist
    const table = this.getAll(this.activeTable!);

    await writeFile(
      `${this.databaseDirectory}/${this.activeTable}_dump.json`,
      JSON.stringify(table),
      'utf8'
    );
  }

  /**
   * @description Returns the WAL instance.
   */
  public getWAL() {
    return this.wal;
  }

  /**
   * @description Returns the Persistence instance.
   */
  public getPersistence() {
    return this.persistence;
  }
}
