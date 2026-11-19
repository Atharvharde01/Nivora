import crypto from "node:crypto";
import { Types } from "mongoose";
import { UserModel } from "../users/user.model";
import {
  isValidDisplayName,
  sanitizeDisplayName,
} from "../users/user.schema";
import { PracticeAccountModel } from "../practice-accounts/account.model";
import { LedgerEntryModel } from "../ledger/ledger.model";
import { SessionModel } from "./session.model";
import { RefreshTokenModel } from "./refresh-token.model";
import { OtpService } from "./otp.service";
import { JwtService } from "./jwt.service";
import { AuthError } from "./auth.errors";
import { executeMongoTransaction } from "../practice-accounts/account.service";
import { IUser } from "../users/user.types";
import { ISession } from "./auth.types";

export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const INITIAL_ACCOUNT_BALANCE_PAISE = 100_000_000; // ₹10,00,000 in integer paise
export const DEFAULT_TERMS_VERSION = "1.0";
export const DEFAULT_PRIVACY_VERSION = "1.0";

export interface SignupConsentInput {
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  acceptSimulationDisclosure: boolean;
  termsVersion?: string;
  privacyVersion?: string;
}

export interface LoginResult {
  isNewUser: boolean;
  user: {
    id: string;
    userId: string;
    email: string;
    emailVerifiedAt?: Date;
    displayName?: string;
    status: string;
    onboardingCompleted: boolean;
    termsAcceptedAt?: Date;
    termsVersion?: string;
    privacyAcceptedAt?: Date;
    privacyVersion?: string;
    simulationDisclosureAcceptedAt?: Date;
  };
  session: {
    id: string;
    status: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  };
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  newRefreshToken: string;
  session: {
    id: string;
    status: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
  };
  user: {
    id: string;
    userId: string;
    email: string;
    emailVerifiedAt?: Date;
    displayName?: string;
    status: string;
    onboardingCompleted: boolean;
  };
}

export interface AuthServiceOptions {
  otpService: OtpService;
  jwtService: JwtService;
}

/**
 * Hashes an opaque raw refresh token with SHA-256 for secure database persistence.
 * Raw refresh tokens must never be persisted in plaintext.
 */
export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generates a cryptographically secure random opaque refresh token string.
 */
export function generateRawRefreshToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export class AuthService {
  private readonly otpService: OtpService;
  private readonly jwtService: JwtService;

  constructor(options: AuthServiceOptions) {
    this.otpService = options.otpService;
    this.jwtService = options.jwtService;
  }

  /**
   * Verifies email OTP and authenticates or registers the user automatically:
   * - Validates OTP cryptographically first (preventing email enumeration on invalid OTP).
   * - Before consuming the OTP, determines whether the email belongs to an existing or new user:
   *   - New user: requires valid displayName and all applicable consents (without burning OTP on failure).
   *   - Existing user: ignores any submitted displayName and preserves stored profile data.
   * - Atomically consumes OTP challenge exactly once.
   * - Provisions user, displayName, consents, one default PracticeAccount, initial funding ledger, and session if new.
   * - Resolves existing user and appends new session if returning.
   * - Persists durable RefreshToken record (generation 1).
   * - Issues 15-minute access JWT and returns opaque refresh token.
   */
  public async verifyOtpAndLogin(params: {
    email: string;
    otp: string;
    ipAddress: string;
    userAgent: string;
    displayName?: string;
    consents?: SignupConsentInput;
    now?: Date;
  }): Promise<LoginResult> {
    const { email, otp, ipAddress, userAgent, displayName, consents } = params;
    const now = params.now ?? new Date();

    const allConsentsAccepted = Boolean(
      consents &&
        consents.acceptTerms === true &&
        consents.acceptPrivacy === true &&
        consents.acceptSimulationDisclosure === true
    );

    let sanitizedNewDisplayName: string | undefined;

    // 1. Validate OTP cryptographically, enforce new-user requirements BEFORE consuming OTP,
    //    then atomically consume OTP challenge (single-use guarantee under concurrency).
    const otpResult = await this.otpService.verifyOtp(email, otp, now, {
      beforeConsume: async (normalizedEmail: string) => {
        const existingCheck = await UserModel.findOne({
          email: normalizedEmail,
        })
          .select("_id status")
          .lean();

        if (!existingCheck) {
          // CASE A: New user — require valid displayName and all required consents before burning OTP
          const trimmedRaw =
            typeof displayName === "string" ? displayName.trim() : "";
          if (!trimmedRaw) {
            throw new AuthError(
              "DISPLAY_NAME_REQUIRED",
              "Full name is required to create a new account.",
              400
            );
          }
          if (!isValidDisplayName(displayName)) {
            throw new AuthError(
              "INVALID_DISPLAY_NAME",
              "Full name must be 2 to 50 characters, contain letters, and avoid special or control characters.",
              400
            );
          }
          if (!allConsentsAccepted) {
            throw new AuthError(
              "CONSENT_REQUIRED",
              "Acceptance of Terms of Service, Privacy Policy, and Simulated Trading Disclosure is required to create an account.",
              400
            );
          }
          sanitizedNewDisplayName = sanitizeDisplayName(displayName as string);
        }
        // CASE B: Existing user — ignore any submitted displayName and allow authentication
      },
    });
    const normalizedEmail = otpResult.email;

    // 2. Generate opaque refresh token and its SHA-256 hash
    const rawRefreshToken = generateRawRefreshToken();
    const currentRefreshTokenHash = hashRefreshToken(rawRefreshToken);

    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
    const absoluteExpiresAt = new Date(
      now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS
    );

    // 3. Resolve user: check if user already exists
    let existingUser = await UserModel.findOne({ email: normalizedEmail });

    let userDoc: IUser & { _id: Types.ObjectId };
    let sessionDoc: ISession & { _id: Types.ObjectId };
    let isNewUser = false;

    const termsVersion = consents?.termsVersion?.trim() || DEFAULT_TERMS_VERSION;
    const privacyVersion =
      consents?.privacyVersion?.trim() || DEFAULT_PRIVACY_VERSION;

    if (!existingUser) {
      // Defensive re-check in case an account was deleted concurrently between beforeConsume and tx
      if (!sanitizedNewDisplayName) {
        if (typeof displayName === "string" && isValidDisplayName(displayName)) {
          sanitizedNewDisplayName = sanitizeDisplayName(displayName);
        } else {
          throw new AuthError(
            "DISPLAY_NAME_REQUIRED",
            "Full name is required to create a new account.",
            400
          );
        }
      }
      if (!allConsentsAccepted) {
        throw new AuthError(
          "CONSENT_REQUIRED",
          "Acceptance of Terms of Service, Privacy Policy, and Simulated Trading Disclosure is required to create an account.",
          400
        );
      }

      // First-time signup: provision User + PracticeAccount + Initial Ledger + Session + Token atomically
      try {
        const provisioningResult = await executeMongoTransaction(
          async (session) => {
            // Re-check inside transaction in case of simultaneous signup requests
            const concurrentUser = await UserModel.findOne({
              email: normalizedEmail,
            }).session(session ?? null);

            if (concurrentUser) {
              return { isExisting: true, user: concurrentUser };
            }

            const newUser = new UserModel({
              email: normalizedEmail,
              emailVerifiedAt: now,
              displayName: sanitizedNewDisplayName,
              status: "ACTIVE",
              onboardingCompleted: false,
              termsAcceptedAt: now,
              termsVersion,
              privacyAcceptedAt: now,
              privacyVersion,
              simulationDisclosureAcceptedAt: now,
              lastLoginAt: now,
            });
            await newUser.save({ session });

            const newAccount = new PracticeAccountModel({
              userId: newUser._id,
              accountNumber: 1,
              status: "ACTIVE",
              initialBalancePaise: INITIAL_ACCOUNT_BALANCE_PAISE,
              cashBalancePaise: INITIAL_ACCOUNT_BALANCE_PAISE,
              version: 0,
            });
            await newAccount.save({ session });

            const initialLedger = new LedgerEntryModel({
              userId: newUser._id,
              practiceAccountId: newAccount._id,
              entryType: "INITIAL_FUNDING",
              direction: "CREDIT",
              amountPaise: INITIAL_ACCOUNT_BALANCE_PAISE,
              balanceBeforePaise: 0,
              balanceAfterPaise: INITIAL_ACCOUNT_BALANCE_PAISE,
              referenceType: "PRACTICE_ACCOUNT",
              referenceId: newAccount._id,
              idempotencyKey: `INITIAL_FUNDING:${newAccount._id.toString()}`,
              description: "Initial virtual funding for practice trading account",
            });
            await initialLedger.save({ session });

            const newSession = new SessionModel({
              userId: newUser._id,
              currentRefreshTokenHash,
              status: "ACTIVE",
              ipAddress,
              userAgent: userAgent || "unknown",
              lastActiveAt: now,
              idleExpiresAt,
              absoluteExpiresAt,
            });
            await newSession.save({ session });

            const initialTokenRecord = new RefreshTokenModel({
              sessionId: newSession._id,
              userId: newUser._id,
              tokenHash: currentRefreshTokenHash,
              generation: 1,
              status: "ACTIVE",
              expiresAt: absoluteExpiresAt,
            });
            await initialTokenRecord.save({ session });

            return {
              isExisting: false,
              user: newUser,
              session: newSession,
            };
          }
        );

        if (!provisioningResult.isExisting) {
          isNewUser = true;
          userDoc = provisioningResult.user as unknown as IUser & {
            _id: Types.ObjectId;
          };
          sessionDoc = provisioningResult.session as unknown as ISession & {
            _id: Types.ObjectId;
          };
        } else {
          existingUser = provisioningResult.user;
        }
      } catch (err: unknown) {
        if (err instanceof AuthError) {
          throw err;
        }
        // Handle race condition on duplicate email unique index gracefully
        existingUser = await UserModel.findOne({ email: normalizedEmail });
        if (!existingUser) {
          throw new AuthError(
            "ACCOUNT_PROVISIONING_FAILED",
            "Failed to provision user account.",
            500
          );
        }
      }
    }

    if (existingUser) {
      if (existingUser.status === "SUSPENDED") {
        throw new AuthError(
          "USER_SUSPENDED",
          "This account is suspended. Please contact support.",
          403
        );
      }
      if (existingUser.status === "DELETED") {
        throw new AuthError("USER_NOT_FOUND", "Account not found.", 404);
      }

      // Update last login, ensure emailVerifiedAt, backfill displayName ONLY for legacy users
      // who genuinely have no stored displayName yet (NEVER overwrite an existing registered name),
      // and persist consents if newly accepted.
      existingUser.lastLoginAt = now;
      if (!existingUser.emailVerifiedAt) {
        existingUser.emailVerifiedAt = now;
      }
      if (
        (!existingUser.displayName || !existingUser.displayName.trim()) &&
        typeof displayName === "string" &&
        isValidDisplayName(displayName)
      ) {
        existingUser.displayName = sanitizeDisplayName(displayName);
      }
      if (allConsentsAccepted) {
        if (!existingUser.termsAcceptedAt) {
          existingUser.termsAcceptedAt = now;
          existingUser.termsVersion = termsVersion;
        }
        if (!existingUser.privacyAcceptedAt) {
          existingUser.privacyAcceptedAt = now;
          existingUser.privacyVersion = privacyVersion;
        }
        if (!existingUser.simulationDisclosureAcceptedAt) {
          existingUser.simulationDisclosureAcceptedAt = now;
        }
      }
      await existingUser.save();

      // Create new session document and refresh token record for this device
      const newSession = new SessionModel({
        userId: existingUser._id,
        currentRefreshTokenHash,
        status: "ACTIVE",
        ipAddress,
        userAgent: userAgent || "unknown",
        lastActiveAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
      });
      await newSession.save();

      const initialTokenRecord = new RefreshTokenModel({
        sessionId: newSession._id,
        userId: existingUser._id,
        tokenHash: currentRefreshTokenHash,
        generation: 1,
        status: "ACTIVE",
        expiresAt: absoluteExpiresAt,
      });
      await initialTokenRecord.save();

      userDoc = existingUser as unknown as IUser & { _id: Types.ObjectId };
      sessionDoc = newSession as unknown as ISession & {
        _id: Types.ObjectId;
      };
    }

    // 4. Generate 15-minute access JWT
    const accessToken = this.jwtService.generateAccessToken({
      userId: userDoc!._id.toString(),
      sessionId: sessionDoc!._id.toString(),
    });

    return {
      isNewUser,
      user: {
        id: userDoc!._id.toString(),
        userId: userDoc!._id.toString(),
        email: userDoc!.email,
        emailVerifiedAt: userDoc!.emailVerifiedAt,
        displayName: userDoc!.displayName,
        status: userDoc!.status,
        onboardingCompleted: userDoc!.onboardingCompleted,
        termsAcceptedAt: userDoc!.termsAcceptedAt,
        termsVersion: userDoc!.termsVersion,
        privacyAcceptedAt: userDoc!.privacyAcceptedAt,
        privacyVersion: userDoc!.privacyVersion,
        simulationDisclosureAcceptedAt: userDoc!.simulationDisclosureAcceptedAt,
      },
      session: {
        id: sessionDoc!._id.toString(),
        status: sessionDoc!.status,
        idleExpiresAt: sessionDoc!.idleExpiresAt,
        absoluteExpiresAt: sessionDoc!.absoluteExpiresAt,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Rotates an opaque refresh token with complete historical reuse detection:
   * - Hashes presented token and searches RefreshToken records.
   * - If token is unknown: returns 401 (does NOT revoke unrelated sessions).
   * - If token was already ROTATED: DETECTS REUSE! Revokes entire session & token family.
   * - If token is ACTIVE: atomically rotates token, issues replacement and fresh 15m access JWT.
   */
  public async rotateRefreshToken(params: {
    rawRefreshToken: string;
    ipAddress: string;
    userAgent: string;
    now?: Date;
  }): Promise<RefreshResult> {
    const { rawRefreshToken, ipAddress, userAgent } = params;
    const now = params.now ?? new Date();

    if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
      throw new AuthError(
        "INVALID_REFRESH_TOKEN",
        "Missing refresh token.",
        401
      );
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);

    // 1. Look up token in durable RefreshToken collection (+tokenHash select)
    const tokenRecord = await RefreshTokenModel.findOne({ tokenHash }).select(
      "+tokenHash"
    );

    if (!tokenRecord) {
      // Completely unknown token -> 401. Crucial requirement: do not revoke unrelated sessions
      throw new AuthError(
        "INVALID_REFRESH_TOKEN",
        "Invalid refresh token.",
        401
      );
    }

    // 2. Token Reuse Detection: was this token already rotated?
    if (tokenRecord.status === "ROTATED") {
      // Security Incident: A previously rotated token was reused!
      // Revoke the session and the entire token family
      await SessionModel.updateOne(
        { _id: tokenRecord.sessionId },
        {
          $set: {
            status: "REVOKED",
            revokedReason: "TOKEN_REUSE_DETECTED",
            revokedAt: now,
          },
        }
      );

      await RefreshTokenModel.updateMany(
        { sessionId: tokenRecord.sessionId },
        { $set: { status: "REVOKED" } }
      );

      throw new AuthError(
        "REFRESH_TOKEN_REUSE_DETECTED",
        "Suspicious token reuse detected. All sessions revoked.",
        401
      );
    }

    if (tokenRecord.status === "REVOKED") {
      throw new AuthError(
        "SESSION_REVOKED",
        "Session has already been revoked.",
        401
      );
    }

    // 3. Token is ACTIVE: Validate associated session
    const sessionDoc = await SessionModel.findById(tokenRecord.sessionId).select(
      "+currentRefreshTokenHash +ipAddress +userAgent"
    );

    if (!sessionDoc || sessionDoc.status !== "ACTIVE") {
      throw new AuthError(
        "SESSION_REVOKED",
        "Session is no longer active.",
        401
      );
    }

    // Validate 7-day idle timeout
    if (now.getTime() > sessionDoc.idleExpiresAt.getTime()) {
      await SessionModel.updateOne(
        { _id: sessionDoc._id },
        {
          $set: {
            status: "EXPIRED",
            revokedReason: "IDLE_TIMEOUT",
            revokedAt: now,
          },
        }
      );
      throw new AuthError(
        "SESSION_EXPIRED",
        "Session expired due to inactivity. Please sign in again.",
        401
      );
    }

    // Validate 30-day absolute timeout
    if (now.getTime() > sessionDoc.absoluteExpiresAt.getTime()) {
      await SessionModel.updateOne(
        { _id: sessionDoc._id },
        {
          $set: {
            status: "EXPIRED",
            revokedReason: "ABSOLUTE_TIMEOUT",
            revokedAt: now,
          },
        }
      );
      throw new AuthError(
        "SESSION_EXPIRED",
        "Session lifetime has expired. Please sign in again.",
        401
      );
    }

    // Validate user status
    const userDoc = await UserModel.findById(sessionDoc.userId);
    if (!userDoc || userDoc.status !== "ACTIVE") {
      throw new AuthError("USER_SUSPENDED", "User account is suspended.", 403);
    }

    // 4. Perform atomic rotation inside a transaction
    const newRawRefreshToken = generateRawRefreshToken();
    const newTokenHash = hashRefreshToken(newRawRefreshToken);

    const candidateIdle = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
    const newIdleExpiresAt =
      candidateIdle.getTime() < sessionDoc.absoluteExpiresAt.getTime()
        ? candidateIdle
        : sessionDoc.absoluteExpiresAt;

    await executeMongoTransaction(async (dbSession) => {
      // Transition presented token from ACTIVE -> ROTATED
      const rotated = await RefreshTokenModel.findOneAndUpdate(
        { _id: tokenRecord._id, status: "ACTIVE" },
        { $set: { status: "ROTATED", rotatedAt: now } },
        { session: dbSession, new: true }
      );

      if (!rotated) {
        throw new AuthError(
          "CONCURRENCY_CONFLICT",
          "Simultaneous refresh detected. Only one rotation may succeed.",
          409
        );
      }

      // Insert new token record
      const newTokenRecord = new RefreshTokenModel({
        sessionId: sessionDoc._id,
        userId: sessionDoc.userId,
        tokenHash: newTokenHash,
        generation: tokenRecord.generation + 1,
        status: "ACTIVE",
        expiresAt: sessionDoc.absoluteExpiresAt,
      });
      await newTokenRecord.save({ session: dbSession });

      // Update session document
      await SessionModel.updateOne(
        { _id: sessionDoc._id },
        {
          $set: {
            previousRefreshTokenHash: tokenRecord.tokenHash,
            currentRefreshTokenHash: newTokenHash,
            lastActiveAt: now,
            idleExpiresAt: newIdleExpiresAt,
            rotatedAt: now,
            ipAddress,
            userAgent: userAgent || sessionDoc.userAgent,
          },
        },
        { session: dbSession }
      );
    });

    // 5. Generate fresh 15-minute access JWT
    const newAccessToken = this.jwtService.generateAccessToken({
      userId: userDoc._id.toString(),
      sessionId: sessionDoc._id.toString(),
    });

    return {
      accessToken: newAccessToken,
      newRefreshToken: newRawRefreshToken,
      session: {
        id: sessionDoc._id.toString(),
        status: "ACTIVE",
        idleExpiresAt: newIdleExpiresAt,
        absoluteExpiresAt: sessionDoc.absoluteExpiresAt,
      },
      user: {
        id: userDoc._id.toString(),
        userId: userDoc._id.toString(),
        email: userDoc.email,
        emailVerifiedAt: userDoc.emailVerifiedAt,
        displayName: userDoc.displayName,
        status: userDoc.status,
        onboardingCompleted: userDoc.onboardingCompleted,
      },
    };
  }

  /**
   * Logs out the current session and revokes its refresh token family.
   */
  public async logoutCurrentSession(params: {
    rawRefreshToken?: string;
    sessionId?: string;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();

    let targetSessionId = params.sessionId;

    if (params.rawRefreshToken) {
      const hash = hashRefreshToken(params.rawRefreshToken);
      const record = await RefreshTokenModel.findOne({ tokenHash: hash });
      if (record) {
        targetSessionId = record.sessionId.toString();
      }
    }

    if (!targetSessionId) {
      return;
    }

    await SessionModel.updateOne(
      { _id: targetSessionId, status: "ACTIVE" },
      {
        $set: {
          status: "REVOKED",
          revokedReason: "USER_LOGOUT",
          revokedAt: now,
        },
      }
    );

    await RefreshTokenModel.updateMany(
      { sessionId: targetSessionId, status: "ACTIVE" },
      { $set: { status: "REVOKED" } }
    );
  }

  /**
   * Logs out all sessions for the authenticated user and revokes all token families.
   */
  public async logoutAllSessions(
    userId: string | Types.ObjectId,
    now = new Date()
  ): Promise<void> {
    await SessionModel.updateMany(
      { userId, status: "ACTIVE" },
      {
        $set: {
          status: "REVOKED",
          revokedReason: "LOGOUT_ALL",
          revokedAt: now,
        },
      }
    );

    await RefreshTokenModel.updateMany(
      { userId, status: "ACTIVE" },
      { $set: { status: "REVOKED" } }
    );
  }

  /**
   * Retrieves all sessions belonging to the user for device management.
   */
  public async getUserSessions(
    userId: string | Types.ObjectId
  ): Promise<Array<Record<string, unknown>>> {
    const sessions = await SessionModel.find({ userId })
      .select("+ipAddress +userAgent -currentRefreshTokenHash -previousRefreshTokenHash")
      .sort({ lastActiveAt: -1 })
      .lean();

    return sessions.map((s) => ({
      id: s._id.toString(),
      status: s.status,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      lastActiveAt: s.lastActiveAt,
      idleExpiresAt: s.idleExpiresAt,
      absoluteExpiresAt: s.absoluteExpiresAt,
      createdAt: s.createdAt,
    }));
  }

  /**
   * Revokes an individual session belonging to the user (verifying ownership).
   */
  public async revokeUserSession(params: {
    userId: string | Types.ObjectId;
    sessionId: string;
    now?: Date;
  }): Promise<void> {
    const { userId, sessionId } = params;
    const now = params.now ?? new Date();

    if (!Types.ObjectId.isValid(sessionId)) {
      throw new AuthError("INVALID_EMAIL", "Invalid session identifier.", 400);
    }

    const session = await SessionModel.findOne({
      _id: sessionId,
      userId,
    });

    if (!session) {
      throw new AuthError("SESSION_REVOKED", "Session not found.", 404);
    }

    session.status = "REVOKED";
    session.revokedReason = "USER_LOGOUT";
    session.revokedAt = now;
    await session.save();

    await RefreshTokenModel.updateMany(
      { sessionId, status: "ACTIVE" },
      { $set: { status: "REVOKED" } }
    );
  }
}
