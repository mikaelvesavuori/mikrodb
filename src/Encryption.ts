import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from 'node:crypto';

import type { EncryptedData } from './interfaces/index.js';

/**
 * @description Encrypts and decrypts using AES-256-GCM.
 */
export class Encryption {
  private readonly algo = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly IV_LENGTH = 12; // 96 bits - recommended for GCM

  /**
   * @description Derives a key from password and salt using scrypt
   */
  public generateKey(password: string, salt: string): Buffer {
    return scryptSync(`${salt}#${password}`, salt, this.KEY_LENGTH);
  }

  /**
   * @description Generates a random IV of appropriate length
   */
  public generateIV(): Buffer {
    return randomBytes(this.IV_LENGTH);
  }

  /**
   * @description Encrypts plain text using AES-256-GCM
   * @example
   * const key = encryption.generateKey(password, salt);
   * const iv = encryption.generateIV();
   * const encryptedData = encryption.encrypt(plainText, key, iv);
   */
  public encrypt(plainText: string, key: Buffer, iv: Buffer): EncryptedData {
    if (key.length !== this.KEY_LENGTH) {
      throw new Error(
        `Invalid key length: ${key.length} bytes. Expected: ${this.KEY_LENGTH} bytes`
      );
    }

    if (iv.length !== this.IV_LENGTH) {
      throw new Error(
        `Invalid IV length: ${iv.length} bytes. Expected: ${this.IV_LENGTH} bytes`
      );
    }

    const cipher = createCipheriv(this.algo, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return { iv, encrypted, authTag };
  }

  /**
   * @description Decrypts encrypted data using AES-256-GCM
   * @example
   * const key = encryption.generateKey(password, salt);
   * const decrypted = encryption.decrypt(encryptedData, key);
   */
  public decrypt(encryptedData: EncryptedData, key: Buffer): string {
    const { iv, encrypted, authTag } = encryptedData;

    if (key.length !== this.KEY_LENGTH) {
      throw new Error(
        `Invalid key length: ${key.length} bytes. Expected: ${this.KEY_LENGTH} bytes`
      );
    }

    if (iv.length !== this.IV_LENGTH) {
      throw new Error(
        `Invalid IV length: ${iv.length} bytes. Expected: ${this.IV_LENGTH} bytes`
      );
    }

    const decipher = createDecipheriv(this.algo, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8');
  }

  /**
   * @description Combines encrypted data into a single buffer for storage
   */
  public serialize(data: EncryptedData): Buffer {
    return Buffer.concat([
      // First byte: version for future format changes
      Buffer.from([1]),
      // Next byte: IV length
      Buffer.from([data.iv.length]),
      // IV
      data.iv,
      // Next byte: authTag length
      Buffer.from([data.authTag.length]),
      // AuthTag
      data.authTag,
      // Encrypted data
      data.encrypted
    ]);
  }

  /**
   * @description Extracts encrypted data components from a serialized buffer
   */
  public deserialize(serialized: Buffer): EncryptedData {
    let offset = 0;

    // Version byte
    const version = serialized[offset++];
    if (version !== 1) {
      throw new Error(`Unsupported encryption format version: ${version}`);
    }

    // IV
    const ivLength = serialized[offset++];
    const iv = serialized.subarray(offset, offset + ivLength);
    offset += ivLength;

    // Auth Tag
    const authTagLength = serialized[offset++];
    const authTag = serialized.subarray(offset, offset + authTagLength);
    offset += authTagLength;

    // Encrypted data
    const encrypted = serialized.subarray(offset);

    return { iv, authTag, encrypted };
  }

  // Utility methods
  public toHex(value: Buffer): string {
    return value.toString('hex');
  }

  public toUtf8(value: Buffer): string {
    return value.toString('utf8');
  }

  public toBuffer(hexString: string): Buffer {
    return Buffer.from(hexString, 'hex');
  }
}
