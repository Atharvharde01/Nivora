import { Types } from "mongoose";
import { UserModel } from "./user.model";
import {
  DISPLAY_NAME_MAX_LENGTH,
  isValidDisplayName,
  sanitizeDisplayName,
} from "./user.schema";

export type UserProfileErrorCode =
  | "INVALID_DISPLAY_NAME"
  | "USER_NOT_FOUND"
  | "USER_SUSPENDED";

export class UserProfileError extends Error {
  public readonly code: UserProfileErrorCode;
  public readonly statusCode: number;

  constructor(code: UserProfileErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "UserProfileError";
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, UserProfileError.prototype);
  }
}

export interface UserProfileSummary {
  id: string;
  userId: string;
  email: string;
  emailVerifiedAt?: Date;
  displayName?: string;
  status: string;
  onboardingCompleted: boolean;
  createdAt?: Date;
}

export class UserService {
  /**
   * Updates ONLY the authenticated user's displayName in MongoDB.
   * Never modifies email, status, emailVerifiedAt, or consent fields.
   */
  public async updateDisplayName(
    userId: string | Types.ObjectId,
    rawDisplayName: unknown
  ): Promise<UserProfileSummary> {
    if (typeof rawDisplayName !== "string" || !isValidDisplayName(rawDisplayName)) {
      throw new UserProfileError(
        "INVALID_DISPLAY_NAME",
        `Full name must be 2 to ${DISPLAY_NAME_MAX_LENGTH} characters, contain letters, and must not include control characters or email addresses.`,
        400
      );
    }

    const sanitizedDisplayName = sanitizeDisplayName(rawDisplayName);

    const existing = await UserModel.findById(userId).select("_id status").lean();
    if (!existing || existing.status === "DELETED") {
      throw new UserProfileError("USER_NOT_FOUND", "User account not found.", 404);
    }
    if (existing.status === "SUSPENDED") {
      throw new UserProfileError(
        "USER_SUSPENDED",
        "Account is suspended and cannot be updated.",
        403
      );
    }

    const updated = await UserModel.findOneAndUpdate(
      { _id: userId, status: "ACTIVE" },
      { $set: { displayName: sanitizedDisplayName } },
      { new: true, runValidators: true }
    );

    if (!updated) {
      throw new UserProfileError("USER_NOT_FOUND", "User account not found.", 404);
    }

    return {
      id: updated._id.toString(),
      userId: updated._id.toString(),
      email: updated.email,
      emailVerifiedAt: updated.emailVerifiedAt,
      displayName: updated.displayName,
      status: updated.status,
      onboardingCompleted: updated.onboardingCompleted,
      createdAt: updated.createdAt,
    };
  }
}
