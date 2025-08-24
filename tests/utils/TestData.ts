/**
 * @description Handles generation of test data.
 */
export class TestData {
  /**
   * @description Outputs a random string.
   */
  public randomString(length: number) {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    let result = '';

    for (let i = 0; i < length; i++)
      result += chars.charAt(Math.floor(Math.random() * chars.length));

    return result;
  }

  /**
   * @description Create a random date in ISO format.
   */
  private randomDate() {
    const randomTimestamp =
      Date.now() - Math.floor(Math.random() * 10000000000);

    return new Date(randomTimestamp).toISOString();
  }

  /**
   * @description Generate a single value for a given table.
   * Supports `users`, `orders`, `products`, `employees` or
   * `events` as table names, indicating their respective
   * data structures to generate.
   */
  public generateSingleValueForTable(tableName: string) {
    switch (tableName) {
      case 'users':
        return {
          name: `${this.randomString(5)} ${this.randomString(7)}`,
          age: Math.floor(Math.random() * 60) + 18,
          email: `${this.randomString(5)}@${this.randomString(3)}.com`
        };
      case 'orders':
        return {
          product: `${this.randomString(8)}-${this.randomString(4)}`,
          quantity: Math.floor(Math.random() * 10) + 1,
          totalPrice: Math.floor(Math.random() * 1000) + 50,
          status: ['pending', 'completed', 'shipped', 'cancelled'][
            Math.floor(Math.random() * 4)
          ],
          orderDate: this.randomDate()
        };
      case 'products':
        return {
          name: `${this.randomString(8)}-${this.randomString(4)}`,
          price: Math.floor(Math.random() * 500) + 10,
          category: ['electronics', 'clothing', 'books', 'furniture'][
            Math.floor(Math.random() * 4)
          ],
          stock: Math.floor(Math.random() * 100) + 1
        };
      case 'employees':
        return {
          firstName: `${this.randomString(5)}`,
          lastName: `${this.randomString(7)}`,
          position: ['Developer', 'Manager', 'Designer', 'Sales'][
            Math.floor(Math.random() * 4)
          ],
          hireDate: this.randomDate(),
          salary: Math.floor(Math.random() * 80000) + 20000
        };
      case 'events':
        return {
          eventName: `${this.randomString(6)}-${this.randomString(4)}`,
          date: this.randomDate(),
          location: `${this.randomString(8)} City`,
          attendees: Math.floor(Math.random() * 500) + 50
        };
      default:
        return {};
    }
  }

  /**
   * @description Generate all the requested data for a table.
   */
  generateDataForTable(tableName: string, count = 1) {
    const operations: any[] = [];

    for (let i = 0; i < count; i++) {
      const key = `${tableName}-${this.randomString(12)}`;
      const value = this.generateSingleValueForTable(tableName);
      operations.push({
        tableName,
        key,
        value
      });
    }

    return operations;
  }

  /**
   * @description Shuffle data so it's non-contiguous.
   */
  shuffle(array: Record<string, any>[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
  }
}
