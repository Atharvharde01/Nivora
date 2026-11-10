import { Request } from "express";
import { Types } from "mongoose";
import { ForbiddenError, UnauthorizedError, BadRequestError } from "../errors/app-error";

export function assertAuthenticated(
  req: Request
): asserts req is Request & { user: { _id: Types.ObjectId; status: string } } {
  if (!req.user || !req.user._id) {
    throw new UnauthorizedError("UNAUTHORIZED", "Authentication required.");
  }
}

export function assertUserActive(req: Request): void {
  assertAuthenticated(req);
  if (req.user.status !== "ACTIVE") {
    throw new ForbiddenError(
      "USER_SUSPENDED",
      "User account is suspended or inactive."
    );
  }
}

export function assertResourceOwnership(
  ownerUserId: string | Types.ObjectId,
  requestingUserId: string | Types.ObjectId,
  resourceType = "resource"
): void {
  const ownerStr =
    typeof ownerUserId === "string" ? ownerUserId : ownerUserId.toString();
  const requestingStr =
    typeof requestingUserId === "string"
      ? requestingUserId
      : requestingUserId.toString();

  if (ownerStr !== requestingStr) {
    throw new ForbiddenError(
      `${resourceType.toUpperCase()}_OWNERSHIP_VIOLATION`,
      `You do not have permission to access or modify this ${resourceType}.`
    );
  }
}

export function assertActivePracticeAccount(account: { status: string }): void {
  if (account.status !== "ACTIVE") {
    throw new BadRequestError(
      "ACCOUNT_ARCHIVED",
      "Trading operations cannot be executed on an archived practice account."
    );
  }
}
