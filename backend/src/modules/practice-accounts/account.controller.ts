import { Request, Response, NextFunction } from "express";
import { FilterQuery, Types } from "mongoose";
import { PracticeAccountModel } from "./account.model";
import { PracticeAccountService } from "./account.service";
import { PracticeAccountError } from "./account.service.types";
import { IPracticeAccount } from "./account.types";
import { LedgerEntryModel } from "../ledger/ledger.model";
import {
  ILedgerEntry,
  LEDGER_DIRECTIONS,
  LEDGER_ENTRY_TYPES,
  LedgerDirection,
  LedgerEntryType,
} from "../ledger/ledger.types";

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_\-:.]{8,128}$/;
const REQUIRED_RESET_CONFIRMATION = "RESET_PRACTICE_ACCOUNT";

export interface AccountControllerDependencies {
  practiceAccountService?: PracticeAccountService;
}

export class AccountController {
  private readonly practiceAccountService: PracticeAccountService;

  constructor(dependencies: AccountControllerDependencies = {}) {
    this.practiceAccountService =
      dependencies.practiceAccountService ?? new PracticeAccountService();
  }

  /**
   * GET /api/v1/accounts/active
   * Retrieves user's currently active practice account.
   */
  public getActiveAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const account =
        await this.practiceAccountService.getActiveAccountForUser(userId);

      res.status(200).json({
        success: true,
        data: { account },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/accounts
   * Lists all accounts for the user (both ACTIVE and ARCHIVED) with pagination.
   */
  public listAccounts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const { page: rawPage, limit: rawLimit } = req.query;

      const parsedPage =
        typeof rawPage === "string" ? parseInt(rawPage, 10) : 1;
      const page =
        Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

      const parsedLimit =
        typeof rawLimit === "string" ? parseInt(rawLimit, 10) : 20;
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit >= 1
          ? Math.min(100, parsedLimit)
          : 20;

      const skip = (page - 1) * limit;
      const filter: FilterQuery<IPracticeAccount> = { userId };

      const [items, total] = await Promise.all([
        PracticeAccountModel.find(filter)
          .sort({ accountNumber: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        PracticeAccountModel.countDocuments(filter),
      ]);

      const totalPages = Math.ceil(total / limit) || 1;

      res.status(200).json({
        success: true,
        data: {
          items,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/accounts/:accountId
   * Retrieves account details by ID with strict ownership validation.
   */
  public getAccountById = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const { accountId } = req.params;
      if (
        !accountId ||
        !Types.ObjectId.isValid(accountId) ||
        new Types.ObjectId(accountId).toString() !== accountId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_ACCOUNT_ID",
            message: "accountId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      const account =
        await this.practiceAccountService.getAccountByIdForUser(
          accountId.trim(),
          userId
        );

      res.status(200).json({
        success: true,
        data: { account },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/accounts/:accountId/balance
   * Retrieves cash balance view for an account.
   */
  public getAccountBalance = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const { accountId } = req.params;
      if (
        !accountId ||
        !Types.ObjectId.isValid(accountId) ||
        new Types.ObjectId(accountId).toString() !== accountId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_ACCOUNT_ID",
            message: "accountId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      const balance =
        await this.practiceAccountService.getAccountBalanceForUser(
          userId,
          accountId.trim()
        );

      res.status(200).json({
        success: true,
        data: { balance },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/accounts/:accountId/ledger
   * Retrieves immutable paginated cash ledger records for an account.
   */
  public getAccountLedger = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const { accountId } = req.params;
      if (
        !accountId ||
        !Types.ObjectId.isValid(accountId) ||
        new Types.ObjectId(accountId).toString() !== accountId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_ACCOUNT_ID",
            message: "accountId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      // Verify account ownership
      await this.practiceAccountService.getAccountByIdForUser(
        accountId.trim(),
        userId
      );

      const {
        entryType,
        direction,
        from,
        to,
        page: rawPage,
        limit: rawLimit,
      } = req.query;

      const filter: FilterQuery<ILedgerEntry> = {
        userId,
        practiceAccountId: new Types.ObjectId(accountId.trim()),
      };

      if (
        entryType &&
        typeof entryType === "string" &&
        (LEDGER_ENTRY_TYPES as readonly string[]).includes(entryType)
      ) {
        filter.entryType = entryType as LedgerEntryType;
      }

      if (
        direction &&
        typeof direction === "string" &&
        (LEDGER_DIRECTIONS as readonly string[]).includes(direction)
      ) {
        filter.direction = direction as LedgerDirection;
      }

      if (from || to) {
        const dateFilter: { $gte?: Date; $lte?: Date } = {};
        if (from && typeof from === "string") {
          const fromDate = new Date(from);
          if (!Number.isNaN(fromDate.getTime())) {
            dateFilter.$gte = fromDate;
          }
        }
        if (to && typeof to === "string") {
          const toDate = new Date(to);
          if (!Number.isNaN(toDate.getTime())) {
            dateFilter.$lte = toDate;
          }
        }
        if (Object.keys(dateFilter).length > 0) {
          filter.createdAt = dateFilter;
        }
      }

      const parsedPage =
        typeof rawPage === "string" ? parseInt(rawPage, 10) : 1;
      const page =
        Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

      const parsedLimit =
        typeof rawLimit === "string" ? parseInt(rawLimit, 10) : 20;
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit >= 1
          ? Math.min(100, parsedLimit)
          : 20;

      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        LedgerEntryModel.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        LedgerEntryModel.countDocuments(filter),
      ]);

      const totalPages = Math.ceil(total / limit) || 1;

      res.status(200).json({
        success: true,
        data: {
          items,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * POST /api/v1/accounts/reset
   * Atomically resets practice account inside a single MongoDB transaction.
   * Enforces explicit confirmation, active account expectation check, and idempotency.
   */
  public resetAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      // 1. Validate Idempotency-Key header
      const rawIdempotencyKey = req.headers["idempotency-key"];
      if (
        !rawIdempotencyKey ||
        typeof rawIdempotencyKey !== "string" ||
        !IDEMPOTENCY_KEY_PATTERN.test(rawIdempotencyKey.trim())
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_IDEMPOTENCY_KEY",
            message:
              "Idempotency-Key header is required and must be between 8 and 128 alphanumeric characters, hyphens, colons, dots, or underscores.",
          },
        });
        return;
      }
      const idempotencyKey = rawIdempotencyKey.trim();

      // 2. Validate confirmation payload
      const { confirmation, expectedActiveAccountId } = req.body ?? {};
      if (confirmation !== REQUIRED_RESET_CONFIRMATION) {
        res.status(400).json({
          success: false,
          error: {
            code: "CONFIRMATION_REQUIRED",
            message: `confirmation must strictly equal '${REQUIRED_RESET_CONFIRMATION}'.`,
          },
        });
        return;
      }

      // 3. Validate expectedActiveAccountId
      if (
        !expectedActiveAccountId ||
        typeof expectedActiveAccountId !== "string" ||
        !Types.ObjectId.isValid(expectedActiveAccountId) ||
        new Types.ObjectId(expectedActiveAccountId).toString() !==
          expectedActiveAccountId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_ACCOUNT_ID",
            message:
              "expectedActiveAccountId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      // 4. Durable Idempotency Check: check if key was already used for initial funding
      const existingLedger = await LedgerEntryModel.findOne({
        userId,
        idempotencyKey,
      }).lean();

      if (existingLedger && existingLedger.entryType === "INITIAL_FUNDING") {
        const existingAccount = await PracticeAccountModel.findById(
          existingLedger.practiceAccountId
        ).lean();

        if (existingAccount) {
          res.status(200).json({
            success: true,
            data: {
              activeAccount: existingAccount,
              initialFundingLedgerEntry: existingLedger,
              wasIdempotentReplay: true,
            },
          });
          return;
        }
      }

      // 5. Verify expectedActiveAccountId matches currently active account
      const currentActive =
        await this.practiceAccountService.getActiveAccountForUser(userId);

      if (
        currentActive.accountId.toString() !== expectedActiveAccountId.trim()
      ) {
        res.status(409).json({
          success: false,
          error: {
            code: "STALE_ACCOUNT_ID",
            message: `expectedActiveAccountId (${expectedActiveAccountId.trim()}) does not match current active practice account (${currentActive.accountId.toString()}).`,
          },
        });
        return;
      }

      // 6. Execute atomic reset in transaction
      const result = await this.practiceAccountService.resetPracticeAccount(
        userId,
        { idempotencyKey }
      );

      res.status(201).json({
        success: true,
        data: {
          archivedAccount: result.archivedAccount,
          activeAccount: result.activeAccount,
          initialFundingLedgerEntry: result.initialFundingLedgerEntry,
          wasIdempotentReplay: false,
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };
}
