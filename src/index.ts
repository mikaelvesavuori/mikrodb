#!/usr/bin/env node

import { MikroConf } from 'mikroconf';

import type { CombinedConfiguration } from './interfaces/index.js';

import { startServer } from './Server.js';

import { configDefaults } from './utils/configDefaults.js';

/**
 * @description Serve MikroDB through a Node server.
 */
async function main() {
  const args = process.argv;

  const isRunFromCommandLine = args[1]?.includes('node_modules/.bin/mikrodb');
  const force = (process.argv[2] || '') === '--force';

  if (isRunFromCommandLine || force) {
    console.log('🗂️ Welcome to MikroDB! ✨');

    try {
      const defaults = configDefaults();

      const config = new MikroConf({
        configFilePath: 'mikrodb.config.json',
        args: process.argv,
        options: [
          // DB settings
          { flag: '--db', path: 'db.dbName', defaultValue: defaults.db.dbName },
          {
            flag: '--dir',
            path: 'db.databaseDirectory',
            defaultValue: defaults.db.databaseDirectory
          },
          {
            flag: '--wal',
            path: 'db.walFileName',
            defaultValue: defaults.db.walFileName
          },
          {
            flag: '--interval',
            path: 'db.walInterval',
            defaultValue: defaults.db.walInterval
          },
          {
            flag: '--encryptionKey',
            path: 'db.encryptionKey',
            defaultValue: defaults.db.encryptionKey
          },
          {
            flag: '--maxWrites',
            path: 'db.maxWriteOpsBeforeFlush',
            defaultValue: defaults.db.maxWriteOpsBeforeFlush
          },
          {
            flag: '--debug',
            path: 'db.debug',
            isFlag: true,
            defaultValue: defaults.db.debug
          },
          // Event settings
          {
            path: 'events',
            defaultValue: defaults.events
          },
          // Server settings
          {
            flag: '--port',
            path: 'server.port',
            defaultValue: defaults.server.port
          },
          {
            flag: '--host',
            path: 'server.host',
            defaultValue: defaults.server.host
          },
          {
            flag: '--https',
            path: 'server.useHttps',
            isFlag: true,
            defaultValue: defaults.server.useHttps
          },
          {
            flag: '--http2',
            path: 'server.useHttp2',
            isFlag: true,
            defaultValue: defaults.server.useHttp2
          },
          {
            flag: '--cert',
            path: 'server.sslCert',
            defaultValue: defaults.server.sslCert
          },
          {
            flag: '--key',
            path: 'server.sslKey',
            defaultValue: defaults.server.sslKey
          },
          {
            flag: '--ca',
            path: 'server.sslCa',
            defaultValue: defaults.server.sslCa
          },
          {
            flag: '--debug',
            path: 'server.debug',
            isFlag: true,
            defaultValue: defaults.server.debug
          }
        ]
      }).get() as CombinedConfiguration;

      startServer(config);
    } catch (error: any) {
      console.error(error);
    }
  }
}

main();

export { MikroDB } from './MikroDB.js';
