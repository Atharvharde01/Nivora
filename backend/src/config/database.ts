import mongoose, { ConnectOptions } from "mongoose";

/**
 * Fixed safe error categories for MongoDB connection failures.
 * Never includes raw driver messages, hostnames, stack traces, or URI fragments.
 */
export type DatabaseErrorCategory =
  | "AUTHENTICATION"
  | "SERVER_SELECTION"
  | "NETWORK"
  | "TIMEOUT"
  | "UNKNOWN";

/**
 * Strongly typed Mongoose connection options used by NIVORA.
 *
 * Scope of `maxPoolSize`:
 * `maxPoolSize` limits the maximum number of concurrent sockets in the MongoDB
 * connection pool per Node.js process (per `mongoose.connect()` client instance
 * and monitored server in a topology), NOT across the entire multi-instance
 * deployment. If N backend instances run concurrently, total connections can
 * reach up to N * maxPoolSize (plus monitoring sockets).
 *
 * Production index & collection policy:
 * When `isProduction` is true, `autoIndex` and `autoCreate` are disabled so
 * production startup never triggers background index builds or implicit collection
 * creation. Do NOT compensate by calling `Model.syncIndexes()` automatically at
 * startup; production indexes must be provisioned via a controlled index
 * provisioning step prior to or during deployment.
 */
export interface HardenedMongoConnectionOptions extends ConnectOptions {
  readonly serverSelectionTimeoutMS: number;
  readonly connectTimeoutMS: number;
  readonly maxPoolSize: number;
  readonly minPoolSize: number;
  readonly maxIdleTimeMS: number;
  readonly waitQueueTimeoutMS: number;
  readonly autoIndex: boolean;
  readonly autoCreate: boolean;
}

/**
 * Sanitized error thrown when the initial MongoDB connection fails.
 * Intentionally omits `cause` and never copies raw driver messages, stack traces,
 * hostnames, or connection strings.
 */
export class DatabaseConnectionError extends Error {
  public readonly category: DatabaseErrorCategory;

  constructor(category: DatabaseErrorCategory) {
    super(`MongoDB connection failed. Category: ${category}.`);
    this.name = "DatabaseConnectionError";
    this.category = category;
    Object.setPrototypeOf(this, DatabaseConnectionError.prototype);
  }
}

/**
 * Classifies an arbitrary unknown driver/connection error into a fixed safe
 * `DatabaseErrorCategory` without copying or exposing any part of the underlying error.
 */
export function classifyDatabaseError(err: unknown): DatabaseErrorCategory {
  if (typeof err !== "object" || err === null) {
    return "UNKNOWN";
  }

  const record = err as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const code = record.code;
  const codeName = typeof record.codeName === "string" ? record.codeName : "";
  const message = typeof record.message === "string" ? record.message : "";

  // 1. Authentication failures
  if (
    code === 18 ||
    code === 8000 ||
    code === 334 ||
    codeName === "AuthenticationFailed" ||
    codeName === "SASLAuthenticationFailed" ||
    name === "MongoAuthError" ||
    name === "MongoSecurityError" ||
    /\b(auth(entication|orization)?\s+failed|bad\s+auth|invalid\s+credentials|sasl)\b/i.test(
      message
    )
  ) {
    return "AUTHENTICATION";
  }

  // 2. Server selection failures
  if (
    name === "MongoServerSelectionError" ||
    name === "MongooseServerSelectionError" ||
    /\bserver\s+selection\b/i.test(message)
  ) {
    return "SERVER_SELECTION";
  }

  // 3. Timeout failures
  if (
    name === "MongoNetworkTimeoutError" ||
    name === "MongoTimeoutError" ||
    name === "MongoWaitQueueTimeoutError" ||
    name === "TimeoutError" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === 50 ||
    code === 89 ||
    codeName === "NetworkTimeout" ||
    codeName === "MaxTimeMSExpired" ||
    /\b(timed?\s*out|timeout|etimedout)\b/i.test(message)
  ) {
    return "TIMEOUT";
  }

  // 4. Network & DNS failures
  if (
    name === "MongoNetworkError" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN" ||
    code === 6 ||
    code === 7 ||
    codeName === "HostUnreachable" ||
    codeName === "HostNotFound" ||
    /\b(econnrefused|econnreset|enotfound|ehostunreach|enetunreach|eai_again|network\s+error|getaddrinfo|connect\s+failed|socket\s+hang\s+up)\b/i.test(
      message
    )
  ) {
    return "NETWORK";
  }

  return "UNKNOWN";
}

/**
 * Creates a sanitized `DatabaseConnectionError` from an unknown error.
 */
export function createDatabaseConnectionError(
  err: unknown
): DatabaseConnectionError {
  return new DatabaseConnectionError(classifyDatabaseError(err));
}

/**
 * Returns the hardened Mongoose connection options for the given environment mode.
 * Does not override URI-level writeConcern, retryWrites, or readPreference.
 */
export function getMongoConnectionOptions(
  isProduction: boolean
): Readonly<HardenedMongoConnectionOptions> {
  return Object.freeze({
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    maxPoolSize: 10,
    minPoolSize: 0,
    maxIdleTimeMS: 30_000,
    waitQueueTimeoutMS: 10_000,
    autoIndex: !isProduction,
    autoCreate: !isProduction,
  });
}

/**
 * Establishes the initial Mongoose connection using hardened connection options.
 * Throws a sanitized `DatabaseConnectionError` if the connection fails.
 */
export async function connectDatabase(
  mongoUrl: string,
  isProduction: boolean,
  connectFn: (
    uri: string,
    options?: ConnectOptions
  ) => Promise<typeof mongoose> = mongoose.connect
): Promise<typeof mongoose> {
  const options = getMongoConnectionOptions(isProduction);
  try {
    return await connectFn(mongoUrl, options);
  } catch (err: unknown) {
    throw createDatabaseConnectionError(err);
  }
}

