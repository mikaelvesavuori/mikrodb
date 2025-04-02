import { existsSync, statSync, writeFileSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';

import type { ItemVersion, WalOperation } from './interfaces/index.js';

import { getJsonValueFromEntry, time } from './utils/index.js';

import { NotFoundError } from './errors/index.js';

/**
 * @description Handles the Write Ahead Log (WAL) for MikroDB.
 * The purpose of a WAL is to contain near-term logs of all
 * changes that should happen, prior to flushing (writing) them
 * to disk.
 */
export class WriteAheadLog {
  /**
   * The path to the WAL file.
   */
  private readonly walFile: string;

  /**
   * WAL flush interval in milliseconds.
   */
  private readonly walInterval: number;

  /**
   * Buffer of all WAL changes.
   */
  public walBuffer: string[] = [];

  /**
   * The maximum number of WAL entries before flushing.
   */
  private readonly maxWalBufferEntries = Number.parseInt(
    process.env.MAX_WAL_BUFFER_ENTRIES || '100'
  );

  /**
   * The maximum size of the WAL buffer before flushing.
   */
  private readonly maxWalBufferSize = Number.parseInt(
    process.env.MAX_WAL_BUFFER_SIZE || (1024 * 1024 * 0.01).toString() // 10 KB
  );

  /**
   * The maximum size of the WAL buffer before checkpointing.
   */
  private readonly maxWalSizeBeforeCheckpoint = Number.parseInt(
    process.env.MAX_WAL_BUFFER_SIZE || (1024 * 1024 * 0.01).toString() // 10 KB
  );

  /**
   * Keeps track of the last processed entries.
   */
  private lastProcessedEntryCount: Map<string, number> = new Map();

  /**
   * A callback function to run when checkpointing.
   */
  private checkpointCallback: (() => Promise<void>) | null = null;

  private walTimer: NodeJS.Timeout | null = null;

  constructor(walFile: string, walInterval: number) {
    this.walFile = walFile;
    this.walInterval = walInterval;

    this.start();
  }

  /**
   * @description Sets the checkpoint callback function.
   */
  public setCheckpointCallback(callback: () => Promise<void>): void {
    this.checkpointCallback = callback;
  }

  /**
   * @description Start the WAL functionality.
   */
  public start() {
    if (!existsSync(this.walFile)) writeFileSync(this.walFile, '', 'utf-8');

    this.walTimer = setInterval(async () => {
      try {
        if (this.walBuffer.length > 0) await this.flushWAL();
      } catch (error) {
        console.error('WAL flush interval failed:', error);
      }
    }, this.walInterval);
  }

  /**
   * @description Stop the WAL timer. Primarily used for tests.
   */
  public stop() {
    if (this.walTimer) {
      clearInterval(this.walTimer);
      this.walTimer = null;
    }
  }

  /**
   * @description Check if the WAL file exists.
   */
  private checkWalFileExists() {
    if (!existsSync(this.walFile))
      throw new NotFoundError(`WAL file "${this.walFile}" does not exist`);
  }

  /**
   * @description Load WAL entries and return operations to be applied.
   */
  public async loadWAL(table?: string): Promise<
    Array<{
      operation: 'W' | 'D';
      tableName: string;
      key: string;
      data?: {
        value: any;
        version: number;
        timestamp: number;
        expiration: number | null;
      };
    }>
  > {
    this.checkWalFileExists();

    const operations: Array<{
      operation: 'W' | 'D';
      tableName: string;
      key: string;
      data?: {
        value: any;
        version: number;
        timestamp: number;
        expiration: number | null;
      };
    }> = [];

    const walSize = statSync(this.walFile)?.size || 0;
    if (walSize === 0) return operations;

    try {
      const walData = await readFile(this.walFile, 'utf8');
      const logEntries = walData.trim().split('\n');
      const now = time();

      for (let index = 0; index < logEntries.length; index++) {
        const entry = logEntries[index];
        if (!entry.trim()) continue;

        const lastPosition = this.lastProcessedEntryCount.get(table || '') || 0;

        if (table && index < lastPosition) continue;

        const [_timestamp, operation, tableName, version, expiration, key, ...json] =
          logEntries[index].split(' ');

        if (table && tableName !== table) continue;

        const parsedVersion = Number(version.split(':')[1]);
        const parsedExpiration = expiration === '0' ? null : Number(expiration.split(':')[1]);

        if (parsedExpiration && parsedExpiration < now) continue;

        const value = getJsonValueFromEntry(json, operation);
        if (value === undefined) continue;

        if (table) this.lastProcessedEntryCount.set(table, index + 1);

        if (operation === 'W') {
          operations.push({
            operation: 'W',
            tableName,
            key,
            data: {
              value,
              version: parsedVersion,
              timestamp: now,
              expiration: parsedExpiration
            }
          });
        } else if (operation === 'D') {
          operations.push({
            operation: 'D',
            tableName,
            key
          });
        }
      }

      return operations;
    } catch (error: any) {
      if (table) console.error(`Failed to replay WAL for table "${table}": ${error.message}`);
      else console.error(`Failed to replay WAL: ${error.message}`);

      return operations;
    }
  }

  /**
   * @description Checks if there are any new WAL entries for a table.
   */
  public async hasNewWALEntriesForTable(tableName: string): Promise<boolean> {
    this.checkWalFileExists();

    try {
      const walData = await readFile(this.walFile, 'utf8');
      if (!walData.trim()) return false;

      const logEntries = walData.trim().split('\n');
      const lastEntryCount = this.lastProcessedEntryCount.get(tableName) || 0;

      if (lastEntryCount >= logEntries.length) return false;

      for (let i = lastEntryCount; i < logEntries.length; i++) {
        const entry = logEntries[i];
        if (!entry.trim()) continue;

        const parts = entry.split(' ');
        if (parts.length >= 3 && parts[2] === tableName) return true;
      }

      return false;
    } catch (error) {
      console.error(`Error checking WAL for ${tableName}:`, error);
      return true;
    }
  }

  /**
   * @description Flush the WAL buffer to disk.
   */
  public async flushWAL() {
    this.checkWalFileExists();

    if (this.walBuffer.length === 0) return;

    const bufferToFlush = [...this.walBuffer];
    this.walBuffer = [];

    try {
      await appendFile(this.walFile, bufferToFlush.join(''), 'utf8');

      // Check file size AFTER flushing
      const stats = statSync(this.walFile);
      if (stats.size > this.maxWalSizeBeforeCheckpoint) {
        if (process.env.DEBUG === 'true')
          console.log(
            `WAL size (${stats.size}) exceeds limit (${this.maxWalSizeBeforeCheckpoint}), triggering checkpoint`
          );

        if (this.checkpointCallback) {
          setImmediate(async () => {
            try {
              // @ts-ignore
              await this.checkpointCallback();
            } catch (error) {
              console.error('Error during automatic checkpoint:', error);
            }
          });
        }
      }
    } catch (error: any) {
      console.error(`Failed to flush WAL: ${error.message}`);
      this.walBuffer = [...bufferToFlush, ...this.walBuffer];
      throw error;
    }
  }

  /**
   * @description Append operation to the WAL (with version, timestamp, and expiration).
   */
  public async appendToWAL(
    tableName: string,
    operation: WalOperation,
    key: string,
    value: any,
    version: ItemVersion,
    expiration = 0
  ) {
    this.checkWalFileExists();

    const timestamp = time();
    const logEntry = `${timestamp} ${operation} ${tableName} v:${version} x:${expiration} ${key} ${JSON.stringify(value)}\n`;
    this.walBuffer.push(logEntry);

    if (this.walBuffer.length >= this.maxWalBufferEntries) await this.flushWAL();

    const estimatedBufferSize = this.walBuffer.reduce((size, entry) => size + entry.length, 0);
    if (estimatedBufferSize >= this.maxWalBufferSize) await this.flushWAL();

    const stats = statSync(this.walFile);
    if (stats.size > this.maxWalSizeBeforeCheckpoint) {
      if (process.env.DEBUG === 'true')
        console.log(
          `WAL size (${stats.size}) exceeds limit (${this.maxWalSizeBeforeCheckpoint}), triggering checkpoint`
        );

      if (this.checkpointCallback) {
        setImmediate(async () => {
          try {
            // @ts-ignore
            await this.checkpointCallback();
          } catch (error) {
            console.error('Error during automatic checkpoint:', error);
          }
        });
      }
    }
  }

  /**
   * @description Reset the count or position of the last processed entries that are tracked.
   */
  public clearPositions() {
    this.lastProcessedEntryCount.clear();
  }
}
