import { MikroServe } from 'mikroserve';

import { MikroDB } from './MikroDB.js';

import type {
  CombinedConfiguration,
  DeleteOperation,
  GetOperation,
  WriteOperation,
  WriteOptions
} from './interfaces/index.js';

import { createGetOptions } from './utils/index.js';

/**
 * @description Starts a MikroServe instance to expose MikroDB as an API.
 */
export async function startServer(config: CombinedConfiguration) {
  const db = new MikroDB({ ...config.db, events: config?.events });

  await db.start();

  const server = new MikroServe(config.server);

  server.get('/table', async (c: any) => {
    const body = c.req.body;

    if (!body.tableName) return c.json({ statusCode: 400, body: 'tableName is required' });

    const result = await db.getTableSize(body.tableName);
    if (!result) c.json({ statusCode: 404, body: null });

    return c.json({ statusCode: 200, body: result });
  });

  server.post('/get', async (c: any) => {
    const body = c.req.body;

    if (!body.tableName) return c.json({ statusCode: 400, body: 'tableName is required' });

    const operation: GetOperation = {
      tableName: body.tableName,
      key: body.key
    };

    const options = createGetOptions(body?.options);
    if (options) operation.options = options;

    const result = await db.get(operation);
    if (!result) c.json({ statusCode: 404, body: null });

    return c.json({ statusCode: 200, body: result });
  });

  server.post('/write', async (c: any) => {
    const body = c.req.body;

    if (!body.tableName || body.value === undefined)
      return c.json({ statusCode: 400, body: 'tableName and value are required' });

    const operation: WriteOperation = {
      tableName: body.tableName,
      key: body.key,
      value: body.value,
      expectedVersion: body.expectedVersion,
      expiration: body.expiration
    };

    const options: WriteOptions = {
      concurrencyLimit: body.concurrencyLimit,
      flushImmediately: body.flushImmediately
    };

    const result = await db.write(operation, options);

    return c.json({ statusCode: 200, body: result });
  });

  server.delete('/delete', async (c: any) => {
    const query = c.params;

    if (!query.tableName || !query.key)
      return c.json({ statusCode: 400, body: 'tableName and key are required' });

    const operation: DeleteOperation = {
      tableName: query.tableName,
      key: query.key
    };

    const result = await db.delete(operation);

    return c.json({ statusCode: 200, body: result });
  });

  server.start();

  return server;
}
