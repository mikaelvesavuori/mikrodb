/**
 * @description The error is used when a resource could not be found.
 */
export class NotFoundError extends Error {
  constructor(message?: string) {
    super();
    this.name = 'NotFoundError';
    this.message = message || 'Resource not found';
    this.cause = { statusCode: 404 };
  }
}

/**
 * @description The error is used something broke while checkpointing.
 */
export class CheckpointError extends Error {
  constructor(message: string) {
    super();
    this.name = 'CheckpointError';
    this.message = message;
    this.cause = { statusCode: 500 };
  }
}

/**
 * @description The error is used when something was deemed invalid.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super();
    this.name = 'ValidationError';
    this.message = message;
    this.cause = { statusCode: 400 };
  }
}
