/**
 * Error class hierarchy following Anthropic's pattern:
 * - Base AppError with status, code, and message
 * - Static factory method maps status codes to typed subclasses
 * - Each subclass locks the HTTP status via generic
 */

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  static generate(status: number, message: string): AppError {
    switch (status) {
      case 400:
        return new BadRequestError(message);
      case 401:
        return new AuthenticationError(message);
      case 403:
        return new PermissionDeniedError(message);
      case 404:
        return new NotFoundError(message);
      case 409:
        return new ConflictError(message);
      case 422:
        return new ValidationError(message);
      case 429:
        return new RateLimitError(message);
      default:
        if (status >= 500) return new InternalServerError(message);
        return new AppError(status, 'unknown_error', message);
    }
  }

  toJSON() {
    return {
      error: {
        type: this.code,
        message: this.message,
      },
    };
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, 'bad_request', message);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string) {
    super(401, 'authentication_error', message);
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message: string) {
    super(403, 'permission_denied', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(422, 'validation_error', message);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string) {
    super(429, 'rate_limit_error', message);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string) {
    super(500, 'internal_error', message);
  }
}

/**
 * Thrown by tool handlers to return structured error content.
 * Follows Anthropic's ToolError pattern.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly content: string = message,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
