/**
 * NIVORA Trading Platform — Order Action Drawer / Modal
 * Supports BUY (blue) and SELL (orange) order preparation and review.
 */

import React, { useState } from "react";
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
} from "@mui/material";
import { useMarket } from "../context/MarketContext";

export const OrderActionWindow: React.FC = () => {
  const {
    isBuyWindowOpen,
    isSellWindowOpen,
    actionInstrument,
    closeActionWindows,
  } = useMarket();

  const isOpen = isBuyWindowOpen || isSellWindowOpen;
  const isBuy = isBuyWindowOpen;
  const instrument = actionInstrument;

  const [quantity, setQuantity] = useState<number>(1);

  if (!isOpen || !instrument) {
    return null;
  }

  const priceRupees = instrument.lastPricePaise
    ? instrument.lastPricePaise / 100
    : 0;
  const estimatedTotalRupees = priceRupees * (quantity > 0 ? quantity : 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Milestone 5.6 will handle live order execution via OrdersApi.placeOrder
    closeActionWindows();
  };

  return (
    <Dialog
      open={isOpen}
      onClose={closeActionWindows}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderTop: `4px solid ${isBuy ? "#2563EB" : "#EA580C"}`,
          borderRadius: 2,
        },
      }}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="h6" component="div" sx={{ fontWeight: 700 }}>
                {isBuy ? "BUY" : "SELL"} {instrument.symbol}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {instrument.exchange} • {instrument.name}
              </Typography>
            </Box>
            <Chip
              label={isBuy ? "BUY" : "SELL"}
              size="small"
              sx={{
                bgcolor: isBuy ? "#EFF6FF" : "#FFF7ED",
                color: isBuy ? "#1D4ED8" : "#C2410C",
                fontWeight: 700,
                border: `1px solid ${isBuy ? "#BFDBFE" : "#FED7AA"}`,
              }}
            />
          </Box>
        </DialogTitle>

        <DialogContent dividers sx={{ py: 2 }}>
          <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
            <TextField
              label="Quantity"
              type="number"
              size="small"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
              inputProps={{ min: 1, step: 1 }}
              fullWidth
            />
            <TextField
              label="Price (Market)"
              size="small"
              value={
                priceRupees > 0
                  ? `₹${priceRupees.toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : "MARKET"
              }
              disabled
              fullWidth
            />
          </Box>

          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              p: 1.5,
              bgcolor: "#F8FAFC",
              borderRadius: 1,
              border: "1px solid #E2E8F0",
              mb: 2,
            }}
          >
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Approx. Required Margin:
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {priceRupees > 0
                ? `₹${estimatedTotalRupees.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : "At Market Price"}
            </Typography>
          </Box>

          <Alert severity="info" sx={{ fontSize: "0.8rem" }}>
            Order execution will be fully integrated in <strong>Milestone 5.6</strong> with the
            backend practice account margin engine.
          </Alert>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, justifyContent: "space-between" }}>
          <Button onClick={closeActionWindows} color="inherit" size="small">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            size="small"
            sx={{
              bgcolor: isBuy ? "#2563EB" : "#EA580C",
              ":hover": { bgcolor: isBuy ? "#1D4ED8" : "#C2410C" },
              px: 3,
            }}
          >
            {isBuy ? "Place Buy Order" : "Place Sell Order"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default OrderActionWindow;
