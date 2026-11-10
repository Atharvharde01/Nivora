import { Response, Request } from "express";
import { CSRF_COOKIE_NAME } from "./csrf.utils";

export const DEV_REFRESH_COOKIE_NAME = "refresh_token";
export const PROD_REFRESH_COOKIE_NAME = "__Host-refresh_token";

export type SameSiteOption = "lax" | "strict" | "none";

export interface CookieConfig {
  isProduction: boolean;
  sameSite?: SameSiteOption;
}

export function getRefreshCookieName(isProduction: boolean): string {
  return isProduction ? PROD_REFRESH_COOKIE_NAME : DEV_REFRESH_COOKIE_NAME;
}

export function extractRefreshTokenFromRequest(
  req: Request,
  isProduction: boolean
): string | undefined {
  const preferredName = getRefreshCookieName(isProduction);
  if (req.cookies?.[preferredName]) {
    return req.cookies[preferredName];
  }
  if (req.cookies?.[DEV_REFRESH_COOKIE_NAME]) {
    return req.cookies[DEV_REFRESH_COOKIE_NAME];
  }
  if (req.cookies?.[PROD_REFRESH_COOKIE_NAME]) {
    return req.cookies[PROD_REFRESH_COOKIE_NAME];
  }

  // Fallback to manual raw header parsing if cookie-parser middleware was not run
  const rawCookieHeader = req.headers["cookie"];
  if (typeof rawCookieHeader === "string") {
    const pairs = rawCookieHeader.split(";").map((p) => p.trim());
    for (const pair of pairs) {
      if (pair.startsWith(`${preferredName}=`)) {
        return pair.slice(preferredName.length + 1);
      }
      if (pair.startsWith(`${DEV_REFRESH_COOKIE_NAME}=`)) {
        return pair.slice(DEV_REFRESH_COOKIE_NAME.length + 1);
      }
      if (pair.startsWith(`${PROD_REFRESH_COOKIE_NAME}=`)) {
        return pair.slice(PROD_REFRESH_COOKIE_NAME.length + 1);
      }
    }
  }

  return undefined;
}

export function setAuthCookies(
  res: Response,
  rawRefreshToken: string,
  csrfToken: string,
  config: CookieConfig
): void {
  const { isProduction } = config;
  const sameSite = config.sameSite ?? (isProduction ? "lax" : "lax");
  const secure = isProduction || sameSite === "none";
  const refreshCookieName = getRefreshCookieName(isProduction);

  // 30 days maxAge
  const maxAge = 30 * 24 * 60 * 60 * 1000;

  // 1. Opaque Refresh Token Cookie: HttpOnly, Secure, Host-only (no domain), Path=/
  res.cookie(refreshCookieName, rawRefreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge,
  });

  // 2. CSRF Token Cookie: Non-HttpOnly (accessible by JavaScript), Secure, Path=/
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure,
    sameSite,
    path: "/",
    maxAge,
  });
}

export function clearAuthCookies(res: Response, config: CookieConfig): void {
  const { isProduction } = config;
  const sameSite = config.sameSite ?? (isProduction ? "lax" : "lax");
  const secure = isProduction || sameSite === "none";
  const refreshCookieName = getRefreshCookieName(isProduction);

  res.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  });

  if (isProduction) {
    res.clearCookie(DEV_REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite,
      path: "/",
    });
  }

  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure,
    sameSite,
    path: "/",
  });
}
