import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';

import type { CheckpointOptions } from './interfaces/index.js';

import type { Table } from './Table.js';
import type { WriteAheadLog } from './WriteAheadLog.js';

import { time } from './utils/index.js';

import { CheckpointError, NotFoundError } from './errors/index.js';

/**
 * @description Handles "checkpointing" or offloading new items
 * in the Write Ahead Log (WAL) into persistence at certain intervals.
 */
export class Checkpoint {
  /**
   * Checkpoint interval in milliseconds.
   */
  private readonly checkpointInterval: number;

  /**
   * Default time in milliseconds before checkpointing.
   */
  private defaultCheckpointIntervalMs = 10 * 1000;

  /**
   * Flag to prevent concurrent checkpoints.
   */
  private isCheckpointing = false;

  /**
   * Timestamp of the last successful checkpoint.
   */
  private lastCheckpointTime = 0;

  /**
   * Write-ahead log file path.
   */
  private readonly walFile: string;

  /**
   * Checkpoint interval timer.
   */
  private checkpointTimer: NodeJS.Timeout | null = null;

  private readonly wal: WriteAheadLog;
  private readonly table: Table;

  constructor(options: CheckpointOptions) {
    const { table, wal, walFile, checkpointIntervalMs } = options;
    this.defaultCheckpointIntervalMs =
      checkpointIntervalMs || this.defaultCheckpointIntervalMs;

    this.table = table;
    this.wal = wal;
    this.walFile = walFile;
    this.checkpointInterval = checkpointIntervalMs;
    this.lastCheckpointTime = time();
  }

  /**
   * @description Start the checkpoint service.
   */
  public async start(): Promise<void> {
    const checkpointFile = `${this.walFile}.checkpoint`;

    if (existsSync(checkpointFile)) {
      console.log('Incomplete checkpoint detected, running recovery...');

      try {
        const checkpointTimestamp = await readFile(checkpointFile, 'utf8');
        console.log(
          `Incomplete checkpoint from: ${new Date(Number.parseInt(checkpointTimestamp))}`
        );

        await this.checkpoint(true);
      } catch (error) {
        throw new NotFoundError(`Error reading checkpoint file: ${error}`);
      }
    }

    this.checkpointTimer = setInterval(async () => {
      try {
        await this.checkpoint();
      } catch (error) {
        throw new CheckpointError(`Checkpoint interval failed: ${error}`);
      }
    }, this.checkpointInterval);
  }

  /**
   * @description Stop the checkpoint service.
   */
  public stop(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }

    this.isCheckpointing = false;
  }

  /**
   * @description Perform a checkpoint operation to clean up WAL.
   * This ensures all tables mentioned in the WAL are persisted to disk,
   * and then truncates the WAL file.
   */
  public async checkpoint(force = false): Promise<void> {
    // Prevent concurrent checkpoints with better protection
    if (this.isCheckpointing) {
      if (process.env.DEBUG === 'true')
        console.log('Checkpoint already in progress, skipping');
      return;
    }

    const now = time();
    if (!force && now - this.lastCheckpointTime < this.checkpointInterval)
      return;

    this.isCheckpointing = true;
    const checkpointFile = `${this.walFile}.checkpoint`;

    try {
      // Double-check no other process is checkpointing
      if (existsSync(checkpointFile)) {
        if (process.env.DEBUG === 'true')
          console.log(
            'Checkpoint file exists, another process is checkpointing'
          );
        return;
      }

      await this.wal.flushWAL();
      await writeFile(checkpointFile, now.toString(), 'utf8');

      const tablesInWAL = await this.getTablesFromWAL();
      await this.persistTables(tablesInWAL);

      // Truncate WAL
      await writeFile(this.walFile, '', 'utf8');
      if (process.env.DEBUG === 'true')
        console.log('WAL truncated successfully');

      // Safe cleanup of checkpoint file
      try {
        await unlink(checkpointFile);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw new CheckpointError(
            `Failed to delete checkpoint file: ${error}`
          );
        }
      }

      this.wal.clearPositions();
      this.lastCheckpointTime = now;
      if (process.env.DEBUG === 'true') console.log('Checkpoint complete');
    } catch (error: any) {
      throw new CheckpointError(`Checkpoint failed: ${error}`);
    } finally {
      this.isCheckpointing = false;
    }
  }

  /**
   * @description Extract table names from WAL entries.
   */
  private async getTablesFromWAL(): Promise<Set<string>> {
    const tablesInWAL = new Set<string>();

    if (!existsSync(this.walFile)) return tablesInWAL;

    try {
      const walContent = await readFile(this.walFile, 'utf8');
      if (!walContent.trim()) return tablesInWAL;

      const entries = walContent.trim().split('\n');

      for (const entry of entries) {
        if (!entry.trim()) continue;

        // Parse WAL entry: "timestamp operation tableName ..."
        const parts = entry.split(' ');
        if (parts.length >= 3) tablesInWAL.add(parts[2]);
      }
    } catch (error) {
      throw new CheckpointError(`Error reading WAL file: ${error}`);
    }

    return tablesInWAL;
  }

  /**
   * @description Persist tables to disk.
   */
  private async persistTables(tableNames: Set<string>): Promise<void> {
    const persistPromises = Array.from(tableNames).map(async (tableName) => {
      try {
        await this.table.flushTableToDisk(tableName);
        console.log(`Checkpointed table "${tableName}"`);
      } catch (error: any) {
        throw new CheckpointError(
          `Failed to checkpoint table "${tableName}": ${error.message}`
        );
      }
    });

    await Promise.all(persistPromises);
  }
}
