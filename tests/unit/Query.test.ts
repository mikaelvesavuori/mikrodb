import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { MikroDB } from '../../src/MikroDB.js';

let db: MikroDB;
let dbDir: string;

beforeEach(async () => {
  dbDir = getUniqueTestDir();
  db = new MikroDB({ databaseDirectory: dbDir } as any);
  await db.start();

  const writePromises = users.map((user) =>
    db.write({
      tableName: 'users',
      key: user.id,
      value: user
    })
  );

  await Promise.all(writePromises);

  await (db as any).table.flushWAL();
  await (db as any).table.flushWrites();
});

afterEach(async () => {
  if (existsSync(dbDir)) rmSync(dbDir, { recursive: true, force: true });
});

const users = [
  {
    id: 'user1',
    name: 'John Doe',
    age: 30,
    email: 'john@example.com',
    status: 'active',
    role: 'admin',
    tags: ['vip', 'early-adopter'],
    profile: {
      location: {
        country: 'USA',
        city: 'New York'
      },
      preferences: {
        theme: 'dark',
        notifications: true
      }
    },
    lastLogin: 1708732800000, // Feb 24, 2024
    scores: [85, 92, 78]
  },
  {
    id: 'user2',
    name: 'Jane Smith',
    age: 25,
    email: 'jane@company.com',
    status: 'active',
    role: 'user',
    tags: ['premium'],
    profile: {
      location: {
        country: 'Canada',
        city: 'Toronto'
      },
      preferences: {
        theme: 'light',
        notifications: false
      }
    },
    lastLogin: 1708819200000, // Feb 25, 2024
    scores: [95, 88, 91]
  }
];

const getUniqueTestDir = () => {
  const uniqueDir = join(
    tmpdir(),
    `mikrodb-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  );
  if (!existsSync(uniqueDir)) mkdirSync(uniqueDir, { recursive: true });
  return uniqueDir;
};

describe('Basic read operations', () => {
  test('It should read a single record by key', async () => {
    const user = await db.get({ tableName: 'users', key: 'user1' });
    expect(user).toEqual(users[0]);
  });

  test('It should return all records when no filter is provided', async () => {
    const allUsers = await db.get({ tableName: 'users' });
    expect(allUsers).toHaveLength(2);

    expect(allUsers).toMatchObject([
      [
        'user2',
        {
          x: 0,
          value: {
            age: 25,
            email: 'jane@company.com',
            id: 'user2',
            lastLogin: 1708819200000,
            name: 'Jane Smith',
            profile: {
              location: {
                city: 'Toronto',
                country: 'Canada'
              },
              preferences: {
                notifications: false,
                theme: 'light'
              }
            },
            role: 'user',
            scores: [95, 88, 91],
            status: 'active',
            tags: ['premium']
          },
          v: 1
        }
      ],
      [
        'user1',
        {
          x: 0,
          value: {
            age: 30,
            email: 'john@example.com',
            id: 'user1',
            lastLogin: 1708732800000,
            name: 'John Doe',
            profile: {
              location: {
                city: 'New York',
                country: 'USA'
              },
              preferences: {
                notifications: true,
                theme: 'dark'
              }
            },
            role: 'admin',
            scores: [85, 92, 78],
            status: 'active',
            tags: ['vip', 'early-adopter']
          },
          v: 1
        }
      ]
    ]);
  });
});

describe('Equality filters', () => {
  test('It should filter by exact match', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: { status: 'active' }
      }
    });
    expect(result).toHaveLength(2);
  });

  test('It should filter by explicit equality', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: { age: { operator: 'eq', value: 30 } }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });

  test('It should filter by inequality', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          age: { operator: 'neq', value: 30 }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Jane Smith');
  });
});

describe('Comparison filters', () => {
  test('It should filter with greater than', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          age: { operator: 'gt', value: 25 }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].age).toBe(30);
  });

  test('It should filter with greater than or equal', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          age: { operator: 'gte', value: 25 }
        }
      }
    });
    expect(result).toHaveLength(2);
  });

  test('It should filter with less than', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          age: { operator: 'lt', value: 30 }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].age).toBe(25);
  });

  test('It should filter with less than or equal', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          age: { operator: 'lte', value: 30 }
        }
      }
    });
    expect(result).toHaveLength(2);
  });

  test('It should filter with between', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          age: { operator: 'between', value: [24, 26] }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].age).toBe(25);
  });
});

describe('Array filters', () => {
  test('It should filter with array contains', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          tags: { operator: 'contains', value: 'vip' }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });

  test('It should filter with array containsAll', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          tags: { operator: 'containsAll', value: ['vip', 'early-adopter'] }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });

  test('It should filter with array containsAny', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          tags: { operator: 'containsAny', value: ['premium', 'vip'] }
        }
      }
    });
    expect(result).toHaveLength(2);
  });

  test('It should filter by array size', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          tags: { operator: 'size', value: 2 }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });
});

describe('String filters', () => {
  test('It should filter with like operator', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          email: { operator: 'like', value: '@company.com' }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Jane Smith');
  });

  test('It should filter with regex operator', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          email: { operator: 'regex', value: '^[^@]+@company\\.com$' }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Jane Smith');
  });
});

describe('Logical operators', () => {
  test('It should combine multiple conditions (implicit AND)', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          status: 'active',
          role: 'admin'
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });

  test('It should handle OR conditions', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          $or: [{ role: 'admin' }, { 'profile.location.country': 'Canada' }]
        }
      }
    });
    expect(result).toHaveLength(2);
  });
});

describe('Sorting', () => {
  test('It should sort results by field', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        sort: (a: any, b: any) => a.age - b.age
      }
    });
    expect(result).toHaveLength(2);
    expect(result[0].age).toBe(25);
    expect(result[1].age).toBe(30);
  });

  test('It should sort filtered results', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        sort: (a: any, b: any) => b.lastLogin - a.lastLogin,
        filter: {
          status: 'active'
        }
      }
    });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Jane Smith');
    expect(result[1].name).toBe('John Doe');
  });
});

describe('Nested object filters', () => {
  test('It should filter on nested fields using dot notation', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          'profile.location.country': 'USA'
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });

  test('It should filter on deeply nested fields with operators', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          'profile.preferences.theme': { operator: 'eq', value: 'dark' }
        }
      }
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });
});

describe('Complex queries', () => {
  test('It should handle complex filtering and sorting', async () => {
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
        sort: (a: any, b: any) => b.lastLogin - a.lastLogin,
        limit: 2
      }
    });

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Jane Smith');
    expect(result[1].name).toBe('John Doe');
  });

  test('It should handle nested filtering with multiple operators', async () => {
    const result = await db.get({
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

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });
});

describe('Edge cases', () => {
  test('It should handle non-existent fields', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          nonexistentField: { operator: 'eq', value: 'something' }
        }
      }
    });
    expect(result).toHaveLength(0);
  });

  test('It should handle empty array values', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          tags: { operator: 'containsAll', value: [] }
        }
      }
    });
    expect(result).toHaveLength(2);
  });

  test('It should handle invalid regex patterns', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          email: { operator: 'regex', value: '[' }
        }
      }
    });
    expect(result).toHaveLength(0);
  });

  test('It should handle null values', async () => {
    const result = await db.get({
      tableName: 'users',
      options: {
        filter: {
          status: null
        }
      }
    });
    expect(result).toHaveLength(0);
  });
});
