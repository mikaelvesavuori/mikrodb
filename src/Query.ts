import type { FilterCondition, FilterQuery } from './interfaces/index.js';

/**
 * @description Handles all non-key/value queries.
 */
export class Query {
  /**
   * @description Query a value from a table with filtering criteria.
   */
  public async query(
    table: Map<any, any>,
    filter?: ((record: any) => boolean) | FilterQuery,
    limit = 50
  ) {
    const records = new Map();

    for (const [k, v] of table.entries()) {
      if (
        !filter ||
        (typeof filter === 'function' ? filter(v.value) : this.evaluateFilter(v.value, filter))
      ) {
        records.set(k, v.value);

        if (limit && records.size >= limit) break;
      }
    }

    return Array.from(records.values());
  }

  /**
   * @description Evaluates a single filter condition against a value.
   */
  private evaluateCondition(value: any, condition: FilterCondition | any): boolean {
    if (!condition || typeof condition !== 'object' || !condition.operator)
      return value === condition;

    const { operator, value: targetValue } = condition;

    switch (operator) {
      case 'eq':
        return value === targetValue;
      case 'neq':
        return value !== targetValue;
      case 'gt':
        return value > targetValue;
      case 'gte':
        return value >= targetValue;
      case 'lt':
        return value < targetValue;
      case 'lte':
        return value <= targetValue;
      case 'in':
        return Array.isArray(targetValue) && targetValue.includes(value);
      case 'nin':
        return Array.isArray(targetValue) && !targetValue.includes(value);
      case 'like':
        return (
          typeof value === 'string' &&
          typeof targetValue === 'string' &&
          value.toLowerCase().includes(targetValue.toLowerCase())
        );
      case 'between':
        return (
          Array.isArray(targetValue) &&
          targetValue.length === 2 &&
          value >= targetValue[0] &&
          value <= targetValue[1]
        );
      case 'regex':
        try {
          const regex = new RegExp(targetValue);
          return typeof value === 'string' && regex.test(value);
        } catch (e) {
          console.error('Invalid regex pattern:', e);
          return false;
        }
      case 'contains':
        return Array.isArray(value) && value.includes(targetValue);
      case 'containsAll':
        return (
          Array.isArray(value) &&
          Array.isArray(targetValue) &&
          targetValue.every((item) => value.includes(item))
        );
      case 'containsAny':
        return (
          Array.isArray(value) &&
          Array.isArray(targetValue) &&
          targetValue.some((item) => value.includes(item))
        );
      case 'size':
        return Array.isArray(value) && value.length === targetValue;
      default:
        return false;
    }
  }

  /**
   * @description Evaluates a complex filter query against a record.
   */
  private evaluateFilter(record: any, filter: FilterQuery): boolean {
    // Early return if record is null or undefined
    if (record === null || record === undefined) {
      return false;
    }

    // Handle OR conditions
    if ('$or' in filter)
      return (filter.$or as FilterQuery[]).some((subFilter) =>
        this.evaluateFilter(record, subFilter)
      );

    // Evaluate all conditions (implicit AND)
    for (const [field, condition] of Object.entries(filter)) {
      // Skip special operators
      if (field.startsWith('$')) continue;

      // Handle nested objects
      if (field.includes('.')) {
        const parts = field.split('.');
        let value = record;
        for (const part of parts) {
          value = value?.[part];
          if (value === undefined || value === null) return false;
        }
        if (!this.evaluateCondition(value, condition)) return false;
      }
      // Handle nested filter queries
      else if (condition && typeof condition === 'object' && !('operator' in condition)) {
        const nestedValue = record[field];
        if (nestedValue === undefined || nestedValue === null) return false;

        if (!this.evaluateFilter(nestedValue, condition)) return false;
      }
      // Handle regular conditions
      else {
        const value = record[field];
        if (!this.evaluateCondition(value, condition)) return false;
      }
    }

    return true;
  }
}
