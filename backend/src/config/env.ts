export type NodeEnvironment = "development" | "test" | "production";

export interface EnvConfig {
  nodeEnv: NodeEnvironment;
  isProduction: boolean;
  port: number;
  mongoUrl: string;
  frontendUrl: string;
  dashboardUrl: string;
  allowedOrigins: readonly string[];
}

export class EnvConfigValidationError extends Error {
  public readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    const formatted = [
      "Environment configuration validation failed:",
      ...errors.map((err) => `  - ${err}`),
    ].join("\n");
    super(formatted);
    this.name = "EnvConfigValidationError";
    this.errors = Object.freeze([...errors]);
    Object.setPrototypeOf(this, EnvConfigValidationError.prototype);
  }
}

const VALID_NODE_ENVIRONMENTS: ReadonlySet<string> = new Set<NodeEnvironment>([
  "development",
  "test",
  "production",
]);

const DEFAULT_PORT = "3002";

function validateNodeEnv(
  rawNodeEnv: string | undefined
): { valid: true; value: NodeEnvironment } | { valid: false; error: string } {
  if (!rawNodeEnv || !rawNodeEnv.trim()) {
    return {
      valid: false,
      error:
        "NODE_ENV is required and must be one of: 'development', 'test', 'production'.",
    };
  }

  const trimmed = rawNodeEnv.trim();
  if (!VALID_NODE_ENVIRONMENTS.has(trimmed)) {
    return {
      valid: false,
      error:
        "NODE_ENV is invalid. Allowed values are: 'development', 'test', 'production'.",
    };
  }

  return { valid: true, value: trimmed as NodeEnvironment };
}

function validatePort(
  rawPort: string | undefined
): { valid: true; value: number } | { valid: false; error: string } {
  const effectivePort =
    rawPort === undefined || rawPort.trim() === "" ? DEFAULT_PORT : rawPort.trim();

  if (!/^\d+$/.test(effectivePort)) {
    return {
      valid: false,
      error: "PORT must be an integer between 1 and 65535.",
    };
  }

  const parsedPort = Number(effectivePort);
  if (!Number.isSafeInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return {
      valid: false,
      error: "PORT must be an integer between 1 and 65535.",
    };
  }

  return { valid: true, value: parsedPort };
}

function isValidPercentEncoded(value: string): boolean {
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) {
    return false;
  }
  try {
    decodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function validateMongoUrl(
  rawMongoUrl: string | undefined
): { valid: true; value: string } | { valid: false; error: string } {
  if (!rawMongoUrl || !rawMongoUrl.trim()) {
    return {
      valid: false,
      error: "MONGO_URL is required and must not be empty.",
    };
  }

  const trimmed = rawMongoUrl.trim();

  if (/\s/.test(trimmed)) {
    return {
      valid: false,
      error: "MONGO_URL must not contain whitespace characters.",
    };
  }

  const isSrv = trimmed.startsWith("mongodb+srv://");
  const isStandard = trimmed.startsWith("mongodb://");

  if (!isSrv && !isStandard) {
    return {
      valid: false,
      error: "MONGO_URL must use the 'mongodb://' or 'mongodb+srv://' protocol.",
    };
  }

  const schemeLength = isSrv ? "mongodb+srv://".length : "mongodb://".length;
  const remainder = trimmed.slice(schemeLength);

  if (!remainder) {
    return {
      valid: false,
      error: "MONGO_URL must include a valid host.",
    };
  }

  if (remainder.includes("#")) {
    return {
      valid: false,
      error: "MONGO_URL must not contain URL fragments.",
    };
  }

  const slashIdx = remainder.indexOf("/");
  const queryIdx = remainder.indexOf("?");
  let authorityEndIdx = remainder.length;
  if (slashIdx !== -1 && queryIdx !== -1) {
    authorityEndIdx = Math.min(slashIdx, queryIdx);
  } else if (slashIdx !== -1) {
    authorityEndIdx = slashIdx;
  } else if (queryIdx !== -1) {
    authorityEndIdx = queryIdx;
  }

  const authority = remainder.slice(0, authorityEndIdx);
  const pathAndQuery = remainder.slice(authorityEndIdx);

  if (!authority) {
    return {
      valid: false,
      error: "MONGO_URL must include a valid host.",
    };
  }

  let hostListStr = authority;
  if (authority.includes("@")) {
    const atParts = authority.split("@");
    if (atParts.length !== 2) {
      return {
        valid: false,
        error: "MONGO_URL contains malformed authentication credentials.",
      };
    }

    const [userInfo, hostsPart] = atParts;
    if (!userInfo || !hostsPart) {
      return {
        valid: false,
        error: "MONGO_URL contains incomplete authentication credentials or host.",
      };
    }

    if (/[\[\]]/.test(userInfo)) {
      return {
        valid: false,
        error: "MONGO_URL contains invalid characters in authentication credentials.",
      };
    }

    const credentialParts = userInfo.split(":");
    if (credentialParts.length > 2) {
      return {
        valid: false,
        error:
          "MONGO_URL authentication credentials must not contain more than one unencoded colon.",
      };
    }

    const [rawUsername, rawPassword] = credentialParts;
    if (!rawUsername) {
      return {
        valid: false,
        error: "MONGO_URL authentication credentials must include a username.",
      };
    }

    if (!isValidPercentEncoded(rawUsername)) {
      return {
        valid: false,
        error:
          "MONGO_URL authentication username contains invalid percent-encoding.",
      };
    }

    if (rawPassword !== undefined && !isValidPercentEncoded(rawPassword)) {
      return {
        valid: false,
        error:
          "MONGO_URL authentication password contains invalid percent-encoding.",
      };
    }

    hostListStr = hostsPart;
  }

  const hosts = hostListStr.split(",");
  if (isSrv && hosts.length > 1) {
    return {
      valid: false,
      error: "MONGO_URL with 'mongodb+srv://' must specify a single host.",
    };
  }

  for (const hostEntry of hosts) {
    if (!hostEntry) {
      return {
        valid: false,
        error: "MONGO_URL contains an empty host entry.",
      };
    }

    let explicitPort: string | undefined;

    if (hostEntry.startsWith("[")) {
      const closeBracketIdx = hostEntry.indexOf("]");
      if (closeBracketIdx <= 1) {
        return {
          valid: false,
          error: "MONGO_URL contains an invalid IPv6 host specification.",
        };
      }
      const afterBracket = hostEntry.slice(closeBracketIdx + 1);
      if (afterBracket !== "") {
        if (!afterBracket.startsWith(":")) {
          return {
            valid: false,
            error: "MONGO_URL contains an invalid IPv6 host specification.",
          };
        }
        explicitPort = afterBracket.slice(1);
      }
    } else {
      if (hostEntry.includes("[") || hostEntry.includes("]")) {
        return {
          valid: false,
          error: "MONGO_URL contains an invalid host specification.",
        };
      }
      const hostParts = hostEntry.split(":");
      if (hostParts.length > 2) {
        return {
          valid: false,
          error: "MONGO_URL contains an invalid host or unbracketed IPv6 address.",
        };
      }
      if (!hostParts[0]) {
        return {
          valid: false,
          error: "MONGO_URL must include a valid host.",
        };
      }
      if (hostParts.length === 2) {
        explicitPort = hostParts[1];
      }
    }

    if (explicitPort !== undefined) {
      if (isSrv) {
        return {
          valid: false,
          error: "MONGO_URL with 'mongodb+srv://' must not specify a port number.",
        };
      }
      if (explicitPort === "") {
        return {
          valid: false,
          error: "MONGO_URL contains an empty port specification.",
        };
      }
      if (!/^\d+$/.test(explicitPort)) {
        return {
          valid: false,
          error: "MONGO_URL port must be an integer between 1 and 65535.",
        };
      }
      const numericPort = Number(explicitPort);
      if (
        !Number.isSafeInteger(numericPort) ||
        numericPort < 1 ||
        numericPort > 65535
      ) {
        return {
          valid: false,
          error: "MONGO_URL port must be an integer between 1 and 65535.",
        };
      }
    }

    try {
      const parsedHost = new URL(`http://${hostEntry}`);
      if (
        !parsedHost.hostname ||
        parsedHost.username !== "" ||
        parsedHost.password !== "" ||
        parsedHost.pathname !== "/" ||
        parsedHost.search !== "" ||
        parsedHost.hash !== ""
      ) {
        return {
          valid: false,
          error: "MONGO_URL contains an invalid host specification.",
        };
      }
    } catch {
      return {
        valid: false,
        error: "MONGO_URL contains an invalid host or port.",
      };
    }
  }

  if (pathAndQuery) {
    let rawDbName = "";
    let rawQuery: string | undefined;

    if (pathAndQuery.startsWith("/")) {
      const withoutLeadingSlash = pathAndQuery.slice(1);
      const qIdx = withoutLeadingSlash.indexOf("?");
      if (qIdx === -1) {
        rawDbName = withoutLeadingSlash;
      } else {
        rawDbName = withoutLeadingSlash.slice(0, qIdx);
        rawQuery = withoutLeadingSlash.slice(qIdx + 1);
      }
    } else if (pathAndQuery.startsWith("?")) {
      rawQuery = pathAndQuery.slice(1);
    }

    if (rawDbName !== "") {
      if (rawDbName.includes("/")) {
        return {
          valid: false,
          error:
            "MONGO_URL database name must not contain multiple path segments.",
        };
      }

      if (!isValidPercentEncoded(rawDbName)) {
        return {
          valid: false,
          error: "MONGO_URL database name contains invalid percent-encoding.",
        };
      }

      const decodedDbName = decodeURIComponent(rawDbName);
      if (/[\/\\" $\0]/.test(decodedDbName)) {
        return {
          valid: false,
          error: "MONGO_URL database name contains prohibited characters.",
        };
      }
    }

    if (rawQuery !== undefined && rawQuery !== "") {
      if (!isValidPercentEncoded(rawQuery)) {
        return {
          valid: false,
          error: "MONGO_URL query parameters contain invalid percent-encoding.",
        };
      }

      const pairs = rawQuery.split(/[&;]/);
      for (const pair of pairs) {
        if (!pair) {
          return {
            valid: false,
            error: "MONGO_URL contains an empty query parameter.",
          };
        }
        const eqIdx = pair.indexOf("=");
        const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
        const rawVal = eqIdx === -1 ? "" : pair.slice(eqIdx + 1);

        if (
          !rawKey ||
          !isValidPercentEncoded(rawKey) ||
          !isValidPercentEncoded(rawVal)
        ) {
          return {
            valid: false,
            error: "MONGO_URL query parameters are malformed.",
          };
        }
      }
    }
  }

  return { valid: true, value: trimmed };
}

function validateAndNormalizeOrigin(
  rawUrl: string | undefined,
  varName: "FRONTEND_URL" | "DASHBOARD_URL",
  requireHttps: boolean
): { valid: true; origin: string } | { valid: false; error: string } {
  if (!rawUrl || !rawUrl.trim()) {
    return {
      valid: false,
      error: `${varName} is required and must not be empty.`,
    };
  }

  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: `${varName} must be a valid absolute HTTP or HTTPS URL.`,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `${varName} must use the HTTP or HTTPS protocol.`,
    };
  }

  if (requireHttps && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `${varName} must use the HTTPS protocol in production.`,
    };
  }

  if (!parsed.hostname) {
    return {
      valid: false,
      error: `${varName} must include a valid hostname.`,
    };
  }

  const lowerHost = parsed.hostname.toLowerCase();
  if (
    requireHttps &&
    (lowerHost === "localhost" || lowerHost === "127.0.0.1" || lowerHost === "[::1]")
  ) {
    return {
      valid: false,
      error: `${varName} must not use a localhost or loopback address in production.`,
    };
  }

  if (parsed.username !== "" || parsed.password !== "" || trimmed.includes("@")) {
    return {
      valid: false,
      error: `${varName} must not contain embedded credentials.`,
    };
  }

  if (
    parsed.search !== "" ||
    parsed.hash !== "" ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return {
      valid: false,
      error: `${varName} must not contain query strings or URL fragments.`,
    };
  }

  const suffixAfterOrigin = trimmed.slice(parsed.origin.length);
  if (
    parsed.pathname !== "/" ||
    (suffixAfterOrigin !== "" && suffixAfterOrigin !== "/")
  ) {
    return {
      valid: false,
      error: `${varName} must not contain a URL path.`,
    };
  }

  return { valid: true, origin: parsed.origin };
}

export function loadEnvConfig(
  env: NodeJS.ProcessEnv = process.env
): EnvConfig {
  const errors: string[] = [];

  const nodeEnvResult = validateNodeEnv(env.NODE_ENV);
  if (!nodeEnvResult.valid) {
    errors.push(nodeEnvResult.error);
  }

  const isProduction =
    nodeEnvResult.valid && nodeEnvResult.value === "production";

  const portResult = validatePort(env.PORT);
  if (!portResult.valid) {
    errors.push(portResult.error);
  }

  const mongoResult = validateMongoUrl(env.MONGO_URL);
  if (!mongoResult.valid) {
    errors.push(mongoResult.error);
  }

  const frontendResult = validateAndNormalizeOrigin(
    env.FRONTEND_URL,
    "FRONTEND_URL",
    isProduction
  );
  if (!frontendResult.valid) {
    errors.push(frontendResult.error);
  }

  const dashboardResult = validateAndNormalizeOrigin(
    env.DASHBOARD_URL,
    "DASHBOARD_URL",
    isProduction
  );
  if (!dashboardResult.valid) {
    errors.push(dashboardResult.error);
  }

  if (
    errors.length > 0 ||
    !nodeEnvResult.valid ||
    !portResult.valid ||
    !mongoResult.valid ||
    !frontendResult.valid ||
    !dashboardResult.valid
  ) {
    throw new EnvConfigValidationError(errors);
  }

  const allowedOrigins = Object.freeze(
    Array.from(new Set([frontendResult.origin, dashboardResult.origin]))
  );

  return Object.freeze({
    nodeEnv: nodeEnvResult.value,
    isProduction,
    port: portResult.value,
    mongoUrl: mongoResult.value,
    frontendUrl: frontendResult.origin,
    dashboardUrl: dashboardResult.origin,
    allowedOrigins,
  });
}

