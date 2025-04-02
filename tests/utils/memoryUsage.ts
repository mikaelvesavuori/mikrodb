/**
 * @description Returns memory usage in MB.
 */
export function memoryUsage() {
  const usage = process.memoryUsage();
  const division = 1024 * 1024;

  return {
    heapTotal: usage.heapTotal / division,
    heapUsed: usage.heapUsed / division,
    residentSetSize: usage.rss / division
  };
}
