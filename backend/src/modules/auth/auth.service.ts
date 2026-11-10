import crypto from "node:crypto";
import { Types } from "mongoose";
import { UserModel } from "../users/user.model";
import { PracticeAccountModel } from "../practice-accounts/account.model";
import { LedgerEntryModel } from "../ledger/ledger.model";
import { SessionModel } from "./session.model";
import { OtpService } from "./otp.service";
import { JwtService } from "./jwt.service";
import { AuthError } from "./auth.errors";
import { executeMongoTransaction } from "../practice-accounts/account.service";
import { IUser } from "../users/user.types";
import { ISession } from "./auth.types";

export const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const INITIAL_ACCOUNT_BALANCE_PAISE = 100_000_000; // ₹10,00,000 in integer paise

export interface LoginResult {
  user: {
    id: string;
    email: string;
    displayName?: string;
    status: string;
    onboardingCompleted: boolean;
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
   * Verifies email OTP and logs in the user:
   * - Validates & consumes OTP challenge.
   * - Provisions user, active practice account, initial funding ledger, and session atomically if new.
   * - Resolves existing user and appends new session if returning.
   * - Issues 15-minute access JWT and returns opaque refresh token.
   */
  public async verifyOtpAndLogin(params: {
    email: string;
    otp: string;
    ipAddress: string;
    userAgent: string;
    now?: Date;
  }): Promise<LoginResult> {
    const { email, otp, ipAddress, userAgent } = params;
    const now = params.now ?? new Date();

    // 1. Verify and consume OTP challenge
    const otpResult = await this.otpService.verifyOtp(email, otp, now);
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

    if (!existingUser) {
      // First-time signup: provision User + PracticeAccount + Initial Ledger + Session atomically
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
              status: "ACTIVE",
              onboardingCompleted: false,
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

            return {
              isExisting: false,
              user: newUser,
              session: newSession,
            };
          }
        );

        if (!provisioningResult.isExisting) {
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

      // Update last login
      existingUser.lastLoginAt = now;
      await existingUser.save();

      // Create new session document for this device
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
      user: {
        id: userDoc!._id.toString(),
        email: userDoc!.email,
        displayName: userDoc!.displayName,
        status: userDoc!.status,
        onboardingCompleted: userDoc!.onboardingCompleted,
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
}
