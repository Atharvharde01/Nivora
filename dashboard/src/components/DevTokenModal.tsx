/**
 * NIVORA Trading Platform — Dev Token Management Modal
 * Permits entry or revocation of a temporary JWT Bearer token in React memory.
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
import { VpnKey, DeleteOutline, CheckCircle, WarningAmber } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";

export const DevTokenModal: React.FC = () => {
  const { token, isAuthenticated, setToken, clearToken, isTokenModalOpen, closeTokenModal } =
    useAuth();

  const [inputToken, setInputToken] = useState<string>("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleApply = () => {
    if (!inputToken.trim()) {
      setFeedback("Please enter a valid JWT token string.");
      return;
    }
    setToken(inputToken.trim());
    setInputToken("");
    setFeedback("Token applied to in-memory session.");
    setTimeout(() => {
      setFeedback(null);
      closeTokenModal();
    }, 800);
  };

  const handleClear = () => {
    clearToken();
    setInputToken("");
    setFeedback("Token cleared from in-memory session.");
    setTimeout(() => {
      setFeedback(null);
    }, 1200);
  };

  return (
    <Dialog
      open={isTokenModalOpen}
      onClose={closeTokenModal}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <VpnKey sx={{ color: "#2563EB" }} />
        <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
          Developer Session Token
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ py: 2 }}>
        <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Session Status:
          </Typography>
          {isAuthenticated ? (
            <Chip
              icon={<CheckCircle sx={{ fontSize: 16 }} />}
              label="Active (In-Memory)"
              color="success"
              size="small"
              sx={{ fontWeight: 500 }}
            />
          ) : (
            <Chip
              icon={<WarningAmber sx={{ fontSize: 16 }} />}
              label="No Token Configured"
              color="default"
              size="small"
              sx={{ fontWeight: 500 }}
            />
          )}
        </Box>

        <Alert severity="info" sx={{ mb: 2, fontSize: "0.82rem" }}>
          This token is stored strictly in <strong>React volatile memory</strong>. It is never
          written to <code>localStorage</code>, <code>sessionStorage</code>, or cookies, and will be
          cleared when the page is reloaded.
        </Alert>

        {feedback && (
          <Alert severity="success" sx={{ mb: 2, py: 0.5, fontSize: "0.82rem" }}>
            {feedback}
          </Alert>
        )}

        {isAuthenticated && (
          <Box
            sx={{
              p: 1.5,
              mb: 2,
              bgcolor: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              Active Token (Truncated):
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily: "monospace",
                wordBreak: "break-all",
                color: "#1e293b",
                fontSize: "0.78rem",
              }}
            >
              {token?.slice(0, 24)}...{token?.slice(-16)}
            </Typography>
          </Box>
        )}

        <TextField
          label="Paste JWT Bearer Token"
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          fullWidth
          multiline
          rows={3}
          value={inputToken}
          onChange={(e) => setInputToken(e.target.value)}
          variant="outlined"
          size="small"
          helperText="Obtained from backend /auth/login or test fixtures"
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: "space-between" }}>
        {isAuthenticated ? (
          <Button
            onClick={handleClear}
            color="error"
            variant="outlined"
            size="small"
            startIcon={<DeleteOutline />}
          >
            Clear Token
          </Button>
        ) : (
          <Box />
        )}

        <Box sx={{ display: "flex", gap: 1 }}>
          <Button onClick={closeTokenModal} color="inherit" size="small">
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            variant="contained"
            size="small"
            disabled={!inputToken.trim()}
            sx={{
              backgroundColor: "#2563EB",
              ":hover": { backgroundColor: "#1D4ED8" },
            }}
          >
            Apply Token
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default DevTokenModal;
