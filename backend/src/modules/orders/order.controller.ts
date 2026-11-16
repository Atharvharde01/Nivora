import { Request, Response, NextFunction } from "express";
import { FilterQuery, Types } from "mongoose";
import { OrderModel } from "./order.model";
import { OrderExecutionService } from "./order-execution.service";
import {
  OrderExecutionError,
  OrderExecutionErrorCode,
} from "./order-execution.types";
import { IOrder, ORDER_SIDES, ORDER_STATUSES, OrderSide, OrderStatus } from "./order.types";
import { PracticeAccountService } from "../practice-accounts/account.service";
import { PracticeAccountError } from "../practice-accounts/account.service.types";

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_\-:.]{8,128}$/;

const FORBIDDEN_CLIENT_PRICE_FIELDS = [
  "executionPricePaise",
  "pricePaise",
  "price",
  "askPricePaise",
  "bidPricePaise",
  "totalValuePaise",
] as const;

export interface OrderControllerDependencies {
  orderExecutionService?: OrderExecutionService;
  practiceAccountService?: PracticeAccountService;
}

export class OrderController {
  private readonly orderExecutionService: OrderExecutionService;
  private readonly practiceAccountService: PracticeAccountService;

  constructor(dependencies: OrderControllerDependencies = {}) {
    this.orderExecutionService =
      dependencies.orderExecutionService ?? new OrderExecutionService();
    this.practiceAccountService =
      dependencies.practiceAccountService ?? new PracticeAccountService();
  }

  /**
   * POST /api/v1/orders
   * Submits and executes a simulated market order with ACID transactional updates.
   */
  public createOrder = async (
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

      // 2. Reject client price injection
      const body = req.body ?? {};
      for (const field of FORBIDDEN_CLIENT_PRICE_FIELDS) {
        if (field in body && body[field] !== undefined) {
          res.status(400).json({
            success: false,
            error: {
              code: "CLIENT_PRICE_NOT_ALLOWED",
              message:
                "Client-supplied execution prices are not allowed. Market orders execute strictly at server-authoritative quotes.",
            },
          });
          return;
        }
      }

      // 3. Validate instrumentId
      const { instrumentId, side, quantity, practiceAccountId } = body;
      if (
        !instrumentId ||
        typeof instrumentId !== "string" ||
        !Types.ObjectId.isValid(instrumentId) ||
        new Types.ObjectId(instrumentId).toString() !== instrumentId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_INSTRUMENT_ID",
            message: "instrumentId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      // 4. Validate order side
      if (
        !side ||
        typeof side !== "string" ||
        !(ORDER_SIDES as readonly string[]).includes(side)
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_ORDER_SIDE",
            message: "side must be either 'BUY' or 'SELL'.",
          },
        });
        return;
      }

      // 5. Validate quantity
      if (
        typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_QUANTITY",
            message: "quantity must be a positive whole integer greater than zero.",
          },
        });
        return;
      }

      // 6. Resolve practiceAccountId (either validated explicit ID or active account)
      let resolvedAccountId: Types.ObjectId;
      if (practiceAccountId !== undefined) {
        if (
          typeof practiceAccountId !== "string" ||
          !Types.ObjectId.isValid(practiceAccountId) ||
          new Types.ObjectId(practiceAccountId).toString() !== practiceAccountId.trim()
        ) {
          res.status(400).json({
            success: false,
            error: {
              code: "INVALID_ACCOUNT_ID",
              message: "practiceAccountId must be a valid MongoDB ObjectId.",
            },
          });
          return;
        }

        const accountSummary =
          await this.practiceAccountService.getAccountByIdForUser(
            practiceAccountId.trim(),
            userId,
            { requireActive: true }
          );
        resolvedAccountId = accountSummary.accountId;
      } else {
        const activeAccount =
          await this.practiceAccountService.getActiveAccountForUser(userId);
        resolvedAccountId = activeAccount.accountId;
      }

      // 7. Execute market order
      const result = await this.orderExecutionService.executeMarketOrder({
        userId,
        practiceAccountId: resolvedAccountId,
        instrumentId: instrumentId.trim(),
        side: side as OrderSide,
        quantity,
        idempotencyKey,
      });

      // 8. Map HTTP status: 200 for idempotent replay, 201 for freshly persisted order
      const httpStatus = result.wasIdempotentReplay ? 200 : 201;

      res.status(httpStatus).json({
        success: true,
        data: {
          order: result.order,
          trade: result.trade,
          status: result.status,
          wasIdempotentReplay: result.wasIdempotentReplay,
          ...(result.status === "REJECTED"
            ? {
                rejectionCode: result.rejectionCode,
                rejectionReason: result.rejectionReason,
              }
            : {}),
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/orders
   * Retrieves paginated order history strictly scoped to the authenticated user.
   */
  public listOrders = async (
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

      const {
        practiceAccountId,
        instrumentId,
        side,
        status,
        page: rawPage,
        limit: rawLimit,
      } = req.query;

      const filter: FilterQuery<IOrder> = { userId };

      if (practiceAccountId && typeof practiceAccountId === "string") {
        if (!Types.ObjectId.isValid(practiceAccountId)) {
          res.status(400).json({
            success: false,
            error: {
              code: "INVALID_ACCOUNT_ID",
              message: "practiceAccountId must be a valid MongoDB ObjectId.",
            },
          });
          return;
        }
        filter.practiceAccountId = new Types.ObjectId(practiceAccountId);
      }

      if (instrumentId && typeof instrumentId === "string") {
        if (!Types.ObjectId.isValid(instrumentId)) {
          res.status(400).json({
            success: false,
            error: {
              code: "INVALID_INSTRUMENT_ID",
              message: "instrumentId must be a valid MongoDB ObjectId.",
            },
          });
          return;
        }
        filter.instrumentId = new Types.ObjectId(instrumentId);
      }

      if (
        side &&
        typeof side === "string" &&
        (ORDER_SIDES as readonly string[]).includes(side)
      ) {
        filter.side = side as OrderSide;
      }

      if (
        status &&
        typeof status === "string" &&
        (ORDER_STATUSES as readonly string[]).includes(status)
      ) {
        filter.status = status as OrderStatus;
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
        OrderModel.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        OrderModel.countDocuments(filter),
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
   * GET /api/v1/orders/:orderId
   * Retrieves specific order details with strict user ownership enforcement.
   */
  public getOrderById = async (
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

      const { orderId } = req.params;
      if (
        !orderId ||
        !Types.ObjectId.isValid(orderId) ||
        new Types.ObjectId(orderId).toString() !== orderId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_ORDER_ID",
            message: "orderId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      const order = await OrderModel.findOne({
        _id: new Types.ObjectId(orderId.trim()),
        userId,
      }).lean();

      if (!order) {
        res.status(404).json({
          success: false,
          error: {
            code: "ORDER_NOT_FOUND",
            message: `Order ${orderId} was not found.`,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { order },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  private mapOrderErrorCodeToStatus(code: OrderExecutionErrorCode): number {
    switch (code) {
      case "IDEMPOTENCY_KEY_CONFLICT":
      case "CONCURRENCY_CONFLICT":
        return 409;
      case "USER_NOT_FOUND":
      case "ACCOUNT_NOT_FOUND":
      case "INSTRUMENT_NOT_FOUND":
        return 404;
      case "USER_NOT_PERMITTED":
      case "ACCOUNT_OWNERSHIP_VIOLATION":
        return 403;
      case "TRANSACTION_UNAVAILABLE":
        return 503;
      case "EXECUTION_FAILED":
        return 500;
      case "CLIENT_PRICE_NOT_ALLOWED":
      case "VALIDATION_ERROR":
      case "ACCOUNT_INACTIVE":
      case "INVALID_QUOTE_DATA":
      default:
        return 400;
    }
  }
}
