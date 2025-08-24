import { readFileSync } from 'node:fs';

/**
 * @description Tests the integrity of produced data which means both
 * persisted data in each database file, as well as the WAL logs.
 */
export class IntegrityCheck {
  private readonly testItemsLengthName = 'Items length is correct';
  private readonly testStartsWithName = 'Items starts with correct key';
  private readonly testUnicityName = 'Item keys are unique';
  //private readonly testLogLengthName = 'WAL log is correct length';

  /**
   * @description Function to check if the file has an array of arrays of a given length.
   */
  private checkArrayOfArraysLength(filePath: string, expectedLength: number) {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));

    let success = true;
    let errorCount = 0;
    const logs: string[] = [];

    if (!Array.isArray(data))
      throw new Error('File does not contain an array.');

    for (const item of data) {
      if (!Array.isArray(item))
        throw new Error('File contains an element that is not an array.');
    }

    if (data.length !== expectedLength) {
      success = false;
      errorCount++;
      logs.push(
        `Array length does not match the expected length of ${expectedLength}; it was ${data.length}.`
      );
    }

    if (logs.length > 0)
      console.error('ERRORS:', this.testItemsLengthName, logs);

    return {
      success,
      errors: errorCount
    };
  }

  /**
   * @description Function to check if the first item in the array starts with a given value.
   */
  private checkFirstItemStartsWith(filePath: string, startValue: string) {
    const items = JSON.parse(readFileSync(filePath, 'utf-8'));

    let success = true;
    let errorCount = 0;
    const logs: string[] = [];

    items.forEach((item: Record<string, any>) => {
      const firstItem = item[0];

      if (typeof firstItem !== 'string') {
        success = false;
        errorCount++;
        logs.push('First item in the array is not a string.');
      } else if (!firstItem?.startsWith(startValue)) {
        success = false;
        errorCount++;
        logs.push(
          `First item does not start with the given value: ${startValue}.`
        );
      }
    });

    if (logs.length > 0)
      console.error('ERRORS:', this.testStartsWithName, logs);

    return {
      success,
      errors: errorCount
    };
  }

  /**
   * @description Function to check if the first item is unique across all items in the file.
   */
  private checkUniqueFirstItems(filePath: string) {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const seen = new Set();

    let success = true;
    let errorCount = 0;
    const logs: string[] = [];

    for (const item of data) {
      const firstItem = item[0];

      if (!firstItem) {
        success = false;
        errorCount++;
        logs.push('First item in the array is not a string.');
      } else if (typeof firstItem !== 'string') {
        success = false;
        errorCount++;
        logs.push(`First item "${firstItem}" is not a string.`);
      } else if (seen.has(firstItem)) {
        success = false;
        errorCount++;
        logs.push(`The first item "${firstItem}" is not unique.`);
      }

      seen.add(firstItem);
    }

    if (logs.length > 0) console.error('ERRORS:', this.testUnicityName, logs);

    return {
      success,
      errors: errorCount
    };
  }

  /**
   * @description Function to check if the second file (log file) has the expected number of lines.
   */
  /*
  private checkLogFileLineCount(
    logFilePath: string,
    expectedLineCount: number
  ) {
    const data = readFileSync(logFilePath, 'utf-8');
    const lines = data.split('\n');

    let success = true;
    let errorCount = 0;
    const logs: string[] = [];

    // There will be an empty line at the end
    if (lines.length !== expectedLineCount + 1) {
      success = false;
      errorCount++;
      logs.push(
        `Log file does not contain the expected number of lines: ${expectedLineCount}.`
      );
    }

    if (logs.length > 0) console.error('ERRORS:', this.testLogLengthName, logs);

    return {
      success,
      errors: errorCount
    };
  }
  */

  // Main function to run all the checks
  public runIntegrityChecks(options: Record<string, any>) {
    const {
      filePath,
      //logFilePath,
      startValue,
      expectedItemCount
      //expectedLogLineCount
    } = options;

    try {
      const itemsLengthResult = this.checkArrayOfArraysLength(
        filePath,
        expectedItemCount
      );
      const startsWithResult = this.checkFirstItemStartsWith(
        filePath,
        startValue
      );
      const unicityResult = this.checkUniqueFirstItems(filePath);
      //const logLengthResult = this.checkLogFileLineCount(
      //  logFilePath,
      //  expectedLogLineCount
      //);

      const success =
        itemsLengthResult.success &&
        startsWithResult.success &&
        unicityResult.success;
      //logLengthResult.success;

      if (success) console.log('✅ All integrity checks passed!');
      else {
        console.error('❌ Integrity check failed');

        console.table([
          {
            Test: this.testItemsLengthName,
            Errors: itemsLengthResult.errors
          },
          {
            Test: this.testStartsWithName,
            Errors: startsWithResult.errors
          },
          { Test: this.testUnicityName, Errors: unicityResult.errors }
          //{
          //  Test: this.testLogLengthName,
          //  Errors: logLengthResult.errors
          //}
        ]);
      }
    } catch (error) {
      console.error('💥 Integrity check crashed:', error);
    }
  }
}
