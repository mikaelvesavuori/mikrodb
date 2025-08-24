import { time } from './utils/index.js';

/**
 * @description Handles reading, writing, encoding, and decoding data.
 */
export class Persistence {
  /**
   * @description Read table data from binary format with optimizations.
   */
  public readTableFromBinaryBuffer(buffer: Buffer): Map<string, any> {
    // Quick header validation
    if (
      buffer.length < 8 ||
      buffer[0] !== 0x4d || // 'M'
      buffer[1] !== 0x44 || // 'D'
      buffer[2] !== 0x42 || // 'B'
      buffer[3] !== 0x01 // Version 1
    ) {
      throw new Error('Invalid table file format');
    }

    const recordCount = buffer.readUInt32LE(4);

    const tableData = new Map<string, any>();

    let offset = 8;
    const now = time();

    for (let i = 0; i < recordCount && offset + 26 <= buffer.length; i++) {
      const keyLength = buffer.readUInt16LE(offset);
      offset += 2;

      const valueLength = buffer.readUInt32LE(offset);
      offset += 4;

      const version = buffer.readUInt32LE(offset);
      offset += 4;

      const timestamp = Number(buffer.readBigUInt64LE(offset));
      offset += 8;

      const expiration = Number(buffer.readBigUInt64LE(offset));
      offset += 8;

      if (offset + keyLength + valueLength > buffer.length) break;

      if (expiration && expiration <= now) {
        offset += keyLength + valueLength;
        continue;
      }

      const key = buffer.toString('utf8', offset, offset + keyLength);
      offset += keyLength;

      const valueBuffer = buffer.slice(offset, offset + valueLength);
      offset += valueLength;

      const value = this.decodeValue(valueBuffer);

      tableData.set(key, {
        value,
        version,
        timestamp,
        expiration: expiration || null
      });
    }

    return tableData;
  }

  /**
   * @description Write table data to a binary file format.
   */
  public toBinaryBuffer(tableData: Map<string, any>): Buffer {
    const chunks: Buffer[] = [];

    // Write file header: magic bytes + version
    const header = Buffer.from([0x4d, 0x44, 0x42, 0x01]); // "MDB" + version 1
    chunks.push(header);

    // Filter out invalid keys and get valid entries count
    const validEntries = Array.from(tableData.entries()).filter(
      ([key]) => typeof key === 'string'
    );

    // Write record count (4 bytes, little endian)
    const countBuffer = Buffer.alloc(4);
    countBuffer.writeUInt32LE(validEntries.length, 0);
    chunks.push(countBuffer);

    for (const [key, record] of validEntries) {
      // Skip null or non-string keys
      if (key === null || typeof key !== 'string') continue;

      // Record structure:
      // - key length (2 bytes)
      // - value length (4 bytes)
      // - version (4 bytes)
      // - timestamp (8 bytes)
      // - expiration (8 bytes)
      // - key (variable)
      // - value (variable, encoded as BSON)
      const keyBuffer = Buffer.from(key);
      const valueBuffer = this.encodeValue(record.value);

      // Key length (2 bytes, max 65535 chars)
      const keyLenBuffer = Buffer.alloc(2);
      keyLenBuffer.writeUInt16LE(keyBuffer.length, 0);
      chunks.push(keyLenBuffer);

      // Value length (4 bytes)
      const valueLenBuffer = Buffer.alloc(4);
      valueLenBuffer.writeUInt32LE(valueBuffer.length, 0);
      chunks.push(valueLenBuffer);

      // Version (4 bytes)
      const versionBuffer = Buffer.alloc(4);
      versionBuffer.writeUInt32LE(record.version || 0, 0);
      chunks.push(versionBuffer);

      // Timestamp (8 bytes)
      const timestampBuffer = Buffer.alloc(8);
      timestampBuffer.writeBigUInt64LE(BigInt(record.timestamp || 0), 0);
      chunks.push(timestampBuffer);

      // Expiration (8 bytes)
      const expirationBuffer = Buffer.alloc(8);
      expirationBuffer.writeBigUInt64LE(BigInt(record.expiration || 0), 0);
      chunks.push(expirationBuffer);

      chunks.push(keyBuffer);
      chunks.push(valueBuffer);
    }

    return Buffer.concat(chunks);
  }

  /**
   * @description Encode a JavaScript value to a binary format.
   */
  private encodeValue(value: any): Buffer {
    if (value === null || value === undefined) return Buffer.from([0x00]); // Null type

    if (typeof value === 'boolean')
      return Buffer.from([0x01, value ? 0x01 : 0x00]);

    if (typeof value === 'number') {
      if (
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647
      ) {
        // 32-bit integer
        const buf = Buffer.alloc(5);
        buf[0] = 0x02; // Int32 type
        buf.writeInt32LE(value, 1);
        return buf;
      }

      // Double
      const buf = Buffer.alloc(9);
      buf[0] = 0x03; // Double type
      buf.writeDoubleLE(value, 1);
      return buf;
    }

    if (typeof value === 'string') {
      const strBuf = Buffer.from(value, 'utf8');
      const buf = Buffer.alloc(5 + strBuf.length);
      buf[0] = 0x04; // String type
      buf.writeUInt32LE(strBuf.length, 1);
      strBuf.copy(buf, 5);
      return buf;
    }

    if (Array.isArray(value)) {
      // Array: type + count + encoded items
      const encodedItems: Buffer[] = [];
      const countBuf = Buffer.alloc(5);
      countBuf[0] = 0x05; // Array type
      countBuf.writeUInt32LE(value.length, 1);
      encodedItems.push(countBuf);

      for (const item of value) encodedItems.push(this.encodeValue(item));

      return Buffer.concat(encodedItems);
    }

    if (typeof value === 'object') {
      if (value instanceof Date) {
        const buf = Buffer.alloc(9);
        buf[0] = 0x07; // Date type (new type code)
        buf.writeBigInt64LE(BigInt(value.getTime()), 1);
        return buf;
      }

      // Object: type + prop count + (key length + key + encoded value) pairs
      const keys = Object.keys(value);
      const encodedItems: Buffer[] = [];

      const countBuf = Buffer.alloc(5);
      countBuf[0] = 0x06; // Object type
      countBuf.writeUInt32LE(keys.length, 1);
      encodedItems.push(countBuf);

      for (const key of keys) {
        const keyBuf = Buffer.from(key, 'utf8');
        const keyLenBuf = Buffer.alloc(2);
        keyLenBuf.writeUInt16LE(keyBuf.length, 0);

        encodedItems.push(keyLenBuf);
        encodedItems.push(keyBuf);
        encodedItems.push(this.encodeValue(value[key]));
      }

      return Buffer.concat(encodedItems);
    }

    return this.encodeValue(String(value));
  }

  /**
   * @description Optimized decode value with specialized fast paths
   */
  private decodeValue(buffer: Buffer): any {
    if (buffer.length === 0) return null;

    const type = buffer[0];

    switch (type) {
      case 0x00: // Null
        return null;

      case 0x01: // Boolean
        return buffer[1] === 0x01;

      case 0x02: // Int32
        return buffer.readInt32LE(1);

      case 0x03: // Double
        return buffer.readDoubleLE(1);

      case 0x04: {
        // String - hot path optimization
        const length = buffer.readUInt32LE(1);
        // Direct toString without creating a new slice buffer
        return buffer.toString('utf8', 5, 5 + length);
      }

      case 0x05: {
        // Array
        const count = buffer.readUInt32LE(1);
        const array = new Array(count);
        let offset = 5;

        for (let i = 0; i < count; i++) {
          // Use specialized decode with offset tracking
          const { value, bytesRead } = this.decodeValueWithSize(buffer, offset);
          array[i] = value;
          offset += bytesRead;
        }

        return array;
      }

      case 0x06: {
        // Object
        const count = buffer.readUInt32LE(1);
        const obj: Record<string, any> = {};
        let offset = 5;

        for (let i = 0; i < count; i++) {
          // Direct buffer reads using absolute offsets (no slice operations)
          const keyLength = buffer.readUInt16LE(offset);
          offset += 2;

          // Read key - direct toString
          const key = buffer.toString('utf8', offset, offset + keyLength);
          offset += keyLength;

          // Read value with absolute offset
          const { value, bytesRead } = this.decodeValueWithSize(buffer, offset);
          obj[key] = value;
          offset += bytesRead;
        }

        return obj;
      }

      case 0x07: // Date
        return new Date(Number(buffer.readBigInt64LE(1)));

      default:
        console.warn(`Unknown type byte: ${type}`);
        return null;
    }
  }

  /**
   * @description Optimized helper method to decode a value using absolute offsets
   */
  private decodeValueWithSize(
    buffer: Buffer,
    startOffset = 0
  ): {
    value: any;
    bytesRead: number;
  } {
    if (startOffset >= buffer.length) return { value: null, bytesRead: 0 };

    const type = buffer[startOffset];

    switch (type) {
      case 0x00: // Null
        return { value: null, bytesRead: 1 };

      case 0x01: // Boolean
        return { value: buffer[startOffset + 1] === 0x01, bytesRead: 2 };

      case 0x02: // Int32
        return { value: buffer.readInt32LE(startOffset + 1), bytesRead: 5 };

      case 0x03: // Double
        return { value: buffer.readDoubleLE(startOffset + 1), bytesRead: 9 };

      case 0x04: {
        // String
        const length = buffer.readUInt32LE(startOffset + 1);
        const value = buffer.toString(
          'utf8',
          startOffset + 5,
          startOffset + 5 + length
        );
        return { value, bytesRead: 5 + length };
      }

      case 0x05: {
        // Array
        const count = buffer.readUInt32LE(startOffset + 1);
        const array = new Array(count);
        let offset = startOffset + 5;

        for (let i = 0; i < count; i++) {
          const result = this.decodeValueWithSize(buffer, offset);
          array[i] = result.value;
          offset += result.bytesRead;
        }

        return { value: array, bytesRead: offset - startOffset };
      }

      case 0x06: {
        // Object
        const count = buffer.readUInt32LE(startOffset + 1);
        const obj: Record<string, any> = {};
        let offset = startOffset + 5;

        for (let i = 0; i < count; i++) {
          const keyLength = buffer.readUInt16LE(offset);
          offset += 2;

          const key = buffer.toString('utf8', offset, offset + keyLength);
          offset += keyLength;

          const result = this.decodeValueWithSize(buffer, offset);
          obj[key] = result.value;
          offset += result.bytesRead;
        }

        return { value: obj, bytesRead: offset - startOffset };
      }

      case 0x07: // Date
        return {
          value: new Date(Number(buffer.readBigInt64LE(startOffset + 1))),
          bytesRead: 9
        };

      default:
        console.warn(`Unknown type byte: ${type} at offset ${startOffset}`);
        return { value: null, bytesRead: 1 };
    }
  }
}
