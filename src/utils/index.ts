/**
 * @description Get the current time as a Unix timestamp.
 */
export const time = () => Date.now();

/**
 * @description Get a JSON value safely, if it exists.
 */
export const getJsonValueFromEntry = (json: string[], operation: string) => {
  if (operation === 'D') return null;

  if (json.length === 0 || json.join(' ') === 'null') return null;

  return getJsonValue(json);
};

/**
 * @description Get a JSON value safely, if it exists.
 */
export const getJsonValue = (value: any) => {
  try {
    return JSON.parse(value.join(' '));
  } catch (_error) {
    return undefined;
  }
};

/**
 * @description Checks if a value is truthy (string or boolean).
 */
export function getTruthyValue(value: string | boolean | undefined) {
  if (value === 'true' || value === true) return true;
  return false;
}

/**
 * @description Create an options object if any options were provided.
 */
export function createGetOptions(options: Record<string, any>) {
  const getValue = (value: unknown, format: 'json' | 'number') => {
    if (!value) return undefined;
    if (format === 'json') return getJsonValue(value) || value;
    if (format === 'number') return Number.parseInt(value as string, 10);
    return undefined;
  };

  const filter = getValue(options?.filter, 'json');
  const sort = getValue(options?.sort, 'json');
  const limit = getValue(options?.limit, 'number');
  const offset = getValue(options?.offset, 'number');

  if (!filter && !sort && !limit && !offset) return undefined;

  return {
    filter,
    sort,
    limit,
    offset
  };
}
