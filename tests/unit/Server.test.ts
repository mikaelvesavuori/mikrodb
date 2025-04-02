import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';

import { startServer } from '../../src/Server.js';
import { configDefaults } from '../../src/utils/configDefaults.js';

vi.mock('../../src/MikroDB', () => ({
  MikroDB: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ data: 'test-data' }),
    write: vi.fn().mockResolvedValue({ success: true, version: 1 }),
    delete: vi.fn().mockResolvedValue(true),
    getTableSize: vi.fn().mockResolvedValue({ size: 1000 })
  }))
}));

const mockEndpoints = new Map();

vi.mock('mikroserve', () => ({
  MikroServe: vi.fn().mockImplementation(() => ({
    get: vi.fn((path, handler) => mockEndpoints.set(`GET ${path}`, handler)),
    post: vi.fn((path, handler) => mockEndpoints.set(`POST ${path}`, handler)),
    delete: vi.fn((path, handler) => mockEndpoints.set(`DELETE ${path}`, handler)),
    start: vi.fn(),
    stop: vi.fn()
  }))
}));

// Helper for creating context objects
function createContext(method: string, path: string, body = {}, query = {}) {
  return {
    params: query, // To look like MikroServe
    req: { method, path, body, query },
    json: vi.fn((response) => response)
  };
}

const testDir = join(tmpdir(), 'mikrodb-test');
let server: any;

beforeAll(() => {
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch (error) {
    console.error(`Error cleaning up test directory: ${error}`);
  }
});

beforeEach(async () => {
  mockEndpoints.clear();
  vi.clearAllMocks();
  server = await startServer({ server: configDefaults().db } as any);
});

afterEach(() => {
  if (server?.stop) server.stop();
});

test('should initialize server with correct configuration', () => {
  expect(server).toBeDefined();
});

test('should register API endpoints', () => {
  expect(mockEndpoints.has('GET /table')).toBe(true);
  expect(mockEndpoints.has('POST /get')).toBe(true);
  expect(mockEndpoints.has('POST /write')).toBe(true);
  expect(mockEndpoints.has('DELETE /delete')).toBe(true);
});

test('GET /table should return 400 if tableName is missing', async () => {
  const handler = mockEndpoints.get('GET /table');
  const ctx = createContext('GET', '/table', {});

  const result = await handler(ctx);

  expect(result.statusCode).toBe(400);
  expect(ctx.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 400
    })
  );
});

test('POST /get should return 400 if tableName is missing', async () => {
  const handler = mockEndpoints.get('POST /get');
  const ctx = createContext('POST', '/get', {});

  const result = await handler(ctx);

  expect(result.statusCode).toBe(400);
  expect(ctx.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 400
    })
  );
});

test('POST /write should return 400 if tableName or value is missing', async () => {
  const handler = mockEndpoints.get('POST /write');
  const ctx = createContext('POST', '/write', { tableName: 'test-table' });

  const result = await handler(ctx);

  expect(result.statusCode).toBe(400);
  expect(ctx.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 400
    })
  );
});

test('DELETE /delete should return 400 if tableName or key is missing', async () => {
  const handler = mockEndpoints.get('DELETE /delete');
  const ctx = createContext('DELETE', '/delete', {}, {});

  const result = await handler(ctx);

  expect(result.statusCode).toBe(400);
  expect(ctx.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 400
    })
  );
});

test('POST /get should handle successful retrieval', async () => {
  const handler = mockEndpoints.get('POST /get');
  const ctx = createContext('POST', '/get', {
    tableName: 'test-table',
    key: 'test-key'
  });

  const result = await handler(ctx);

  expect(result.statusCode).toBe(200);
  expect(ctx.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 200,
      body: expect.anything()
    })
  );
});

test('POST /write should handle successful write operation', async () => {
  const handler = mockEndpoints.get('POST /write');
  const ctx = createContext('POST', '/write', {
    tableName: 'test-table',
    key: 'test-key',
    value: { data: 'test-data' }
  });

  const result = await handler(ctx);

  expect(result.statusCode).toBe(200);
  expect(ctx.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 200,
      body: expect.anything()
    })
  );
});

test('DELETE /delete should handle successful delete operation', async () => {
  const handler = mockEndpoints.get('DELETE /delete');
  const ctx = createContext(
    'DELETE',
    '/delete',
    {},
    {
      tableName: 'test-table',
      key: 'test-key'
    }
  );

  const result = await handler(ctx);

  expect(result.statusCode).toBe(200);
  expect(ctx.json).toHaveBeenCalledWith(
    expect.objectContaining({
      statusCode: 200,
      body: expect.anything()
    })
  );
});
