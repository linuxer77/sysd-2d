/** Deep copy for plain JSON-safe data. No ambient globals, so it runs identically everywhere. */
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
