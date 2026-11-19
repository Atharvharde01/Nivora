/**
 * NIVORA Trading Platform — Order Action Drawer / Modal
 * Supports BUY (blue) and SELL (orange) simulated market order execution.
 * Connects to backend POST /api/v1/orders with Idempotency-Key headers,
 * strict whole-integer share validation, non-tradable/index blocking,
 * server-authoritative quote execution, and automated portfolio synchronization.
 * Hardened with request-generation and authentication session isolation.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  IconButton,
  Chip,
  Alert,
} from "@mui/material";
import {
  Close as CloseIcon,
  CheckCircleOutline,
  ErrorOutline,
} from "@mui/icons-material";
import { OrdersApi } from "../api/client";
import {
  formatRupees,
  OrderExecutionResult,
  OrderRejectionCode,
  OrderSide,
  paiseToRupees,
} from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useMarket } from "../context/MarketContext";
import { usePortfolio } from "../context/PortfolioContext";

function generateIdempotencyKey(): string {
  const ts = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `ord_${ts}_${randomPart}`;
}

export interface ExecutionFeedback {
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
  const { isAuthenticated, token } = useAuth();
  const { positions, refreshAll } = usePortfolio();

  const isOpen = isBuyWindowOpen || isSellWindowOpen;
  const side: OrderSide = isBuyWindowOpen ? "BUY" : "SELL";
  const instrument = actionInstrument;

  // Synchronous auth-session generation tracking
  const authSessionGenRef = useRef<number>(0);
  const prevTokenRef = useRef<string | null>(token);
  const isSubmittingRef = useRef<boolean>(false);

  if (prevTokenRef.current !== token) {
    prevTokenRef.current = token;
    authSessionGenRef.current += 1;
    // An authentication change immediately voids any prior in-flight submission lock
    isSubmittingRef.current = false;
  }

  const isMountedRef = useRef<boolean>(true);

  // Monotonically increasing order submission ID
  const orderSubmissionIdRef = useRef<number>(0);

  const [quantityStr, setQuantityStr] = useState<string>("1");

  // Session-scoped submission state
  const [submissionState, setSubmissionState] = useState<{
    submitting: boolean;
    sessionGen: number;
    submissionId: number;
  }>({ submitting: false, sessionGen: 0, submissionId: 0 });

  // Session-scoped execution feedback
  const [feedbackState, setFeedbackState] = useState<{
    feedback: ExecutionFeedback | null;
    sessionGen: number;
  }>({ feedback: null, sessionGen: 0 });

  // Idempotency Tracking: Preserve key when retrying identical payload; rotate on change
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());
  const lastPayloadKeyRef = useRef<string>("");

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset form when modal opens or instrument changes
  useEffect(() => {
    if (isOpen) {
      setQuantityStr("1");
      setFeedbackState({ feedback: null, sessionGen: authSessionGenRef.current });
      setSubmissionState({ submitting: false, sessionGen: authSessionGenRef.current, submissionId: 0 });
      isSubmittingRef.current = false;
      const initialKey = generateIdempotencyKey();
      idempotencyKeyRef.current = initialKey;
      lastPayloadKeyRef.current = "";
    }
  }, [isOpen, instrument?.symbol, side]);

  // Synchronously derived states: immediately isolated across sessions
  const activeSessionGen = authSessionGenRef.current;

  const isSubmitting =
    submissionState.submitting &&
    submissionState.sessionGen === activeSessionGen &&
    submissionState.submissionId === orderSubmissionIdRef.current;

  const feedback =
    feedbackState.sessionGen === activeSessionGen
      ? feedbackState.feedback
      : null;

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

    if (!isAuthenticated || !token) {
      setFeedbackState({
        feedback: {
          type: "error",
          title: "Authentication Required",
          message: "Please sign in to place orders.",
        },
        sessionGen: authSessionGenRef.current,
      });
      return;
    }

    if (!isTradable || !instrument.instrumentId) {
      setFeedbackState({
        feedback: {
          type: "error",
          title: "Trading Disabled",
          message: "Indices and non-tradable instruments cannot be ordered.",
        },
        sessionGen: authSessionGenRef.current,
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

    const sessionGen = authSessionGenRef.current;
    const submissionId = ++orderSubmissionIdRef.current;

    isSubmittingRef.current = true;
    setSubmissionState({ submitting: true, sessionGen, submissionId });
    setFeedbackState({ feedback: null, sessionGen });

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

      // Guard: If session changed or submission was superseded, discard result completely
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        orderSubmissionIdRef.current !== submissionId
      ) {
        return;
      }

      if (res.success && res.data) {
        const result: OrderExecutionResult = res.data;

        if (result.status === "EXECUTED") {
          const execPrice = result.order.executionPricePaise
            ? paiseToRupees(result.order.executionPricePaise)
            : 0;
          const totalVal = result.order.totalValuePaise
            ? paiseToRupees(result.order.totalValuePaise)
            : 0;

          setFeedbackState({
            feedback: {
              type: "success",
              title: `Order Executed (${side})`,
              message: `Successfully executed market order for ${parsedQuantity} shares of ${instrument.symbol}.`,
              executionPriceRupees: execPrice,
              totalValueRupees: totalVal,
              wasIdempotentReplay: result.wasIdempotentReplay,
            },
            sessionGen,
          });

          // Synchronize affected data across the entire application
          try {
            await Promise.all([refreshAll(), refreshSelectedQuote()]);
          } catch (syncErr) {
            console.warn("Post-order portfolio refresh warning:", syncErr);
          }
        } else if (result.status === "REJECTED") {
          setFeedbackState({
            feedback: {
              type: "rejection",
              title: "Order Rejected",
              message:
                result.rejectionReason ||
                "Your order was rejected by the server execution engine.",
              rejectionCode: result.rejectionCode,
              wasIdempotentReplay: result.wasIdempotentReplay,
            },
            sessionGen,
          });

          // Synchronize account/portfolio to reflect any rejection state
          try {
            await refreshAll();
          } catch (syncErr) {
            console.warn("Post-rejection portfolio refresh warning:", syncErr);
          }
        } else {
          setFeedbackState({
            feedback: {
              type: "error",
              title: "Unexpected Status",
              message: `Order status: ${result.status}`,
            },
            sessionGen,
          });
        }
      } else {
        const errorMsg =
          typeof res.error === "object" && res.error !== null && "message" in res.error
            ? String((res.error as { message: unknown }).message)
            : typeof res.error === "string"
            ? res.error
            : "Order submission failed.";

        setFeedbackState({
          feedback: {
            type: "error",
            title: "Submission Failed",
            message: errorMsg,
          },
          sessionGen,
        });
      }
    } catch (err: unknown) {
      if (
        !isMountedRef.current ||
        authSessionGenRef.current !== sessionGen ||
        orderSubmissionIdRef.current !== submissionId
      ) {
        return;
      }

      const errorMsg =
        err instanceof Error
          ? err.message
          : "Network error occurred while submitting order.";

      setFeedbackState({
        feedback: {
          type: "error",
          title: "Connection Error",
          message: errorMsg,
        },
        sessionGen,
      });
    } finally {
      if (
        authSessionGenRef.current === sessionGen &&
        orderSubmissionIdRef.current === submissionId
      ) {
        isSubmittingRef.current = false;
        if (isMountedRef.current) {
          setSubmissionState({ submitting: false, sessionGen, submissionId });
        }
      }
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
          borderRadius: "8px",
          overflow: "hidden",
          borderTop: `4px solid ${themeColor}`,
        },
      }}
    >
      <form onSubmit={handleSubmit} noValidate>
        {/* HEADER */}
        <DialogTitle sx={{ p: 2, pb: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="h6" component="div" sx={{ fontWeight: 700, fontSize: "1.1rem" }}>
                {side} {instrument.symbol}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {instrument.exchange} • {instrument.name}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip
                label={side}
                size="small"
                sx={{
                  bgcolor: themeColor,
                  color: "#FFFFFF",
                  fontWeight: 700,
                  fontSize: "0.72rem",
                }}
              />
              <IconButton
                size="small"
                onClick={handleClose}
                disabled={isSubmitting}
                aria-label="Close order window"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent dividers sx={{ p: 2.5 }}>
          {/* INDEX / UNTRADABLE WARNINGS */}
          {isIndex && (
            <Alert severity="warning" sx={{ mb: 2, fontSize: "0.82rem" }}>
              Indices cannot be traded directly. Select a constituent stock or equity from the Marketwatch to trade.
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
              Authentication required to submit orders. Please sign in to continue.
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
              helperText="Instant execution at LTP"
            />
          </Box>

          {/* INDICATIVE PRICE & HOLDINGS CONTEXT */}
          <Box
            sx={{
              p: 1.5,
              borderRadius: "4px",
              bgcolor: lightBgColor,
              border: `1px solid ${borderTone}`,
              mb: 1,
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Indicative Market Price:
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {indicativeRupees > 0 ? `₹${formatRupees(indicativeRupees)}` : "—"}
              </Typography>
            </Box>

            {estimatedTotalRupees !== null && (
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Estimated Total:
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: themeColor }}>
                  ₹{formatRupees(estimatedTotalRupees)}
                </Typography>
              </Box>
            )}

            {side === "SELL" && (
              <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5, pt: 0.5, borderTop: "1px dashed rgba(0,0,0,0.1)" }}>
                <Typography variant="caption" color="text.secondary">
                  Your Available Holding:
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    color: availableShares > 0 ? "text.primary" : "#DC2626",
                  }}
                >
                  {availableShares} share{availableShares === 1 ? "" : "s"}
                </Typography>
              </Box>
            )}
          </Box>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: "0.72rem" }}>
            * Final execution price is determined by the server matching engine at order receipt.
          </Typography>
        </DialogContent>

        <DialogActions sx={{ p: 2, pt: 1, bgcolor: "#F8FAFC", justifyContent: "space-between" }}>
          <Button
            onClick={handleClose}
            disabled={isSubmitting}
            size="small"
            sx={{ color: "#64748B", textTransform: "none" }}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            variant="contained"
            disabled={!isValidQuantity || !isTradable || !isAuthenticated || isSubmitting}
            sx={{
              bgcolor: themeColor,
              "&:hover": { bgcolor: themeColor, opacity: 0.9 },
              px: 3,
              fontWeight: 700,
              textTransform: "none",
            }}
          >
            {isSubmitting
              ? "Submitting..."
              : `${side} ${isValidQuantity ? `(${parsedQuantity})` : ""}`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default OrderActionWindow;
