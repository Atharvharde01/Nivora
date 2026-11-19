/**
 * NIVORA Trading Platform — Authenticated User Profile Modal
 * Allows users to update their persisted displayName while keeping their verified email read-only.
 * - On successful save: immediately updates AuthContext, invokes onSuccess (outside toast), and auto-closes.
 * - On API or validation error: stays open, preserves user input, shows error message, and allows retry.
 * - Never requests PAN, Aadhaar, phone number, or bank details.
 */

import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Close as CloseIcon, VerifiedUser as VerifiedIcon } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import { AuthUserDto } from "../api/types";
import {
  DISPLAY_NAME_MAX_LENGTH,
  validateDisplayNameInput,
} from "../utils/userDisplay";

export interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (updatedUser: AuthUserDto) => void;
}

function extractProfileErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string } | string }
      | undefined;
    if (typeof data?.error === "string" && data.error.trim()) {
      return data.error;
    }
    if (
      data?.error &&
      typeof data.error === "object" &&
      typeof data.error.message === "string" &&
      data.error.message.trim()
    ) {
      return data.error.message;
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Unable to save your profile right now. Please try again.";
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user, updateUserDisplayName } = useAuth();
  const [nameInput, setNameInput] = useState<string>(user?.displayName ?? "");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const wasOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setNameInput(user?.displayName ?? "");
      setErrorMessage(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, user?.displayName]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSavingRef.current) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingRef.current) {
      return;
    }

    setErrorMessage(null);

    const validation = validateDisplayNameInput(nameInput);
    if (!validation.valid) {
      setErrorMessage(validation.error);
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      const updated = await updateUserDisplayName(validation.sanitized);
      isSavingRef.current = false;
      setIsSaving(false);
      // Notify parent to show outside toast, then auto-close the dialog
      onSuccess?.(updated);
      onClose();
    } catch (err: unknown) {
      // Keep dialog open, preserve user input, show error, allow retry
      isSavingRef.current = false;
      setIsSaving(false);
      setErrorMessage(extractProfileErrorMessage(err));
    }
  };

  return (
    <div
      className="profile-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSavingRef.current) {
          onClose();
        }
      }}
    >
      <div
        className="profile-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        data-testid="profile-modal"
      >
        <div className="profile-modal-header">
          <div>
            <h2 id="profile-modal-title" className="profile-modal-title">
              My Profile
            </h2>
            <p className="profile-modal-subtitle">
              Manage how your name appears across the NIVORA trading dashboard.
            </p>
          </div>
          <button
            type="button"
            className="profile-modal-close"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close profile dialog"
          >
            <CloseIcon sx={{ fontSize: 20 }} />
          </button>
        </div>

        {!user?.displayName && (
          <div className="profile-modal-notice" role="note">
            Set your display name below so NIVORA greets you by name instead of
            your email address.
          </div>
        )}

        {errorMessage && (
          <div className="profile-modal-alert error" role="alert">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="profile-field-group">
            <label htmlFor="profile-full-name" className="profile-field-label">
              Full Name
            </label>
            <input
              id="profile-full-name"
              type="text"
              name="displayName"
              autoComplete="name"
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              placeholder="Enter your full name"
              className="profile-field-input"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              disabled={isSaving}
              autoFocus
            />
          </div>

          <div className="profile-field-group">
            <div className="profile-label-row">
              <label
                htmlFor="profile-email-address"
                className="profile-field-label"
              >
                Email Address
              </label>
              <span
                className="profile-verified-badge"
                data-testid="email-verified-badge"
              >
                <VerifiedIcon sx={{ fontSize: 14 }} />
                Verified
              </span>
            </div>
            <input
              id="profile-email-address"
              type="email"
              value={user?.email ?? ""}
              readOnly
              aria-readonly="true"
              className="profile-field-input readonly"
            />
            <p className="profile-field-hint">
              Your verified email address cannot be modified here.
            </p>
          </div>

          <div className="profile-modal-actions">
            <button
              type="button"
              className="profile-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Close
            </button>
            <button
              type="submit"
              className="profile-btn-primary"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileModal;
