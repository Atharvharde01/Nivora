/**
 * NIVORA Trading Platform — Order Action Drawer / Modal
 * Supports BUY (blue) and SELL (orange) simulated market order execution.
 * Connects to backend POST /api/v1/orders with Idempotency-Key headers,
 * strict whole-integer share validation, non-tradable/index blocking,
 * server-authoritative quote execution, and automated portfolio synchronization.
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Chip,
  Alert,
  CircularProgress,
  IconButton,
} from "@mui/material";
import { Close, CheckCircleOutline, ErrorOutline } from "@mui/icons-material";
import { useMarket } from "../context/MarketContext";
import { useAuth } from "../context/AuthContext";
import { usePortfolio } from "../context/PortfolioContext";
import { OrdersApi } from "../api/client";
import {
  OrderExecutionResult,
  OrderRejectionCode,
  OrderSide,
  formatRupees,
  paiseToRupees,
} from "../api/types";

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ord-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
}

interface ExecutionFeedback {
  type: "success" | "rejection" | "error";
  title: string;
  message: string;
  executionPriceRupees?: number;
  totalValueRupees?: number;
  rejectionCode?: OrderRejectionCode;
  wasIdempotentReplay?: boolean;
}

export const OrderActionWindow: React.FC = () => {
  const {
    isBuyWindowOpen,
    isSellWindowOpen,
    actionInstrument,
    closeActionWindows,
    selectedQuote,
    refreshSelectedQuote,
  } = useMarket();
  const { isAuthenticated } = useAuth();
  const { positions, refreshAll } = usePortfolio();

  const isOpen = isBuyWindowOpen || isSellWindowOpen;
  const side: OrderSide = isBuyWindowOpen ? "BUY" : "SELL";
  const instrument = actionInstrument;

  const [quantityStr, setQuantityStr] = useState<string>("1");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);

  const [feedback, setFeedback] = useState<ExecutionFeedback | null>(null);

  // Idempotency Tracking: Preserve key when retrying identical payload; rotate on change
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const lastPayloadKeyRef = useRef<string>("");

  // Reset form when modal opens or instrument changes
  useEffect(() => {
    if (isOpen) {
      setQuantityStr("1");
      setFeedback(null);
      setIsSubmitting(false);
      isSubmittingRef.current = false;
      const initialKey = generateIdempotencyKey();
      idempotencyKeyRef.current = initialKey;
      lastPayloadKeyRef.current = "";
    }
  }, [isOpen, instrument?.symbol, side]);

  if (!isOpen || !instrument) {
    return null;
  }

  const isIndex = instrument.type === "index" || !instrument.instrumentId;
  const isTradable = instrument.isTradable !== false && !isIndex;

  // Determine current indicative price from quote or instrument snapshot
  const indicativePaise =
    selectedQuote && selectedQuote.instrumentId === instrument.instrumentId && selectedQuote.lastPricePaise > 0
      ? selectedQuote.lastPricePaise
      : instrument.lastPricePaise && instrument.lastPricePaise > 0
      ? instrument.lastPricePaise
      : 0;

  const indicativeRupees = indicativePaise > 0 ? paiseToRupees(indicativePaise) : 0;

  // Available shares in user's portfolio for SELL orders
  const currentHolding = positions.find(
    (p) => p.instrumentId === instrument.instrumentId
  );
  const availableShares = currentHolding ? currentHolding.quantity : 0;

  // Quantity parsing & validation
  const parsedQuantity = Number(quantityStr.trim());
  const isQuantityEmpty = quantityStr.trim() === "";
  const isInteger = Number.isInteger(parsedQuantity);
  const isPositive = parsedQuantity > 0;
  const isSafeInteger = parsedQuantity <= Number.MAX_SAFE_INTEGER;

  let quantityError: string | null = null;
  if (!isQuantityEmpty) {
    if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
      quantityError = "Quantity must be a positive whole integer greater than zero.";
    } else if (!isInteger) {
      quantityError = "Fractional shares are not supported. Enter a whole integer quantity.";
    } else if (!isSafeInteger) {
      quantityError = "Quantity exceeds maximum safe integer limits.";
    } else if (side === "SELL" && parsedQuantity > availableShares) {
      quantityError = `Quantity exceeds your available holding of ${availableShares} share${
        availableShares === 1 ? "" : "s"
      }.`;
    }
  }

  const isValidQuantity =
    !isQuantityEmpty &&
    !Number.isNaN(parsedQuantity) &&
    isInteger &&
    isPositive &&
    isSafeInteger &&
    (side !== "SELL" || parsedQuantity <= availableShares);

  const estimatedTotalRupees =
    isValidQuantity && indicativeRupees > 0
      ? indicativeRupees * parsedQuantity
      : null;

  // Synchronous Idempotency Key Maintenance
  const currentPayloadKey = `${instrument.instrumentId}-${side}-${parsedQuantity}`;
  if (currentPayloadKey !== lastPayloadKeyRef.current && isValidQuantity) {
    lastPayloadKeyRef.current = currentPayloadKey;
    idempotencyKeyRef.current = generateIdempotencyKey();
  }

  const handleClose = () => {
    if (isSubmittingRef.current) return;
    closeActionWindows();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      setFeedback({
        type: "error",
        title: "Authentication Required",
        message: "Please sign in to place orders.",
      });
      return;
    }

    if (!isTradable || !instrument.instrumentId) {
      setFeedback({
        type: "error",
        title: "Trading Disabled",
        message: "Indices and non-tradable instruments cannot be ordered.",
      });
      return;
    }

    if (!isValidQuantity) {
      return;
    }

    // Synchronous submission lock
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setFeedback(null);

    const idempotencyKey = idempotencyKeyRef.current;

    try {
      const res = await OrdersApi.placeOrder(
        {
          instrumentId: instrument.instrumentId,
          side,
          quantity: parsedQuantity,
        },
        idempotencyKey
      );

      if (res.success && res.data) {
        const result: OrderExecutionResult = res.data;

        if (result.status === "EXECUTED") {
          const execPrice = result.order.executionPricePaise
            ? paiseToRupees(result.order.executionPricePaise)
            : 0;
          const totalVal = result.order.totalValuePaise
            ? paiseToRupees(result.order.totalValuePaise)
            : 0;

          setFeedback({
            type: "success",
            title: `Order Executed (${side})`,
            message: `Successfully executed market order for ${parsedQuantity} shares of ${instrument.symbol}.`,
            executionPriceRupees: execPrice,
            totalValueRupees: totalVal,
            wasIdempotentReplay: result.wasIdempotentReplay,
          });

          // Synchronize affected data across the entire application
          await Promise.all([refreshAll(), refreshSelectedQuote()]);
        } else if (result.status === "REJECTED") {
          setFeedback({
            type: "rejection",
            title: "Order Rejected",
            message:
              result.rejectionReason ||
              "Your order was rejected by the server execution engine.",
            rejectionCode: result.rejectionCode,
            wasIdempotentReplay: result.wasIdempotentReplay,
          });

          // Synchronize account/portfolio to reflect any rejection state
          await refreshAll();
        } else {
          setFeedback({
            type: "error",
            title: "Unexpected Status",
            message: `Order status: ${result.status}`,
          });
        }
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Order submission failed.";

        setFeedback({
          type: "error",
          title: "Submission Failed",
          message: errorMsg,
        });
      }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Network error occurred while submitting order.";

      setFeedback({
        type: "error",
        title: "Connection Error",
        message: errorMsg,
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const themeColor = side === "BUY" ? "#2563EB" : "#EA580C";
  const lightBgColor = side === "BUY" ? "#EFF6FF" : "#FFF7ED";
  const borderTone = side === "BUY" ? "#BFDBFE" : "#FED7AA";

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderTop: `4px solid ${themeColor}`,
          borderRadius: 2,
        },
      }}
    >
      <form onSubmit={handleSubmit} noValidate>
        {/* HEADER */}
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="h6" component="div" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {side} {instrument.symbol}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {instrument.exchange} • {instrument.name}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip
                label={side}
                size="small"
                sx={{
                  bgcolor: lightBgColor,
                  color: themeColor,
                  fontWeight: 700,
                  border: `1px solid ${borderTone}`,
                }}
              />
              <IconButton
                aria-label="Close order window"
                onClick={handleClose}
                size="small"
                disabled={isSubmitting}
              >
                <Close fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        {/* CONTENT */}
        <DialogContent dividers sx={{ py: 2 }}>
          {/* INDEX / NON-TRADABLE WARNING */}
          {isIndex && (
            <Alert severity="warning" sx={{ mb: 2, fontSize: "0.82rem" }}>
              <strong>{instrument.symbol}</strong> is a market index benchmark and cannot be traded directly. Select an equity instrument from the Marketwatch to trade.
            </Alert>
          )}

          {!isIndex && !isTradable && (
            <Alert severity="warning" sx={{ mb: 2, fontSize: "0.82rem" }}>
              This instrument is currently not marked tradable in the catalogue.
            </Alert>
          )}

          {/* UNAUTHENTICATED ALERT */}
          {!isAuthenticated && (
            <Alert severity="info" sx={{ mb: 2, fontSize: "0.82rem" }}>
              Authentication required to submit orders. Use Dev Token in the top menu to sign in.
            </Alert>
          )}

          {/* EXECUTION FEEDBACK BANNER */}
          {feedback && (
            <Box sx={{ mb: 2 }}>
              {feedback.type === "success" && (
                <Alert
                  severity="success"
                  icon={<CheckCircleOutline fontSize="inherit" />}
                  sx={{ fontSize: "0.85rem" }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {feedback.title}
                  </Typography>
                  <Typography variant="body2">{feedback.message}</Typography>
                  {feedback.executionPriceRupees !== undefined && feedback.totalValueRupees !== undefined && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: "1px dashed #A7F3D0" }}>
                      <Typography variant="caption" display="block">
                        Execution Price: <strong>₹{formatRupees(feedback.executionPriceRupees)}</strong>
                      </Typography>
                      <Typography variant="caption" display="block">
                        Total Value: <strong>₹{formatRupees(feedback.totalValueRupees)}</strong>
                      </Typography>
                      {feedback.wasIdempotentReplay && (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                          (Idempotent replay detected)
                        </Typography>
                      )}
                    </Box>
                  )}
                </Alert>
              )}

              {feedback.type === "rejection" && (
                <Alert
                  severity="error"
                  icon={<ErrorOutline fontSize="inherit" />}
                  sx={{ fontSize: "0.85rem" }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {feedback.title} {feedback.rejectionCode ? `[${feedback.rejectionCode}]` : ""}
                  </Typography>
                  <Typography variant="body2">{feedback.message}</Typography>
                </Alert>
              )}

              {feedback.type === "error" && (
                <Alert severity="error" sx={{ fontSize: "0.85rem" }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {feedback.title}
                  </Typography>
                  <Typography variant="body2">{feedback.message}</Typography>
                </Alert>
              )}
            </Box>
          )}

          {/* INPUT FIELDS */}
          <Box sx={{ display: "flex", gap: 2, mb: 1.5 }}>
            <TextField
              label="Quantity"
              type="number"
              size="small"
              value={quantityStr}
              onChange={(e) => setQuantityStr(e.target.value)}
              error={Boolean(quantityError)}
              helperText={quantityError}
              disabled={isSubmitting || !isTradable || !isAuthenticated}
              inputProps={{ min: 1, step: 1 }}
              fullWidth
              autoFocus
            />
            <TextField
              label="Order Type"
              size="small"
              value="MARKET"
              disabled
              fullWidth
            />
          </Box>

          {/* PORTFOLIO HOLDING INFO (FOR SELL ORDERS) */}
          {side === "SELL" && isTradable && isAuthenticated && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                px: 1.5,
                py: 1,
                mb: 1.5,
                bgcolor: availableShares > 0 ? "#F0FDF4" : "#FEF2F2",
                borderRadius: 1,
                border: `1px solid ${availableShares > 0 ? "#BBF7D0" : "#FECACA"}`,
              }}
            >
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Available in Portfolio:
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, color: availableShares > 0 ? "#166534" : "#991B1B" }}
              >
                {availableShares} share{availableShares === 1 ? "" : "s"}
              </Typography>
            </Box>
          )}

          {/* INDICATIVE PRICING & CONSIDERATION ESTIMATE */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              p: 1.5,
              bgcolor: "#F8FAFC",
              borderRadius: 1,
              border: "1px solid #E2E8F0",
              mb: 1.5,
            }}
          >
            <div>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                Indicative Quote:
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {indicativeRupees > 0 ? `₹${formatRupees(indicativeRupees)}` : "Market Price"}
              </Typography>
            </div>
            <div style={{ textAlign: "right" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                Estimated Consideration:
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: themeColor }}>
                {estimatedTotalRupees !== null
                  ? `₹${formatRupees(estimatedTotalRupees)}`
                  : "—"}
              </Typography>
            </div>
          </Box>

          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", fontSize: "0.74rem" }}>
            * Market orders execute strictly at the backend execution engine's authoritative quote.
          </Typography>
        </DialogContent>

        {/* ACTIONS */}
        <DialogActions sx={{ px: 3, py: 2, justifyContent: "space-between" }}>
          <Button onClick={handleClose} color="inherit" size="small" disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={
              isSubmitting ||
              !isAuthenticated ||
              !isTradable ||
              !isValidQuantity
            }
            sx={{
              bgcolor: themeColor,
              "&:hover": {
                bgcolor: side === "BUY" ? "#1D4ED8" : "#C2410C",
              },
              fontWeight: 700,
              minWidth: 100,
            }}
          >
            {isSubmitting ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              `${side} ${isValidQuantity && parsedQuantity > 0 ? `(${parsedQuantity})` : ""}`
            )}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default OrderActionWindow;
