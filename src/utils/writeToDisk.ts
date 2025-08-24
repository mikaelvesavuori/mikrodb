import { writeFile, rename, unlink } from 'node:fs/promises';

import { Encryption } from '../Encryption.js';
import { Persistence } from '../Persistence.js';

/**
 * @description Write a file to disk with atomic writes using unique temp files.
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

  // Create unique temp file name to avoid concurrent write collisions
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const tempPath = `${filePath}.tmp.${timestamp}.${random}`;

  try {
    await writeFile(tempPath, buffer);
    await rename(tempPath, filePath); // Atomic operation
  } catch (error) {
    // Cleanup temp file if something goes wrong
    try {
      await unlink(tempPath);
    } catch (_cleanupError) {
      // Ignore cleanup errors - file might not exist
    }
    throw error;
  }
}
