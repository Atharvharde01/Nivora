export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details?: unknown,
    isOperational = true
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(code = "NOT_FOUND", message = "Resource not found.") {
    super(code, message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(code = "FORBIDDEN", message = "Access forbidden.") {
    super(code, message, 403);
  }
}

export class UnauthorizedError extends AppError {
  constructor(code = "UNAUTHORIZED", message = "Authentication required.") {
    super(code, message, 401);
  }
}

export class ConflictError extends AppError {
  constructor(code = "CONFLICT", message = "Resource conflict.") {
    super(code, message, 409);
  }
}

export class BadRequestError extends AppError {
  constructor(code = "BAD_REQUEST", message = "Bad request.", details?: unknown) {
    super(code, message, 400, details);
  }
}
