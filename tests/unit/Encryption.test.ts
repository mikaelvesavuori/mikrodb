import { beforeEach, describe, expect, test } from 'vitest';

import type { EncryptedData } from '../../src/interfaces/index.js';

import { Encryption } from '../../src/Encryption.js';

describe('Encryption', () => {
  let encryption: Encryption;

  beforeEach(() => {
    encryption = new Encryption();
  });

  describe('Key Generation', () => {
    test('It should generate consistent and valid keys', () => {
      // Check key length
      const key = encryption.generateKey('password123', 'salt123');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);

      // Check consistency
      const sameKey = encryption.generateKey('password123', 'salt123');
      expect(key.equals(sameKey)).toBe(true);

      // Check different passwords produce different keys
      const differentPasswordKey = encryption.generateKey(
        'different',
        'salt123'
      );
      expect(key.equals(differentPasswordKey)).toBe(false);

      // Check different salts produce different keys
      const differentSaltKey = encryption.generateKey(
        'password123',
        'different'
      );
      expect(key.equals(differentSaltKey)).toBe(false);
    });
  });

  describe('IV Generation', () => {
    test('It should generate IVs of correct length', () => {
      const iv = encryption.generateIV();
      expect(iv).toBeInstanceOf(Buffer);
      expect(iv.length).toBe(12);
    });

    test('It should generate random IVs', () => {
      // Generate multiple IVs and ensure they're different
      const iv1 = encryption.generateIV();
      const iv2 = encryption.generateIV();
      const iv3 = encryption.generateIV();

      expect(iv1.equals(iv2)).toBe(false);
      expect(iv1.equals(iv3)).toBe(false);
      expect(iv2.equals(iv3)).toBe(false);
    });
  });

  describe('Encryption and Decryption', () => {
    let key: Buffer;
    let testCases: { label: string; data: string }[];

    beforeEach(() => {
      key = encryption.generateKey('test-password', 'test-salt');
      testCases = [
        { label: 'empty string', data: '' },
        { label: 'short text', data: 'Hello, world!' },
        { label: 'long text', data: 'a'.repeat(1000) },
        {
          label: 'JSON data',
          data: JSON.stringify({ id: 123, name: 'Test', items: [1, 2, 3] })
        },
        { label: 'special chars', data: '!@#$%^&*()_+{}:"<>?[];\',./' }
      ];
    });

    test('It should encrypt data to a different value', () => {
      for (const { data } of testCases) {
        // Skip empty string test case - encrypted empty strings may appear empty when toString'd
        if (data === '') continue;

        const iv = encryption.generateIV();
        const { encrypted } = encryption.encrypt(data, key, iv);

        // Compare as buffers to avoid UTF-8 encoding issues
        expect(Buffer.compare(encrypted, Buffer.from(data))).not.toBe(0);

        // Also check string representation for non-empty strings
        expect(encrypted.toString('utf8')).not.toBe(data);
      }
    });

    test('It should correctly decrypt encrypted data', () => {
      for (const { data } of testCases) {
        // Encrypt
        const iv = encryption.generateIV();
        const encryptedData = encryption.encrypt(data, key, iv);

        // Decrypt
        const decryptedText = encryption.decrypt(encryptedData, key);

        // Verify
        expect(decryptedText).toBe(data);
      }
    });
  });

  describe('Serialization and Deserialization', () => {
    test('It should serialize and deserialize encrypted data correctly', () => {
      // Setup
      const key = encryption.generateKey('serialization-test', 'test-salt');
      const iv = encryption.generateIV();
      const testText = 'Text to be serialized and deserialized';

      // Encrypt
      const encryptedData = encryption.encrypt(testText, key, iv);

      // Serialize
      const serialized = encryption.serialize(encryptedData);
      expect(serialized).toBeInstanceOf(Buffer);

      // Deserialize
      const deserialized = encryption.deserialize(serialized);

      // Verify structure
      expect(deserialized).toHaveProperty('iv');
      expect(deserialized).toHaveProperty('authTag');
      expect(deserialized).toHaveProperty('encrypted');

      // Verify buffers match
      expect(deserialized.iv.equals(encryptedData.iv)).toBe(true);
      expect(deserialized.authTag.equals(encryptedData.authTag)).toBe(true);
      expect(deserialized.encrypted.equals(encryptedData.encrypted)).toBe(true);

      // Verify we can decrypt the deserialized data
      const decrypted = encryption.decrypt(deserialized, key);
      expect(decrypted).toBe(testText);
    });

    test('It should throw error for unsupported version', () => {
      // Create a valid serialized data first
      const key = encryption.generateKey('version-test', 'test-salt');
      const iv = encryption.generateIV();
      const encryptedData = encryption.encrypt('Test', key, iv);
      const serialized = encryption.serialize(encryptedData);

      // Modify version byte to be invalid
      const tampered = Buffer.concat([
        Buffer.from([99]), // Invalid version
        serialized.subarray(1)
      ]);

      // Should throw on deserialization
      expect(() => encryption.deserialize(tampered)).toThrow(
        'Unsupported encryption format version'
      );
    });
  });

  describe('Error Handling', () => {
    test('It should throw error for invalid key length in encrypt', () => {
      const invalidKey = Buffer.from('too-short');
      const iv = encryption.generateIV();

      expect(() => encryption.encrypt('test', invalidKey, iv)).toThrow(
        'Invalid key length'
      );
    });

    test('It should throw error for invalid IV length in encrypt', () => {
      const key = encryption.generateKey('test', 'salt');
      const invalidIv = Buffer.from('wrong-size');

      expect(() => encryption.encrypt('test', key, invalidIv)).toThrow(
        'Invalid IV length'
      );
    });

    test('It should throw error for invalid key length in decrypt', () => {
      // First create valid encrypted data
      const validKey = encryption.generateKey('valid-key', 'salt');
      const iv = encryption.generateIV();
      const encryptedData = encryption.encrypt('test message', validKey, iv);

      // Then try to decrypt with invalid key
      const invalidKey = Buffer.from('too-short-decrypt-key');

      expect(() => encryption.decrypt(encryptedData, invalidKey)).toThrow(
        'Invalid key length'
      );
    });

    test('It should throw error for invalid IV length in decrypt', () => {
      // First create valid encrypted data
      const key = encryption.generateKey('valid-key', 'salt');
      const validIv = encryption.generateIV();
      const encryptedData = encryption.encrypt('test message', key, validIv);

      // Modify the IV to be invalid
      const invalidEncryptedData: EncryptedData = {
        ...encryptedData,
        iv: Buffer.from('invalid-iv-too-long-or-short')
      };

      expect(() => encryption.decrypt(invalidEncryptedData, key)).toThrow(
        'Invalid IV length'
      );
    });

    test('It should fail to decrypt with incorrect key', () => {
      // Setup
      const correctKey = encryption.generateKey('correct', 'salt');
      const wrongKey = encryption.generateKey('wrong', 'salt');
      const iv = encryption.generateIV();

      // Encrypt with correct key
      const encryptedData = encryption.encrypt('test message', correctKey, iv);

      // Should fail when decrypting with wrong key
      expect(() => encryption.decrypt(encryptedData, wrongKey)).toThrow();
    });

    test('It should fail to decrypt with tampered data', () => {
      // Setup
      const key = encryption.generateKey('tamper-test', 'salt');
      const iv = encryption.generateIV();
      const encryptedData = encryption.encrypt('sensitive data', key, iv);

      // Create tampered versions
      const tamperedEncrypted: EncryptedData = {
        ...encryptedData,
        encrypted: Buffer.concat([
          encryptedData.encrypted.slice(0, -1),
          Buffer.from([
            encryptedData.encrypted[encryptedData.encrypted.length - 1] ^ 1
          ]) // Flip last bit
        ])
      };

      const tamperedAuthTag: EncryptedData = {
        ...encryptedData,
        authTag: Buffer.from(encryptedData.authTag.map((b) => b ^ 1)) // Flip all bits
      };

      // Both should fail
      expect(() => encryption.decrypt(tamperedEncrypted, key)).toThrow();
      expect(() => encryption.decrypt(tamperedAuthTag, key)).toThrow();
    });
  });

  describe('Utility Methods', () => {
    test('It should convert between hex, utf8, and buffer formats correctly', () => {
      const testData = {
        text: 'Hello, world!',
        binary: Buffer.from([0x01, 0x02, 0x03, 0xff, 0xee])
      };

      // toHex
      const hexString = encryption.toHex(testData.binary);
      expect(hexString).toBe('010203ffee'); // Match the actual buffer content

      // toBuffer
      const fromHex = encryption.toBuffer(hexString);
      expect(fromHex.equals(testData.binary)).toBe(true);

      // toUtf8
      const textBuffer = Buffer.from(testData.text);
      const utf8String = encryption.toUtf8(textBuffer);
      expect(utf8String).toBe(testData.text);
    });
  });

  describe('Complete Workflow', () => {
    test('It should support a complete encryption/decryption workflow with serialization', () => {
      // 1. Setup
      const password = 'secure-password';
      const salt = 'random-salt';
      const data = JSON.stringify({
        username: 'user123',
        email: 'user@example.com',
        preferences: { theme: 'dark', notifications: true }
      });

      // 2. Generate cryptographic materials
      const key = encryption.generateKey(password, salt);
      const iv = encryption.generateIV();

      // 3. Encrypt
      const encryptedData = encryption.encrypt(data, key, iv);

      // 4. Serialize (for storage)
      const serialized = encryption.serialize(encryptedData);

      // 5. Store serialized data (simulating database storage)
      const storedEncryptedData = Buffer.from(serialized);

      // 6. Later, retrieve and deserialize
      const retrievedEncryptedData =
        encryption.deserialize(storedEncryptedData);

      // 7. Decrypt
      const decrypted = encryption.decrypt(retrievedEncryptedData, key);

      // 8. Verify
      const decryptedObj = JSON.parse(decrypted);
      expect(decryptedObj).toEqual({
        username: 'user123',
        email: 'user@example.com',
        preferences: { theme: 'dark', notifications: true }
      });
    });
  });
});
