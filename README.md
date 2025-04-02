# MikroDB

**A lightweight KV database inspired by Cloudflare KV, DynamoDB, and sqlite**.

[![npm version](https://img.shields.io/npm/v/mikrodb.svg)](https://www.npmjs.com/package/mikrodb)

[![bundle size](https://img.shields.io/bundlephobia/minzip/mikrodb)](https://bundlephobia.com/package/mikrodb)

![Build Status](https://github.com/mikaelvesavuori/mikrodb/workflows/main/badge.svg)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

- Key-Value oriented, file-based database with useful querying
- Native Node.js solution, no need for binaries or compiling to specific architectures
- Multi-table support with in-memory caching of data (within caching limits)
- Change data capture event support using [MikroEvent](https://github.com/mikaelvesavuori/mikroevent)
- Supports encryption at rest
- Supports item versioning
- Supports expiration dates
- Can be exposed directly as an API
- Suitable for serverless and ephemeral use-cases
- Less than 15kb gzipped, using only three lightweight dependencies: [MikroConf](https://github.com/mikaelvesavuori/mikroconf), [MikroEvent](https://github.com/mikaelvesavuori/mikroevent), [MikroServe](https://github.com/mikaelvesavuori/mikroserve) (used only for server mode)
- High test coverage

## Installation

```bash
npm install mikrodb -S
```

## Usage

### Quick Start

```typescript
const db = new MikroDB({ databaseDirectory: 'my-db' }); // Optional: Will be `mikrodb` by default
await db.start(); // Required call to start everything up

const tableName = 'my-table';
const key = 'my-key';

await db.write({
  tableName,
  key,
  value: {
    message: 'This is how you can write an object!'
  }
});

await db.get({ tableName, key });

await db.delete({ tableName, key });

await db.close(); // Flush all unwritten (in-memory and/or in WAL file) data to disk
```

## Design

### Design goals

The intention is to provide a database that is similar in spirit to how some of the best-in-class NoSQL/KV databases are experienced, but to improve where possible, such as offering more powerful querying abilities.

To support this, the architectural pillars of MikroDB are portability, resiliency, and simplicity.

- **Portability**, because the data is handled as encrypted or unencrypted binary data that can be copied and stored easily, as well as allowing for dumping directly to JSON. MikroDB itself can be bundled into a single JS file and can be exposed out-of-the-box as an API service meaning you can run it effortlessly anywhere you have Node.js.
- **Resiliency**, since the write-ahead log keeps track of changes and will restore from these if there is a crash before data was written.
- **Simplicity**, as the simple database architecture and readable and documented Node.js code makes it easier to understand and contribute to. The setup, API, and querying options should all be easy to grok and make use of.

### Non-goals

While MikroDB should perform reasonably well, it has not been explicitly engineered for performance-critical use cases.

MikroDB is not a distributed database and the intention is not to make it one.

### Implementation details

- In MikroDB, a _database_ is really just a directory.
- In this directory, binary (and optionally encrypted) files are created that represent each _table_.
- MikroDB loads tables that are accessed into memory.
  - Cache eviction happens automatically based on either table count or table size. This is currently not configurable.
- Mutating operations (writes and deletes) are written to an append-only log (["write ahead log"](https://www.architecture-weekly.com/p/the-write-ahead-log-a-foundation) or WAL) and then "flushed" (written/committed) to the table file. This file is named `wal.log` by default.
  - Flushing happens under several conditions:
    - Automatically checkpointed after a set period (by default a few seconds);
    - After batches of work have been performed;
    - After a set number of operations have occurred (configurable).
  - Latent, unwritten operations are replayed/written from the WAL when MikroDB starts. This could happen, for example, when there is a crash or an abrupt close to the last run.
- Written items can contain an item version and expiration timestamp.
  - Cleanup of expired items can happen through a manual call, or is otherwise handled dynamically on read, discarding and deleting expired items if any are encountered.

### Characteristics

MikroDB is what could be characterized as an application database, meant for typical use cases involved in running many types of applications. It's not intended for analytical workloads.

The ideal use case for MikroDB should be when there are many tables but each is quite small, such as under multi-tenant conditions, running e.g. applications for several customers.

In-memory data is loaded to a JS [Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map) object, which operate faster than regular objects.

Loading a table incurs some latency as the data is decrypted (if needed) and then loaded into the Map. The bigger the object, the longer this delay is.

Because tables are loaded into memory, the relative weight of each table will affect performance. In my own testing, tables up to ~20 MB (100k items of ~200 bytes each) have proven to have acceptable performance. A benchmark test is available so you can experiment with this.

Simple key-value lookups without filtering will always be much faster than using filters.

A significant factor for performance has to do with writes. The defaults should strike a reasonable balance. This is why you will likely have to reach for even more infrequent writes and "eventually consistent" characteristics the higher load you put on MikroDB.

---

## Querying

MikroDB provides powerful and flexible querying capabilities to efficiently retrieve your data. This guide will walk you through various query examples to help you get the most out of MikroDB.

### Basic Operations

#### Reading a Single Record

To retrieve a specific record by its key:

```js
// Get a user by ID
const user = await db.get({
  tableName: 'users',
  key: 'user1'
});
```

#### Reading All Records

To retrieve all records in a table without any filters:

```js
// Get all users
const allUsers = await db.get({
  tableName: 'users'
});
```

### Filtering Data

#### Simple Equality Filters

Use exact match filtering:

```js
// Find all active users
const activeUsers = await db.get({
  tableName: 'users',
  options: {
    filter: { status: 'active' }
  }
});
```

#### Comparison Operators

MikroDB supports various comparison operators:

```js
// Find users older than 25
const olderUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      age: { operator: 'gt', value: 25 }
    }
  }
});

// Find users between 24 and 26 years old
const midAgeUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      age: { operator: 'between', value: [24, 26] }
    }
  }
});

// Find users with roles from a specific set
const specificRoleUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      role: { operator: 'in', value: ['admin', 'moderator'] }
    }
  }
});

// Find users with roles NOT in a specific set
const nonSpecificRoleUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      role: { operator: 'nin', value: ['guest', 'user'] }
    }
  }
});
```

Available comparison operators:

- `eq`: Equal to
- `neq`: Not equal to
- `gt`: Greater than
- `gte`: Greater than or equal to
- `lt`: Less than
- `lte`: Less than or equal to
- `between`: Between two values (inclusive)
- `in`: Value exists in an array of options
- `nin`: Value does not exist in an array of options

#### Working with Arrays

MikroDB provides powerful array operators:

```js
// Find users with the 'vip' tag
const vipUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      tags: { operator: 'contains', value: 'vip' }
    }
  }
});

// Find users with both 'vip' and 'early-adopter' tags
const specialUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      tags: { operator: 'containsAll', value: ['vip', 'early-adopter'] }
    }
  }
});

// Find users with either 'premium' or 'vip' tag
const premiumOrVipUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      tags: { operator: 'containsAny', value: ['premium', 'vip'] }
    }
  }
});

// Find users with exactly 2 tags
const twoTagsUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      tags: { operator: 'size', value: 2 }
    }
  }
});
```

#### String Filters

MikroDB supports advanced string matching:

```js
// Find users with email containing a specific text (case-insensitive)
const companyUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      email: { operator: 'like', value: '@company.com' }
    }
  }
});

// Find users with email matching a regex pattern
const regexUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      email: { operator: 'regex', value: '^[^@]+@company\\.com$' }
    }
  }
});
```

#### Nested Object Filters

Query on nested fields using dot notation:

```js
// Find users from a specific country
const usaUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      'profile.location.country': 'USA'
    }
  }
});

// Find users with dark theme
const darkThemeUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      'profile.preferences.theme': { operator: 'eq', value: 'dark' }
    }
  }
});
```

### Logical Operators

#### Combining Conditions with AND

Multiple conditions in a filter object are combined with an implicit AND:

```js
// Find active admin users
const activeAdmins = await db.get({
  tableName: 'users',
  options: {
    filter: {
      status: 'active',
      role: 'admin'
    }
  }
});
```

#### Using OR Conditions

Use the `$or` operator to combine conditions with OR:

```js
// Find users who are either admins or from Canada
const adminsOrCanadians = await db.get({
  tableName: 'users',
  options: {
    filter: {
      $or: [
        { role: 'admin' },
        { 'profile.location.country': 'Canada' }
      ]
    }
  }
});
```

### Sorting Results

Sort results using a custom sort function:

```js
// Sort users by age (ascending)
const sortedByAge = await db.get({
  tableName: 'users',
  options: {
    sort: (a, b) => a.age - b.age
  }
});

// Sort users by last login (descending)
const sortedByLastLogin = await db.get({
  tableName: 'users',
  options: {
    sort: (a, b) => b.lastLogin - a.lastLogin
  }
});
```

### Combining Operations

#### Complex Queries

MikroDB allows combining multiple filtering and sorting operations:

```js
// Complex query with filtering, sorting, and limiting
const result = await db.get({
  tableName: 'users',
  options: {
    filter: {
      $or: [
        { role: 'admin' },
        { tags: { operator: 'contains', value: 'premium' } }
      ],
      status: 'active',
      age: { operator: 'gte', value: 25 }
    },
    sort: (a, b) => b.lastLogin - a.lastLogin,
    limit: 2
  }
});
```

#### Advanced Nested Filtering

Combine multiple operators with nested fields:

```js
// Find users from specific countries with notifications enabled
const filteredUsers = await db.get({
  tableName: 'users',
  options: {
    filter: {
      'profile.location.country': {
        operator: 'in',
        value: ['USA', 'Canada']
      },
      'profile.preferences.notifications': true,
      age: { operator: 'between', value: [20, 35] }
    }
  }
});
```

### Using Nested Object Filter Queries

MikroDB allows you to apply filters to nested objects without using dot notation:

```js
// Find users with specific profile preferences
const specificPreferences = await db.get({
  tableName: 'users',
  options: {
    filter: {
      profile: {
        preferences: {
          theme: 'dark'
        }
      }
    }
  }
});
```

### Handling Edge Cases

MikroDB gracefully handles various edge cases:

```js
// Non-existent fields (returns empty array)
const nonExistentField = await db.get({
  tableName: 'users',
  options: {
    filter: {
      nonexistentField: { operator: 'eq', value: 'something' }
    }
  }
});

// Empty array values with containsAll (matches everything)
const emptyArrayCheck = await db.get({
  tableName: 'users',
  options: {
    filter: {
      tags: { operator: 'containsAll', value: [] }
    }
  }
});

// Invalid regex patterns (returns empty array)
const invalidRegex = await db.get({
  tableName: 'users',
  options: {
    filter: {
      email: { operator: 'regex', value: '[' }
    }
  }
});
```

## Management Calls

There are several other actions you can perform as well, beyond just working with items.

```typescript
// Flushes all pending operations to disk and ensures all Write Ahead Log (WAL) entries and writes are persisted
await db.flush();

// Alias for `flush()`
await db.close();

// Flush only the Write Ahead Log (WAL)
await db.flushWAL();

// Dump a single—or if no table name is provided, all—tables to JSON file(s) on disk
await db.dump();

// Manually start a cleanup task to remove expired items
await db.cleanupExpiredItems();
```

## Configuration

Settings can be provided in multiple ways.

- They can be provided via the CLI, e.g. `node app.js --port 1234`.
- Certain values can be provided via environment variables.
  - Port: `process.env.PORT` - number
  - Host: `process.env.HOST` - string
  - Debug: `process.env.DEBUG` - boolean
- Programmatically/directly via scripting, e.g. `new MikroDB({ port: 1234 })`.
- They can be placed in a configuration file named `mikrodb.config.json` (plain JSON), which will be automatically applied on load.

### Options

| CLI argument    | CLI value                   | JSON (config file) value           | Environment variable |
|-----------------|-----------------------------|------------------------------------|----------------------|
| --db            | `<string>`                  | db.dbName                          |                      |
| --dir           | `<string>`                  | db.databaseDirectory               |                      |
| --wal           | `<string>`                  | db.walFileName                     |                      |
| --interval      | `<number>`                  | db.walInterval                     |                      |
| --encryptionKey | `<string>`                  | db.encryptionKey                   |                      |
| --maxWrites     | `<number>`                  | db.maxWriteOpsBeforeFlush          |                      |
| --debug         | none (is flag)              | db.debug                           | DEBUG                |
| --port          | `<number>`                  | server.port                        | PORT                 |
| --host          | `<string>`                  | server.host                        | HOST                 |
| --https         | none (is flag)              | server.useHttps                    |                      |
| --http2         | none (is flag)              | server.useHttp2                    |                      |
| --cert          | `<string>`                  | server.sslCert                     |                      |
| --key           | `<string>`                  | server.sslKey                      |                      |
| --ca            | `<string>`                  | server.sslCa                       |                      |
| --ratelimit     | none (is flag)              | server.rateLimit.enabled           |                      |
| --rps           | `<number>`                  | server.rateLimit.requestsPerMinute |                      |
| --allowed       | `<comma-separated strings>` | server.allowedDomains              |                      |
| --debug         | none (is flag)              | server.debug                       | DEBUG                |

_Setting debug mode in CLI arguments will enable debug mode across all areas. To granularly define this, use a config file._

### Order of application

As per [MikroConf](https://github.com/mikaelvesavuori/mikroconf) behavior, the configuration sources are applied in this order:

1. Command line arguments (highest priority)
2. Programmatically provided config
3. Config file (JSON)
4. Default values (lowest priority)

## Change Data Capture Events

MikroDB emits [Node.js events](https://nodejs.org/api/events.html) for certain internal events - this is called [change data capture](https://en.wikipedia.org/wiki/Change_data_capture). This allows you to, for example, replicate the general idea of [DynamoDB Streams](https://www.alexdebrie.com/bites/dynamodb-streams/) if you have ever used it.

To do this, [MikroEvent](https://github.com/mikaelvesavuori/mikroevent) is used.

### Emitted Events

| Event name      | Data                                                                              |
|-----------------|-----------------------------------------------------------------------------------|
| `item.deleted`  | `{ operation: 'item.deleted', table: <string>, key: <string> }`                   |
| `item.expired`  | `{ operation: 'item.expired', table: <string>, key: <string>, record: <object> }` |
| `item.written`  | `{ operation: 'item.written', table: <string>, key: <string>, record: <object> }` |
| `table.deleted` | `{ operation: 'item.written', table: <string> }`                                  |

### Event Configuration

Use the `events` object to provide the targets and listeners.

Here's an example of doing it programmatically with internal-only events:

```typescript
const db = new MikroDB({
  events: {
    targets: [
      {
        name: 'internal',
        events: ['item.deleted', 'item.expired', 'item.written', 'table.deleted']
      }
    ],
    listeners: [
      {
        event: 'item.deleted',
        handler: (data) => console.log('Item deleted', data)
      },
      {
        event: 'item.expired',
        handler: (data) => console.log('Item expired', data)
      },
      {
        event: 'item.written',
        handler: (data) => console.log('Item written', data)
      },
      {
        event: 'table.deleted',
        handler: (data) => console.log('Table deleted', data)
      }
    ]
  }
});
```

## Item Expiration

Setting an `expiration` timestamp is easy:

```typescript
await db.write({
  tableName: 'users',
  key: 'user1',
  value: { name: 'John Doe' },
  expiration: Date.now() + 60 * 1000; // 1 minute in the future
});
```

## Item Versioning

This is easiest to show with an example.

```typescript
const tableName = 'users';
const key = 'user1';

await db.write({
  tableName,
  key,
  value: { name: 'John' }
});

await db.write({
  tableName,
  key,
  value: { name: 'Jane' }
});
// When retrieved with `get()`, version will be 2 and user will be 'Jane'
```

Normally you don't have to care about item versioning, but if you want to you can set it by hand:

```typescript
await db.write({
  tableName,
  key,
  value: { name: 'Sam' },
  expectedVersion: 3
});
```

The `expectedVersion` value must be sequential.

## Server Mode

MikroDB has built-in functionality to be exposed directly as a server or API using [MikroServe](https://github.com/mikaelvesavuori/mikroserve).

Some nice features of running MikroDB in server mode include:

- You get a zero-config-needed API for data operations
- JSON-based request and response format
- Configurable server options
- Support for both HTTP, HTTPS, and HTTP2
- Graceful shutdown handling

### Starting the Server (Command Line)

```bash
npx mikrodb
```

Configuring the server (API) settings follows the conventions of [MikroServe](https://github.com/mikaelvesavuori/mikroserve); please see that documentation for more details. In short, in this case, you can supply configuration in several ways:

- Configuration file, named `mikrodb.config.json`
- CLI arguments
- Environment variables

**The only difference compared to regular MikroServe usage is that the server configuration object (if used) must be nested in a `server` object**. For example. if you want to set the port value to 8080, instead of putting the values at the root level you would do like this:

```json
{
  "server": {
    "port": 8080
  }
}
```

### API Endpoints

#### GET Data

```text
POST /get
```

Request body:

```json
{
  "tableName": "users",
  "key": "user123",
  "options": {
    "filter": { "active": true },
    "sort": { "lastName": 1 },
    "limit": 10,
    "offset": 0
  }
}
```

#### WRITE Data

```text
POST /write
```

Request body:

```json
{
  "tableName": "users",
  "key": "user123",
  "value": {
    "name": "John Doe",
    "email": "john@example.com"
  },
  "expectedVersion": 1,
  "expiration": 3600,
  "concurrencyLimit": 5,
  "flushImmediately": true
}
```

#### DELETE Data

```text
DELETE /delete?tableName=users&key=user123
```

### Error Handling

All endpoints return appropriate HTTP status codes:

- `200`: Success
- `400`: Bad Request (missing required parameters)
- `404`: Endpoint not found
- `500`: Internal server error

### Environment Variables

- `PORT`: Port to listen on (default: 8080)
- `HOST`: Host to bind to (default: '0.0.0.0')
- `DEBUG`: Activates debug mode with more logs (default: '0.0.0.0')

### Configuration

#### HTTPS/HTTP2 Configuration

To enable HTTPS or HTTP2, provide the following options when starting the server:

```javascript
const server = startServer({
  useHttps: true,
  // OR
  useHttp2: true,
  sslCert: '/path/to/certificate.pem',
  sslKey: '/path/to/private-key.pem',
  sslCa: '/path/to/ca-certificate.pem' // Optional
});
```

#### Generating Self-Signed Certificates (for testing)

```bash
# Generate a private key
openssl genrsa -out private-key.pem 2048

# Generate a certificate signing request
openssl req -new -key private-key.pem -out csr.pem

# Generate a self-signed certificate (valid for 365 days)
openssl x509 -req -days 365 -in csr.pem -signkey private-key.pem -out certificate.pem
```

## Development

### Start as server/API

```bash
npm start
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
```

## Future Ideas and Known Issues

- Handle unprocessed events when emitting events.
- It's been hard to test "It should recover from incomplete checkpoint" in a good way that does not break - add this.
- The test "It should trigger checkpoint when WAL size exceeds limit" is flaky in CI for some reason.

## License

MIT. See the `LICENSE` file.
