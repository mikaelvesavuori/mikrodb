import { writeFile } from 'node:fs/promises';

import { Encryption } from '../Encryption.js';
import { Persistence } from '../Persistence.js';

/**
 * @description Write a file to disk.
 * If encryption is enabled, encrypt the entire file including MDB header.
 */
export async function writeToDisk(
  filePath: string,
  data: Map<string, any>,
  encryptionKey: string | null
) {
  const encryption = new Encryption();
  const persistence = new Persistence();

  let buffer = persistence.toBinaryBuffer(data);
  if (!buffer) {
    console.log('Buffer is empty, skipping...');
    return;
  }

  if (encryptionKey) {
    try {
      const key = encryption.generateKey(encryptionKey, 'salt');
      const dataString = buffer.toString('binary');
      const iv = encryption.generateIV();
      const encryptedData = encryption.encrypt(dataString, key, iv);
      buffer = encryption.serialize(encryptedData);
    } catch (error) {
      console.error('Encryption failed:', error);
    }
  }

  await writeFile(filePath, buffer);
}
