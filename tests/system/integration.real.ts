const urls = {
  local: 'http://0.0.0.0:3000',
  remote: process.env.REMOTE_TEST_URL || 'http://0.0.0.0:3000'
};

const LOCAL_URL = urls.local;
const REMOTE_URL = urls.remote;

const IS_LOCAL = false;

const BASE_URL = IS_LOCAL ? LOCAL_URL : REMOTE_URL;

// Type definitions
interface GetRequest {
  tableName: string;
  key: string;
  options?: {
    filter?: Record<string, any>;
    sort?: Record<string, number>;
    limit?: number;
    offset?: number;
  };
}

interface WriteRequest {
  tableName: string;
  key: string;
  value: Record<string, any>;
  expectedVersion?: number;
  expiration?: number;
  concurrencyLimit?: number;
  flushImmediately?: boolean;
}

interface TestResult {
  success: number;
  failure: number;
  errors?: any[];
  totalTime?: number;
}

// Simple function to generate a random ID
function generateRandomId(length = 10) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Utility function to make a GET request
async function makeGetRequest(req: GetRequest): Promise<any> {
  try {
    const response = await fetch(`${BASE_URL}/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req)
    });

    if (!response.ok) {
      return {
        error: true,
        status: response.status,
        message: await response.text()
      };
    }

    return response.json();
  } catch (error) {
    return { error: true, message: String(error) };
  }
}

// Utility function to make a WRITE request
async function makeWriteRequest(req: WriteRequest): Promise<any> {
  try {
    const response = await fetch(`${BASE_URL}/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req)
    });

    if (!response.ok) {
      return {
        error: true,
        status: response.status,
        message: await response.text()
      };
    }

    return response.json();
  } catch (error) {
    return { error: true, message: String(error) };
  }
}

// Utility function to make a DELETE request
async function makeDeleteRequest(tableName: string, key: string): Promise<any> {
  try {
    const response = await fetch(
      `${BASE_URL}/delete?tableName=${tableName}&key=${key}`,
      {
        method: 'DELETE'
      }
    );

    if (!response.ok) {
      return {
        error: true,
        status: response.status,
        message: await response.text()
      };
    }

    return response.json();
  } catch (error) {
    return { error: true, message: String(error) };
  }
}

// Generate random user data
function generateRandomUser(valid = true): any {
  if (!valid && Math.random() > 0.5) {
    // Sometimes return completely invalid data
    return Math.random() > 0.5 ? 'invalid-data' : null;
  }

  const firstName = ['John', 'Jane', 'Bob', 'Alice', 'Charlie'][
    Math.floor(Math.random() * 5)
  ];
  const lastName = ['Smith', 'Doe', 'Johnson', 'Brown', 'Lee'][
    Math.floor(Math.random() * 5)
  ];

  return {
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
    age: Math.floor(Math.random() * 50) + 18,
    active: Math.random() > 0.2 // 80% active users
  };
}

// Smoke testing - Verify basic functionality
async function runSmokeTests(): Promise<TestResult> {
  console.log('Running smoke tests...');
  const result: TestResult = { success: 0, failure: 0, errors: [] };
  const tableName = 'users';
  const userId = `user-${generateRandomId(6)}`;
  const userData = {
    name: 'Test User',
    email: 'test@example.com',
    active: true
  };

  try {
    // Test WRITE
    console.log(`Writing test user: ${userId}`);
    const writeResult = await makeWriteRequest({
      tableName,
      key: userId,
      value: userData
    });

    if (writeResult.error) {
      console.error('WRITE failed:', writeResult);
      result.failure++;
      result.errors?.push({ operation: 'WRITE', details: writeResult });
    } else {
      console.log('WRITE successful');
      result.success++;
    }

    // Test GET
    console.log(`Getting test user: ${userId}`);
    const getResult = await makeGetRequest({
      tableName,
      key: userId
    });

    if (getResult.error) {
      console.error('GET failed:', getResult);
      result.failure++;
      result.errors?.push({ operation: 'GET', details: getResult });
    } else {
      console.log('GET successful:', getResult);
      result.success++;
    }

    // Test DELETE
    console.log(`Deleting test user: ${userId}`);
    const deleteResult = await makeDeleteRequest(tableName, userId);

    if (deleteResult.error) {
      console.error('DELETE failed:', deleteResult);
      result.failure++;
      result.errors?.push({ operation: 'DELETE', details: deleteResult });
    } else {
      console.log('DELETE successful');
      result.success++;
    }

    // Verify DELETE worked by trying to GET again
    console.log(`Verifying deletion: ${userId}`);
    const verifyResult = await makeGetRequest({
      tableName,
      key: userId
    });

    if (verifyResult.error || !verifyResult.value) {
      console.log('Verification successful - User was deleted');
      result.success++;
    } else {
      console.error('Verification failed - User still exists');
      result.failure++;
      result.errors?.push({
        operation: 'VERIFY_DELETE',
        details: verifyResult
      });
    }
  } catch (error) {
    console.error('Unexpected error in smoke tests:', error);
    result.failure++;
    result.errors?.push({ operation: 'SMOKE_TEST', details: String(error) });
  }

  console.log(
    `Smoke tests completed. Success: ${result.success}, Failure: ${result.failure}`
  );
  return result;
}

// Mild load test with randomized inputs
async function runMildLoadTest(iterations = 20): Promise<TestResult> {
  console.log(`Running mild load test with ${iterations} iterations...`);
  const result: TestResult = { success: 0, failure: 0, errors: [] };
  const startTime = Date.now();
  const tableName = 'users';
  const testUsers: string[] = [];

  try {
    // Create multiple users with varying data
    for (let i = 0; i < iterations; i++) {
      const isValid = Math.random() > 0.2; // 80% valid requests
      const userId = isValid
        ? `load-user-${generateRandomId(6)}`
        : Math.random() > 0.5
          ? ''
          : null;
      const userData = generateRandomUser(isValid);

      if (isValid && typeof userId === 'string') {
        testUsers.push(userId);
      }

      console.log(
        `Creating ${isValid ? 'valid' : 'invalid'} user #${i}: ${JSON.stringify(userId)}`
      );

      const writeResult = await makeWriteRequest({
        tableName,
        key: userId as string,
        value: userData,
        expectedVersion:
          Math.random() > 0.8 ? Math.floor(Math.random() * 5) : undefined, // Sometimes add version
        flushImmediately: Math.random() > 0.5 // Randomly choose to flush
      });

      if (!writeResult.error) {
        result.success++;
      } else {
        // For invalid data, we expect errors
        if (!isValid) {
          console.log('Expected error for invalid data:', writeResult.message);
          result.success++; // Count as success if we expected an error
        } else {
          console.error('Unexpected error:', writeResult);
          result.failure++;
          result.errors?.push({
            operation: 'WRITE_LOAD',
            iteration: i,
            details: writeResult
          });
        }
      }
    }

    // Retrieve users with different options
    for (const userId of testUsers) {
      console.log(`Getting user: ${userId}`);

      const getOptions =
        Math.random() > 0.5
          ? {
              filter: { active: Math.random() > 0.5 },
              limit: Math.floor(Math.random() * 10) + 1,
              offset: Math.floor(Math.random() * 5)
            }
          : undefined;

      const getResult = await makeGetRequest({
        tableName,
        key: userId,
        options: getOptions
      });

      if (!getResult.error) {
        result.success++;
      } else {
        console.error('GET error:', getResult);
        result.failure++;
        result.errors?.push({
          operation: 'GET_LOAD',
          userId,
          details: getResult
        });
      }
    }

    // Clean up created users
    for (const userId of testUsers) {
      console.log(`Deleting user: ${userId}`);

      const deleteResult = await makeDeleteRequest(tableName, userId);

      if (!deleteResult.error) {
        result.success++;
      } else {
        console.error('DELETE error:', deleteResult);
        result.failure++;
        result.errors?.push({
          operation: 'DELETE_LOAD',
          userId,
          details: deleteResult
        });
      }
    }
  } catch (error) {
    console.error('Unexpected error in mild load tests:', error);
    result.failure++;
    result.errors?.push({
      operation: 'MILD_LOAD_TEST',
      details: String(error)
    });
  }

  const totalTime = Date.now() - startTime;
  result.totalTime = totalTime;

  console.log(
    `Mild load tests completed in ${totalTime}ms. Success: ${result.success}, Failure: ${result.failure}`
  );
  return result;
}

// Higher load test with bursts of traffic
async function runHighLoadTest(burstSize = 50): Promise<TestResult> {
  console.log(`Running high load test with burst size of ${burstSize}...`);
  const result: TestResult = { success: 0, failure: 0, errors: [] };
  const startTime = Date.now();
  const tableName = 'users';
  const testUsers: string[] = [];

  try {
    // Create a burst of write requests
    console.log('Sending burst of WRITE requests...');
    const writePromises = [];

    for (let i = 0; i < burstSize; i++) {
      const userId = `burst-user-${generateRandomId(6)}`;
      testUsers.push(userId);

      const writePromise = makeWriteRequest({
        tableName,
        key: userId,
        value: generateRandomUser(),
        concurrencyLimit: Math.floor(Math.random() * 10) + 1
      }).then((result) => {
        if (!result.error) return { success: true, id: userId };
        console.error(`Error writing user ${userId}:`, result);
        return { success: false, error: result, id: userId };
      });

      writePromises.push(writePromise);
    }

    const writeResults = await Promise.all(writePromises);

    for (const res of writeResults) {
      if (res.success) {
        result.success++;
      } else {
        result.failure++;
        result.errors?.push({ operation: 'WRITE_BURST', details: res.error });
      }
    }

    console.log(
      `Write burst completed. Success: ${result.success}, Failure: ${result.failure}`
    );

    // Create a burst of get requests
    console.log('Sending burst of GET requests...');
    const getPromises = [];

    for (const userId of testUsers) {
      const getPromise = makeGetRequest({
        tableName,
        key: userId
      }).then((result) => {
        if (!result.error) return { success: true, id: userId };
        console.error(`Error getting user ${userId}:`, result);
        return { success: false, error: result, id: userId };
      });

      getPromises.push(getPromise);
    }

    const getResults = await Promise.all(getPromises);

    for (const res of getResults) {
      if (res.success) {
        result.success++;
      } else {
        result.failure++;
        result.errors?.push({ operation: 'GET_BURST', details: res.error });
      }
    }

    console.log(
      `Get burst completed. Success: ${result.success}, Failure: ${result.failure}`
    );

    // Clean up with a burst of delete requests
    console.log('Sending burst of DELETE requests...');
    const deletePromises = [];

    for (const userId of testUsers) {
      const deletePromise = makeDeleteRequest(tableName, userId).then(
        (result) => {
          if (!result.error) return { success: true, id: userId };
          console.error(`Error deleting user ${userId}:`, result);
          return { success: false, error: result, id: userId };
        }
      );

      deletePromises.push(deletePromise);
    }

    const deleteResults = await Promise.all(deletePromises);

    for (const res of deleteResults) {
      if (res.success) {
        result.success++;
      } else {
        result.failure++;
        result.errors?.push({ operation: 'DELETE_BURST', details: res.error });
      }
    }

    console.log(
      `Delete burst completed. Success: ${result.success}, Failure: ${result.failure}`
    );
  } catch (error) {
    console.error('Unexpected error in high load tests:', error);
    result.failure++;
    result.errors?.push({
      operation: 'HIGH_LOAD_TEST',
      details: String(error)
    });
  }

  const totalTime = Date.now() - startTime;
  result.totalTime = totalTime;

  console.log(
    `High load tests completed in ${totalTime}ms. Success: ${result.success}, Failure: ${result.failure}`
  );
  return result;
}

// Main function to run all tests
async function runAllTests() {
  console.log('Starting integration tests for MikroDB...');

  // Run smoke tests first
  const smokeResult = await runSmokeTests();

  // Only proceed if smoke tests pass
  if (smokeResult.failure === 0) {
    console.log('\nSmoke tests passed! Proceeding to mild load test...\n');
    const mildLoadResult = await runMildLoadTest(20);

    console.log(
      '\nMild load test completed. Proceeding to high load test...\n'
    );
    const highLoadResult = await runHighLoadTest(50);

    // Print summary
    console.log('\n====== TEST SUMMARY ======');
    console.log(
      `Smoke Tests: ${smokeResult.success} successes, ${smokeResult.failure} failures`
    );
    console.log(
      `Mild Load Tests: ${mildLoadResult.success} successes, ${mildLoadResult.failure} failures, ${mildLoadResult.totalTime}ms total time`
    );
    console.log(
      `High Load Tests: ${highLoadResult.success} successes, ${highLoadResult.failure} failures, ${highLoadResult.totalTime}ms total time`
    );
    console.log('==========================\n');
  } else {
    console.error(
      '\nSmoke tests failed! Fixing basic functionality issues before proceeding with load tests.\n'
    );
    console.log('Errors:', smokeResult.errors);
  }
}

// Execute tests
runAllTests().catch((error) => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
