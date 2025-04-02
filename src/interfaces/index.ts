import type { Table } from '../Table.js';
import type { WriteAheadLog } from '../WriteAheadLog.js';

/**
 * @description Valid Write Ahead Log operations.
 * `W` is for `write`, and `D` is for `delete`.
 */
export type WalOperation = 'W' | 'D';

/**
 * @description Options for write operations.
 */
export type WriteOperationOptions = {
  concurrencyLimit?: number;
  flushImmediately?: boolean;
};

/**
 * @description Write data operation.
 */
export type WriteOperation = {
  tableName: string;
  key: string;
  value: any;
  expectedVersion?: ItemVersion;
  expiration?: number;
};

/**
 * @description The result of getting an item version.
 */
export type ItemVersionIntegrityResult = {
  success: boolean;
  currentRecord: any;
  currentVersion: ItemVersion;
  newVersion: ItemVersion;
  expiration: number;
};

/**
 * @description The version of an item.
 */
export type ItemVersion = number | null;

/**
 * @description Supported filter operators.
 */
export type FilterOperator =
  | 'eq' // equals
  | 'neq' // not equals
  | 'gt' // greater than
  | 'gte' // greater than or equals
  | 'lt' // less than
  | 'lte' // less than or equals
  | 'in' // in array
  | 'nin' // not in array
  | 'like' // string contains
  | 'between' // between two values
  | 'regex' // regex match
  | 'contains' // array contains value
  | 'containsAll' // array contains all values
  | 'containsAny' // array contains any values
  | 'size' // array size equals
  | 'or'; // logical OR

/**
 * @description Filter condition.
 */
export interface FilterCondition {
  operator: FilterOperator;
  value: any;
}

/**
 * @description Complex filter query structure supporting nested conditions.
 */
export type FilterQuery = {
  [key: string]: FilterCondition | FilterQuery | any;
};

/**
 * @description Options to use when initializing MikroDB.
 */
export type MikroDBOptions = {
  databaseDirectory: string;
  walFileName?: string;
  walInterval?: number;
  encryptionKey?: string;
  maxWriteOpsBeforeFlush?: number;
  debug?: boolean;
  events?: EventConfig;
};

/**
 * @description Options to use when instantiating the Table class.
 */
export type TableOptions = {
  databaseDirectory: string;
  walFileName: string;
  walInterval: number;
  encryptionKey?: string;
};

/**
 * @description Configuration for change data capture events.
 * Currently the emitted events are:
 * - `write.flushed`
 */
export interface EventConfig {
  targets: {
    name: string;
    url?: string;
    headers?: Record<string, string>;
    events: string[];
  }[];
  listeners: {
    event: string;
    handler: (...args: any[]) => void;
  }[];
}

/**
 * @description Options to use when instantiating the Checkpoint class.
 */
export type CheckpointOptions = {
  table: Table;
  wal: WriteAheadLog;
  walFile: string;
  checkpointIntervalMs: number;
};

/**
 * @description Cache options.
 */
export interface CacheOptions {
  /**
   * Max number of tables to cache in memory.
   */
  cacheLimit?: number;
}

/**
 * Valid names for Change Data Capture events.
 */
export type ChangeDataCaptureEventName =
  | 'item.deleted'
  | 'item.expired'
  | 'item.written'
  | 'table.deleted';

/**
 * @description The full, combined set of configurations
 * needed to run MikroDB via MikroServe.
 */
export type CombinedConfiguration = {
  db: MikroDBOptions;
  events: EventConfig;
  server: ServerOptions;
};

/**
 * @description Options for configuring MikroDB when run in server mode.
 */
export type ServerOptions = {
  /**
   * Port to listen on (defaults to PORT env var or 8080)
   */
  port?: number;
  /**
   * Host to bind to (defaults to HOST env var or '0.0.0.0')
   */
  host?: string;
  /**
   * Database name (defaults to 'mikrodb-demo')
   */
  dbName?: string;
  /**
   * Whether to use HTTPS instead of HTTP
   */
  useHttps?: boolean;
  /**
   * Whether to use HTTP2 instead of HTTP
   */
  useHttp2?: boolean;
  /**
   * Path to SSL certificate file (required if `useHttps` or `useHttp2` is true)
   */
  sslCert?: string;
  /**
   * Path to SSL key file (required if `useHttps` or `useHttp2` is true)
   */
  sslKey?: string;
  /**
   * Path to SSL CA certificate(s) file (optional)
   */
  sslCa?: string;
  /**
   * An optional encryption key to use for encrypting and decrypting data.
   */
  encryptionKey?: string;
  /**
   * Use debug mode?
   */
  debug?: boolean;
};

/**
 * Standard format for encrypted data that includes all components needed for decryption
 */
export interface EncryptedData {
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
}

/**
 * Database query options for get operations.
 */
export type QueryOptions = {
  filter?: any;
  sort?: any;
  limit?: number;
  offset?: number;
};

/**
 * Database operation parameters for get requests.
 */
export type GetOperation = {
  tableName: string;
  key?: string;
  options?: QueryOptions;
};

/**
 * Options for write operations.
 */
export type WriteOptions = {
  concurrencyLimit?: number;
  flushImmediately?: boolean;
};

/**
 * Database operation parameters for delete requests.
 */
export type DeleteOperation = {
  tableName: string;
  key: string;
  expectedVersion?: ItemVersion;
};

/**
 * HTTP response with JSON payload.
 */
export type JsonResponse = {
  statusCode: number;
  data: any;
};
