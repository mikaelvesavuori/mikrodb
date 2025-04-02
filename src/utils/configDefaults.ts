import { getTruthyValue } from './index.js';

export const configDefaults = () => {
  return {
    db: {
      dbName: 'mikrodb',
      databaseDirectory: 'mikrodb',
      walFileName: 'wal.log',
      walInterval: 2000,
      encryptionKey: '',
      maxWriteOpsBeforeFlush: 100,
      debug: getTruthyValue(process.env.DEBUG) || false
    },
    events: {},
    server: {
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || '0.0.0.0',
      useHttps: false,
      useHttp2: false,
      sslCert: '',
      sslKey: '',
      sslCa: '',
      rateLimit: {
        enabled: true,
        requestsPerMinute: 100
      },
      allowedDomains: ['*'],
      debug: getTruthyValue(process.env.DEBUG) || false
    }
  };
};
