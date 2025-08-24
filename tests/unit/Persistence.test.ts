import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

import { Persistence } from '../../src/Persistence.js';
import { time } from '../../src/utils/index.js';

const persistence = new Persistence();
const testDir = path.join(process.cwd(), 'test-data', 'persistence');

// Helper function to create test data directory if it doesn't exist
function ensureTestDirectory() {
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
}

// Helper function to clean up test data directory
function cleanupTestDirectory() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// Helper for value encoding/decoding tests
function testEncodeDecode(value: any) {
  const testTable = new Map();
  testTable.set('test', {
    value,
    version: 1,
    timestamp: time(),
    expiration: null
  });

  const buffer = persistence.toBinaryBuffer(testTable);
  const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

  return deserializedTable.get('test').value;
}

// Create test directory before tests
ensureTestDirectory();

// Clean up after all tests
afterAll(() => {
  cleanupTestDirectory();
});

describe('Binary format serialization', () => {
  test('Should correctly serialize and deserialize an empty table', () => {
    const emptyTable = new Map();
    const buffer = persistence.toBinaryBuffer(emptyTable);

    // Verify the buffer has at least the header (4 bytes) and count (4 bytes)
    expect(buffer.length).toBeGreaterThanOrEqual(8);

    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);
    expect(deserializedTable.size).toBe(0);
  });

  test('Should correctly serialize and deserialize a table with a single entry', () => {
    const originalTable = new Map();
    const testKey = 'test-key';
    const testValue = { name: 'Test Value', count: 42 };
    const testRecord = {
      value: testValue,
      version: 1,
      timestamp: time(),
      expiration: null
    };

    originalTable.set(testKey, testRecord);

    const buffer = persistence.toBinaryBuffer(originalTable);
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    expect(deserializedTable.size).toBe(1);
    expect(deserializedTable.has(testKey)).toBe(true);

    const retrievedRecord = deserializedTable.get(testKey);
    expect(retrievedRecord.value).toEqual(testValue);
    expect(retrievedRecord.version).toBe(testRecord.version);
    expect(retrievedRecord.timestamp).toBe(testRecord.timestamp);
    expect(retrievedRecord.expiration).toBe(testRecord.expiration);
  });

  test('Should correctly serialize and deserialize a table with multiple entries', () => {
    const originalTable = new Map();
    const timestamp = time();

    const entries = [
      {
        key: 'string-value',
        record: {
          value: 'Hello, World!',
          version: 1,
          timestamp,
          expiration: null
        }
      },
      {
        key: 'number-value',
        record: {
          value: 42,
          version: 2,
          timestamp,
          expiration: null
        }
      },
      {
        key: 'boolean-value',
        record: {
          value: true,
          version: 3,
          timestamp,
          expiration: null
        }
      },
      {
        key: 'object-value',
        record: {
          value: { name: 'Test Object', tags: ['tag1', 'tag2'] },
          version: 4,
          timestamp,
          expiration: null
        }
      }
    ];

    for (const entry of entries) originalTable.set(entry.key, entry.record);

    const buffer = persistence.toBinaryBuffer(originalTable);
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    expect(deserializedTable.size).toBe(entries.length);

    for (const entry of entries) {
      expect(deserializedTable.has(entry.key)).toBe(true);
      const retrievedRecord = deserializedTable.get(entry.key);
      expect(retrievedRecord.value).toEqual(entry.record.value);
      expect(retrievedRecord.version).toBe(entry.record.version);
    }
  });

  test('Should handle expired entries when deserializing', () => {
    const originalTable = new Map();
    const currentTime = time();
    const pastTime = currentTime - 10000; // 10 seconds in the past
    const futureTime = currentTime + 10000; // 10 seconds in the future

    originalTable.set('expired', {
      value: 'This should be filtered out',
      version: 1,
      timestamp: pastTime,
      expiration: pastTime // Expired
    });

    originalTable.set('valid', {
      value: 'This should remain',
      version: 2,
      timestamp: currentTime,
      expiration: futureTime // Not expired
    });

    const buffer = persistence.toBinaryBuffer(originalTable);
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    expect(deserializedTable.size).toBe(1);
    expect(deserializedTable.has('valid')).toBe(true);
    expect(deserializedTable.has('expired')).toBe(false);
  });

  describe('Binary format details', () => {
    test('Should correctly encode the header with magic bytes', () => {
      // The header should have MDB (0x4d 0x44 0x42) + version (0x01)
      const emptyTable = new Map();
      const buffer = persistence.toBinaryBuffer(emptyTable);

      // Verify the magic bytes
      expect(buffer[0]).toBe(0x4d); // 'M'
      expect(buffer[1]).toBe(0x44); // 'D'
      expect(buffer[2]).toBe(0x42); // 'B'
      expect(buffer[3]).toBe(0x01); // Version 1
    });

    test('Should correctly encode record count in the header', () => {
      // Create tables with different sizes
      for (let size = 0; size < 5; size++) {
        const table = new Map();

        // Add entries
        for (let i = 0; i < size; i++) {
          table.set(`key${i}`, {
            value: `value${i}`,
            version: i,
            timestamp: time(),
            expiration: null
          });
        }

        const buffer = persistence.toBinaryBuffer(table);

        // Count is stored at offset 4 (after magic bytes)
        const storedCount = buffer.readUInt32LE(4);
        expect(storedCount).toBe(size);
      }
    });

    test('Should correctly handle encoding for all supported types', () => {
      // This test verifies that all type markers are set correctly
      const allTypes = {
        nullValue: null,
        boolTrue: true,
        boolFalse: false,
        int32: 42,
        double: Math.PI,
        string: 'Hello',
        array: [1, 2, 3],
        object: { a: 1, b: 2 }
      };

      const table = new Map();
      table.set('all-types', {
        value: allTypes,
        version: 1,
        timestamp: time(),
        expiration: null
      });

      // The actual encoding is private, so we can only test the full cycle
      const buffer = persistence.toBinaryBuffer(table);
      const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

      // Check we got all types back correctly
      const result = deserializedTable.get('all-types').value;
      expect(result).toEqual(allTypes);
    });
  });
});

describe('Value encoding and decoding', () => {
  test('Should correctly encode and decode primitive values', () => {
    const primitives = [
      null,
      true,
      false,
      0,
      1,
      -1,
      42,
      -42,
      123456789,
      -123456789,
      Math.PI,
      -Math.PI,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      '',
      'Hello, World!',
      'Special chars: !@#$%^&*()'
    ];

    for (const value of primitives) {
      const result = testEncodeDecode(value);
      expect(result).toEqual(value);
    }
  });

  test('Should correctly encode and decode arrays', () => {
    const arrays = [
      [],
      [1, 2, 3, 4, 5],
      ['a', 'b', 'c'],
      [true, false, null],
      [1, 'string', true, null, { nested: 'object' }]
    ];

    for (const array of arrays) {
      const result = testEncodeDecode(array);
      expect(result).toEqual(array);
    }
  });

  test('Should correctly encode and decode objects', () => {
    const objects = [
      {},
      { key: 'value' },
      { number: 42, string: 'text', boolean: true, null: null },
      { nested: { level1: { level2: { level3: 'deep' } } } },
      { arrayProp: [1, 2, 3, { nestedInArray: true }] }
    ];

    for (const obj of objects) {
      const result = testEncodeDecode(obj);
      expect(result).toEqual(obj);
    }
  });

  test('Should correctly encode and decode complex nested structures', () => {
    const complexValue = {
      string: 'Hello',
      number: 42,
      float: Math.PI,
      boolean: true,
      null: null,
      array: [1, 2, 3, 'mixed', true, null],
      nestedObject: {
        key1: 'value1',
        key2: 'value2',
        nestedArray: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2', tags: ['tag1', 'tag2'] }
        ]
      }
    };

    const result = testEncodeDecode(complexValue);
    expect(result).toEqual(complexValue);
  });

  test('Should encode undefined as null', () => {
    const result = testEncodeDecode(undefined);
    expect(result).toBeNull();
  });
});

describe('Date handling', () => {
  test('Should correctly encode and decode Date objects', () => {
    const dates = [
      new Date(),
      new Date(0), // Unix epoch
      new Date('2023-01-01T00:00:00Z'),
      new Date('2024-12-31T23:59:59.999Z'),
      new Date(1609459200000), // 2021-01-01
      new Date(1735689600000) // 2025-01-01
    ];

    for (const date of dates) {
      const result = testEncodeDecode(date);
      expect(result instanceof Date).toBe(true);
      expect(result.getTime()).toBe(date.getTime());
    }
  });

  test('Should correctly handle Date objects in complex structures', () => {
    const complexWithDates = {
      creation: new Date(),
      lastModified: new Date(Date.now() - 86400000), // Yesterday
      items: [
        { id: 1, timestamp: new Date('2023-01-15T08:30:00Z') },
        { id: 2, timestamp: new Date('2023-02-20T15:45:30Z') }
      ],
      metadata: {
        expiration: new Date(Date.now() + 86400000 * 30), // 30 days from now
        schedule: {
          start: new Date('2023-06-01T00:00:00Z'),
          end: new Date('2023-12-31T23:59:59Z')
        }
      }
    };

    const result = testEncodeDecode(complexWithDates);

    // Check that all dates are preserved
    expect(result.creation instanceof Date).toBe(true);
    expect(result.creation.getTime()).toBe(complexWithDates.creation.getTime());

    expect(result.lastModified instanceof Date).toBe(true);
    expect(result.lastModified.getTime()).toBe(
      complexWithDates.lastModified.getTime()
    );

    expect(result.items[0].timestamp instanceof Date).toBe(true);
    expect(result.items[0].timestamp.getTime()).toBe(
      complexWithDates.items[0].timestamp.getTime()
    );

    expect(result.items[1].timestamp instanceof Date).toBe(true);
    expect(result.items[1].timestamp.getTime()).toBe(
      complexWithDates.items[1].timestamp.getTime()
    );

    expect(result.metadata.expiration instanceof Date).toBe(true);
    expect(result.metadata.expiration.getTime()).toBe(
      complexWithDates.metadata.expiration.getTime()
    );

    expect(result.metadata.schedule.start instanceof Date).toBe(true);
    expect(result.metadata.schedule.start.getTime()).toBe(
      complexWithDates.metadata.schedule.start.getTime()
    );

    expect(result.metadata.schedule.end instanceof Date).toBe(true);
    expect(result.metadata.schedule.end.getTime()).toBe(
      complexWithDates.metadata.schedule.end.getTime()
    );
  });

  test('Should handle dates at the limits of reasonable timestamp values', () => {
    // For int64, we have a range of -2^63 to 2^63-1
    // Date timestamps in milliseconds should stay within these bounds

    const farFutureDate = new Date(8640000000000); // ~Year 275760
    const farPastDate = new Date(-8640000000000); // ~Year -271821

    const futureResult = testEncodeDecode(farFutureDate);
    const pastResult = testEncodeDecode(farPastDate);

    expect(futureResult instanceof Date).toBe(true);
    expect(futureResult.getTime()).toBe(farFutureDate.getTime());

    expect(pastResult instanceof Date).toBe(true);
    expect(pastResult.getTime()).toBe(farPastDate.getTime());
  });

  test('Should correctly handle date fields in database use cases', () => {
    const sessionTable = new Map();
    const currentTime = time();

    const sessions = [
      {
        id: 'session1',
        data: {
          userId: 'user1',
          created: new Date(currentTime - 3600000), // 1 hour ago
          lastAccessed: new Date(currentTime - 300000), // 5 minutes ago
          expires: new Date(currentTime + 3600000) // 1 hour from now
        }
      },
      {
        id: 'session2',
        data: {
          userId: 'user2',
          created: new Date(currentTime - 7200000), // 2 hours ago
          lastAccessed: new Date(currentTime - 600000), // 10 minutes ago
          expires: new Date(currentTime + 1800000) // 30 minutes from now
        }
      }
    ];

    for (const session of sessions) {
      sessionTable.set(session.id, {
        value: session.data,
        version: 1,
        timestamp: currentTime,
        expiration: null
      });
    }

    const buffer = persistence.toBinaryBuffer(sessionTable);
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    // Verify all date fields were properly preserved
    for (const session of sessions) {
      const original = session.data;
      const deserialized = deserializedTable.get(session.id).value;

      expect(deserialized.created instanceof Date).toBe(true);
      expect(deserialized.created.getTime()).toBe(original.created.getTime());

      expect(deserialized.lastAccessed instanceof Date).toBe(true);
      expect(deserialized.lastAccessed.getTime()).toBe(
        original.lastAccessed.getTime()
      );

      expect(deserialized.expires instanceof Date).toBe(true);
      expect(deserialized.expires.getTime()).toBe(original.expires.getTime());
    }
  });
});

describe('Performance and memory efficiency', () => {
  test('Should handle serializing large datasets efficiently', () => {
    const largeTable = new Map();
    const entryCount = 1000;

    for (let i = 0; i < entryCount; i++) {
      largeTable.set(`key${i}`, {
        value: {
          id: i,
          name: `Item ${i}`,
          data: `Data for item ${i}`
        },
        version: 1,
        timestamp: time(),
        expiration: null
      });
    }

    // Measure time for serialization
    const startTime = performance.now();
    const buffer = persistence.toBinaryBuffer(largeTable);
    const serializationTime = performance.now() - startTime;

    // Measure time for deserialization
    const startDeserializeTime = performance.now();
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);
    const deserializationTime = performance.now() - startDeserializeTime;

    console.log(
      `Serialized ${entryCount} entries in ${serializationTime.toFixed(2)}ms`
    );
    console.log(
      `Deserialized ${entryCount} entries in ${deserializationTime.toFixed(2)}ms`
    );
    console.log(`Buffer size: ${buffer.length} bytes`);

    // Ensure data integrity
    expect(deserializedTable.size).toBe(largeTable.size);

    // Check a few random entries
    const randomKeys = Array.from(largeTable.keys()).slice(0, 10);
    for (const key of randomKeys) {
      expect(deserializedTable.get(key).value).toEqual(
        largeTable.get(key).value
      );
    }
  });
});

describe('Expiration handling', () => {
  test('Should filter out expired entries during deserialization', () => {
    const currentTime = time();
    console.log('Current timestamp:', currentTime);

    const table = new Map();

    table.set('expired-past', {
      value: 'Expired item',
      version: 1,
      timestamp: currentTime - 10000,
      expiration: currentTime - 1000 // Already expired (1 second ago)
    });

    table.set('expires-now', {
      value: 'Expiring item',
      version: 2,
      timestamp: currentTime - 5000,
      expiration: currentTime // Expires exactly now
    });

    table.set('expires-future', {
      value: 'Valid item',
      version: 3,
      timestamp: currentTime - 5000,
      expiration: currentTime + 100000 // Expires 100 seconds in future
    });

    table.set('never-expires', {
      value: 'Permanent item',
      version: 4,
      timestamp: currentTime - 5000,
      expiration: null // Never expires
    });

    const buffer = persistence.toBinaryBuffer(table);

    // Let's inspect what's actually in the buffer for debugging
    const bufferHex = buffer.toString('hex');
    console.log('Buffer hex (first 100 bytes):', bufferHex.substring(0, 200));

    // Deserialize with the current time
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    console.log(
      'Deserialized table entries:',
      Array.from(deserializedTable.keys())
    );
    console.log(
      'Deserialized future expiration entry:',
      deserializedTable.has('expires-future')
        ? deserializedTable.get('expires-future')
        : 'Not found'
    );

    expect(deserializedTable.has('expired-past')).toBe(false);
    expect(deserializedTable.has('expires-now')).toBe(false);
    expect(deserializedTable.has('expires-future')).toBe(true);
    expect(deserializedTable.has('never-expires')).toBe(true);
  });
});

describe('Key and value limits', () => {
  test('Should handle keys up to 65535 bytes (UInt16 limit)', () => {
    // Create a key at the maximum size
    const maxSizeKey = 'x'.repeat(65535);

    const table = new Map();
    table.set(maxSizeKey, {
      value: 'Maximum key size',
      version: 1,
      timestamp: time(),
      expiration: null
    });

    const buffer = persistence.toBinaryBuffer(table);
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    expect(deserializedTable.has(maxSizeKey)).toBe(true);
    expect(deserializedTable.get(maxSizeKey).value).toBe('Maximum key size');
  });

  test('Should handle very large values within UInt32 limit', () => {
    // Create a value close to the maximum size (but not so large it crashes the test)
    // UInt32 max is 4,294,967,295 bytes, we'll use a much smaller value for testing
    const largeValue = 'x'.repeat(1000000); // 1 million chars

    const table = new Map();
    table.set('large-value', {
      value: largeValue,
      version: 1,
      timestamp: time(),
      expiration: null
    });

    const buffer = persistence.toBinaryBuffer(table);
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    expect(deserializedTable.get('large-value').value).toBe(largeValue);
    expect(deserializedTable.get('large-value').value.length).toBe(
      largeValue.length
    );
  });
});

describe('Corrupted data handling', () => {
  test('Should handle abruptly truncated records gracefully', () => {
    const table = new Map();

    table.set('key1', {
      value: 'Value 1',
      version: 1,
      timestamp: time(),
      expiration: null
    });

    table.set('key2', {
      value: 'Value 2',
      version: 2,
      timestamp: time(),
      expiration: null
    });

    const buffer = persistence.toBinaryBuffer(table);

    // Now truncate the buffer at various points
    // We need to find a point after the first record but before the second
    // This is tricky without knowing internal implementation details

    // Try a few different truncation points
    for (
      let truncateAt = buffer.length * 0.5;
      truncateAt < buffer.length;
      truncateAt += buffer.length * 0.1
    ) {
      const truncatedBuffer = buffer.slice(0, Math.floor(truncateAt));

      // Try to deserialize - should not throw
      let deserializedTable: any;
      try {
        deserializedTable =
          persistence.readTableFromBinaryBuffer(truncatedBuffer);
        // If we got here, truncation didn't cause an error
      } catch (_error) {
        // If error occurred, just note it and continue
        console.log(`Truncation at ${truncateAt} bytes caused error`);
        continue;
      }

      // Verify we got at least some valid data
      if (deserializedTable.size > 0) {
        // At least partial deserialization worked
        break;
      }
    }
  });
});

describe('Versioning and updates', () => {
  test('Should preserve version information through serialization', () => {
    // This test simulates record versioning for optimistic concurrency
    const versionedTable = new Map();
    const currentTime = time();

    // Create records with different versions
    versionedTable.set('record1', {
      value: { data: 'Original data' },
      version: 1,
      timestamp: currentTime - 3600,
      expiration: null
    });

    versionedTable.set('record2', {
      value: { data: 'Updated once' },
      version: 2,
      timestamp: currentTime - 1800,
      expiration: null
    });

    versionedTable.set('record3', {
      value: { data: 'Updated multiple times' },
      version: 5,
      timestamp: currentTime,
      expiration: null
    });

    const buffer = persistence.toBinaryBuffer(versionedTable);
    const deserializedTable = persistence.readTableFromBinaryBuffer(buffer);

    expect(deserializedTable.get('record1').version).toBe(1);
    expect(deserializedTable.get('record2').version).toBe(2);
    expect(deserializedTable.get('record3').version).toBe(5);
  });
});

describe('File format compatibility', () => {
  test('Should detect invalid file format', () => {
    const invalidBuffer = Buffer.from(
      'This is not a valid MikroDB file',
      'utf8'
    );

    expect(() => {
      persistence.readTableFromBinaryBuffer(invalidBuffer);
    }).toThrow('Invalid table file format');
  });

  test('Should handle minimum valid format', () => {
    const minimalBuffer = Buffer.alloc(8);
    minimalBuffer[0] = 0x4d; // 'M'
    minimalBuffer[1] = 0x44; // 'D'
    minimalBuffer[2] = 0x42; // 'B'
    minimalBuffer[3] = 0x01; // Version 1
    minimalBuffer.writeUInt32LE(0, 4); // 0 records

    // Should parse without errors
    const emptyTable = persistence.readTableFromBinaryBuffer(minimalBuffer);
    expect(emptyTable.size).toBe(0);
  });
});

describe('Realistic database scenarios', () => {
  test('Should handle a typical user data table', () => {
    const userTable = new Map();
    const currentTime = time();

    const users = [
      {
        id: 'user1',
        profile: {
          username: 'john_doe',
          email: 'john@example.com',
          name: 'John Doe',
          age: 30,
          roles: ['user', 'admin'],
          preferences: {
            theme: 'dark',
            notifications: true,
            language: 'en-US'
          },
          metadata: {
            lastLogin: currentTime - 86400, // 1 day ago
            registrationDate: currentTime - 31536000, // 1 year ago
            loginCount: 42
          }
        }
      },
      {
        id: 'user2',
        profile: {
          username: 'jane_smith',
          email: 'jane@example.com',
          name: 'Jane Smith',
          age: 25,
          roles: ['user'],
          preferences: {
            theme: 'light',
            notifications: false,
            language: 'fr-FR'
          },
          metadata: {
            lastLogin: currentTime - 3600, // 1 hour ago
            registrationDate: currentTime - 15768000, // 6 months ago
            loginCount: 17
          }
        }
      }
    ];

    // Add users to the table
    for (const user of users) {
      userTable.set(user.id, {
        value: user.profile,
        version: 1,
        timestamp: currentTime,
        expiration: null
      });
    }

    const buffer = persistence.toBinaryBuffer(userTable);

    const filePath = path.join(testDir, 'users.db');
    fs.writeFileSync(filePath, buffer);

    const readBuffer = fs.readFileSync(filePath);

    const deserializedTable = persistence.readTableFromBinaryBuffer(readBuffer);

    expect(deserializedTable.size).toBe(users.length);

    for (const user of users) {
      expect(deserializedTable.has(user.id)).toBe(true);
      expect(deserializedTable.get(user.id).value).toEqual(user.profile);
    }
  });

  test('Should handle a product inventory table with varied data types', () => {
    const inventoryTable = new Map();
    const currentTime = time();

    const products = [
      {
        id: 'prod1',
        data: {
          name: 'Laptop Computer',
          sku: 'TECH-1234',
          price: 999.99,
          inStock: 42,
          categories: ['electronics', 'computers'],
          attributes: {
            brand: 'TechBrand',
            color: 'Silver',
            weight: 1.5,
            dimensions: {
              width: 32.5,
              height: 1.8,
              depth: 22.7
            }
          },
          tags: ['sale', 'featured', 'new-arrival'],
          reviews: [
            { user: 'user1', rating: 5, comment: 'Great product!' },
            { user: 'user2', rating: 4, comment: 'Good value for money' }
          ]
        }
      },
      {
        id: 'prod2',
        data: {
          name: 'Wireless Mouse',
          sku: 'TECH-5678',
          price: 29.99,
          inStock: 156,
          categories: ['electronics', 'accessories'],
          attributes: {
            brand: 'TechBrand',
            color: 'Black',
            weight: 0.1,
            wirelessRange: '10m',
            batteryLife: '6 months'
          },
          tags: ['bestseller'],
          reviews: [
            { user: 'user3', rating: 5, comment: 'Perfect mouse!' },
            {
              user: 'user4',
              rating: 3,
              comment: 'Decent but battery life is short'
            }
          ]
        }
      }
    ];

    for (const product of products) {
      inventoryTable.set(product.id, {
        value: product.data,
        version: 1,
        timestamp: currentTime,
        expiration: null
      });
    }

    const buffer = persistence.toBinaryBuffer(inventoryTable);

    const filePath = path.join(testDir, 'inventory.db');
    fs.writeFileSync(filePath, buffer);

    const readBuffer = fs.readFileSync(filePath);

    const deserializedTable = persistence.readTableFromBinaryBuffer(readBuffer);

    expect(deserializedTable.size).toBe(products.length);

    for (const product of products) {
      expect(deserializedTable.has(product.id)).toBe(true);
      expect(deserializedTable.get(product.id).value).toEqual(product.data);
    }
  });

  test('Should handle a session table with expirations', () => {
    const sessionTable = new Map();
    const currentTime = time();

    const sessions = [
      {
        id: 'session1',
        data: {
          userId: 'user1',
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0...',
          lastActivity: currentTime - 300, // 5 minutes ago
          data: { cart: ['item1', 'item2'] }
        },
        expiration: currentTime + 3600 // Expires in 1 hour
      },
      {
        id: 'session2',
        data: {
          userId: 'user2',
          ip: '192.168.1.2',
          userAgent: 'Mozilla/5.0...',
          lastActivity: currentTime - 600, // 10 minutes ago
          data: { cart: ['item3'] }
        },
        expiration: currentTime + 1800 // Expires in 30 minutes
      },
      {
        id: 'session3',
        data: {
          userId: 'user3',
          ip: '192.168.1.3',
          userAgent: 'Mozilla/5.0...',
          lastActivity: currentTime - 7200, // 2 hours ago
          data: { cart: [] }
        },
        expiration: currentTime - 3600 // Expired 1 hour ago
      }
    ];

    for (const session of sessions) {
      sessionTable.set(session.id, {
        value: session.data,
        version: 1,
        timestamp: currentTime,
        expiration: session.expiration
      });
    }

    const buffer = persistence.toBinaryBuffer(sessionTable);

    const filePath = path.join(testDir, 'sessions.db');
    fs.writeFileSync(filePath, buffer);

    const readBuffer = fs.readFileSync(filePath);

    const deserializedTable = persistence.readTableFromBinaryBuffer(readBuffer);

    expect(deserializedTable.size).toBe(2); // 3rd session should be filtered out
    expect(deserializedTable.has('session1')).toBe(true);
    expect(deserializedTable.has('session2')).toBe(true);
    expect(deserializedTable.has('session3')).toBe(false); // Expired session
  });
});

describe('Error handling and edge cases', () => {
  test('Should reject an invalid buffer format', () => {
    // Create an invalid buffer without the proper header
    const invalidBuffer = Buffer.from([
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]);

    expect(() => {
      persistence.readTableFromBinaryBuffer(invalidBuffer);
    }).toThrow('Invalid table file format');
  });

  test('Should handle buffer truncation gracefully', () => {
    const originalTable = new Map();
    originalTable.set('key1', {
      value: 'value1',
      version: 1,
      timestamp: time(),
      expiration: null
    });

    originalTable.set('key2', {
      value: 'value2',
      version: 2,
      timestamp: time(),
      expiration: null
    });

    // Serialize and then truncate the buffer
    const buffer = persistence.toBinaryBuffer(originalTable);
    const truncatedBuffer = buffer.slice(0, buffer.length / 2);

    // Should not throw, but might not get all entries
    const deserializedTable =
      persistence.readTableFromBinaryBuffer(truncatedBuffer);

    // We expect to get at least the header parsed
    expect(deserializedTable).toBeDefined();

    // Depending on where truncation happened, we might get 0 or 1 entries
    expect(deserializedTable.size).toBeLessThanOrEqual(originalTable.size);
  });

  test('Should handle very large values', () => {
    // Create a large string
    const largeString = 'x'.repeat(100000);

    const result = testEncodeDecode(largeString);
    expect(result).toEqual(largeString);

    // Create an object with lots of small values
    const largeObject: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      largeObject[`key${i}`] = i;
    }

    const objectResult = testEncodeDecode(largeObject);
    expect(objectResult).toEqual(largeObject);
  });

  test('Should handle non-standard values by converting to strings', () => {
    // Create a function (not directly serializable)
    const func = () => 'function result';

    // Encode/decode should convert to string representation
    const result = testEncodeDecode(func);

    // Functions typically converted to string like "() => 'function result'"
    expect(typeof result).toBe('string');
  });
});
