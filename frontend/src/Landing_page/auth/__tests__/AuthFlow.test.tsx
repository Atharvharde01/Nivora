/**
 * NIVORA Public Website — Unified `/signup` Email OTP Authentication Tests
 * Verifies:
 * - Only `/signup` is used for authentication (no `/login` links, routes, or redirects)
 * - Full Name field appears above Email Address and is compulsory before requesting OTP
 * - Empty Full Name blocks OTP request (disables Get OTP & blocks form submission)
 * - Whitespace-only name is rejected and blocks OTP request
 * - Valid name is preserved between Step 1 and Step 2 and submitted during OTP verification
 * - Email validation, OTP request, OTP verification, resend countdown, resend OTP, and OTP errors
 * - Clean dashboard handoff without URL query tokens or web storage writes
 */

import React from "react";
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Signup from "../../signup/Signup";
import Navbar from "../../Navbar";
import {
  AuthClientError,
  dashboardURL,
  FrontendAuthApi,
} from "../../../api/authClient";
import {
  maskEmailAddress,
  validateDisplayName,
  validateEmailAddress,
} from "../EmailOtpAuthFlow";

describe("Frontend Email OTP Auth Utilities", () => {
  test("validates and normalizes emails cleanly", () => {
    expect(validateEmailAddress("")).toEqual({
      valid: false,
      normalized: "",
      error: "Please enter your email address.",
    });
    expect(validateEmailAddress("   ")).toEqual({
      valid: false,
      normalized: "",
      error: "Please enter your email address.",
    });
    expect(validateEmailAddress("invalid-email").valid).toBe(false);
    expect(validateEmailAddress("user..name@example.com").valid).toBe(false);
    expect(validateEmailAddress("  Trader@Nivora.IN  ")).toEqual({
      valid: true,
      normalized: "trader@nivora.in",
      error: null,
    });
  });

  test("validates displayName requiring non-empty valid Unicode names up to 50 chars", () => {
    expect(validateDisplayName("").valid).toBe(false);
    expect(validateDisplayName("   ").valid).toBe(false);
    expect(validateDisplayName("  Atharv   Harde  ")).toEqual({
      valid: true,
      sanitized: "Atharv Harde",
      error: null,
    });
    expect(validateDisplayName("José García").valid).toBe(true);
    expect(validateDisplayName("अथर्व हर्दे").valid).toBe(true);
    expect(validateDisplayName("A").valid).toBe(false);
    expect(validateDisplayName("atharv@example.com").valid).toBe(false);
    expect(validateDisplayName("Atharv\nHarde").valid).toBe(false);
    expect(validateDisplayName("A".repeat(51)).valid).toBe(false);
  });

  test("masks email address for OTP confirmation screen", () => {
    expect(maskEmailAddress("atharv@example.com")).toMatch(/^at\*+v@example\.com$/);
    expect(maskEmailAddress("ab@example.com")).toBe("a***@example.com");
  });
});

describe("Unified Signup Page (/signup) — Compulsory Full Name & Email OTP Flow", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("renders compulsory Full Name above Email Address, disables Get OTP when name is empty, and has zero /login links", () => {
    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <Navbar />
        <Signup />
      </MemoryRouter>
    );

    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);

    expect(nameInput).toHaveAttribute("placeholder", "Enter your full name");
    expect(nameInput).toBeRequired();
    expect(emailInput).toHaveAttribute("placeholder", "Enter your email address");

    // Full Name MUST appear before Email Address in document order
    expect(
      nameInput.compareDocumentPosition(emailInput) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Get OTP button must be disabled when Full Name is empty
    const getOtpButton = screen.getByRole("button", { name: "Get OTP" });
    expect(getOtpButton).toBeDisabled();

    expect(
      screen.getByText(
        "Required for new accounts. Existing users will continue with their registered name."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Already registered? Enter your email to receive an OTP and sign in."
      )
    ).toBeInTheDocument();

    // Must not contain phone number, password fields, or /login links
    expect(screen.queryByPlaceholderText(/mobile|phone/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /login|sign in/i })).not.toBeInTheDocument();
    const allLinks = screen.getAllByRole("link");
    for (const link of allLinks) {
      expect(link.getAttribute("href")).not.toBe("/login");
    }
  });

  test("empty Full Name and whitespace-only Full Name both block OTP request", async () => {
    const reqSpy = jest.spyOn(FrontendAuthApi, "requestOtp");

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <Signup />
      </MemoryRouter>
    );

    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    const getOtpBtn = screen.getByRole("button", { name: "Get OTP" });

    // Enter valid email while Full Name is empty -> Get OTP remains disabled & form submit is blocked
    fireEvent.change(emailInput, { target: { value: "trader@example.com" } });
    expect(getOtpBtn).toBeDisabled();
    fireEvent.submit(getOtpBtn.closest("form") as HTMLFormElement);
    expect(await screen.findByText("Please enter your full name.")).toBeInTheDocument();
    expect(reqSpy).not.toHaveBeenCalled();

    // Whitespace-only Full Name -> inline rejection & Get OTP stays disabled & form submit blocked
    fireEvent.change(nameInput, { target: { value: "     " } });
    expect(getOtpBtn).toBeDisabled();
    expect(
      screen.getByText("Please enter your full name (cannot be whitespace only).")
    ).toBeInTheDocument();
    fireEvent.submit(getOtpBtn.closest("form") as HTMLFormElement);
    expect(reqSpy).not.toHaveBeenCalled();

    // Email address entered as Full Name -> rejected before API call
    fireEvent.change(nameInput, { target: { value: "user@example.com" } });
    expect(getOtpBtn).not.toBeDisabled();
    fireEvent.click(getOtpBtn);
    expect(
      await screen.findByText(
        /Please enter a valid full name without email addresses or special symbols\./i
      )
    ).toBeInTheDocument();
    expect(reqSpy).not.toHaveBeenCalled();

    // Malformed email with valid name -> rejected before API call
    fireEvent.change(nameInput, { target: { value: "Atharv Harde" } });
    fireEvent.change(emailInput, { target: { value: "not-an-email" } });
    fireEvent.click(getOtpBtn);
    expect(
      await screen.findByText("Please enter a valid email address.")
    ).toBeInTheDocument();
    expect(reqSpy).not.toHaveBeenCalled();
  });

  test("preserves valid name across signup and OTP verification, submits displayName without flow flag, and redirects cleanly", async () => {
    const reqSpy = jest.spyOn(FrontendAuthApi, "requestOtp").mockResolvedValue({
      success: true,
      message: "If the email is valid, a verification code has been sent.",
      resendCooldownSeconds: 60,
    });
    const verifySpy = jest.spyOn(FrontendAuthApi, "verifyOtp").mockResolvedValue({
      success: true,
      isNewUser: true,
      user: {
        id: "user-123",
        userId: "user-123",
        email: "newtrader@example.com",
        displayName: "Atharv Harde",
        status: "ACTIVE",
        onboardingCompleted: false,
      },
      session: {
        id: "sess-123",
        status: "ACTIVE",
        idleExpiresAt: "2026-11-26T00:00:00.000Z",
        absoluteExpiresAt: "2026-12-19T00:00:00.000Z",
      },
      accessToken: "ephemeral-jwt-token",
    });
    const redirectSpy = jest.fn();

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <Signup onRedirect={redirectSpy} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: "  Atharv   Harde  " },
    });
    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: "  NewTrader@Example.com  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Get OTP" }));

    await waitFor(() => {
      // OTP request sends ONLY normalized email (never displayName)
      expect(reqSpy).toHaveBeenCalledWith("newtrader@example.com");
      expect(screen.getByTestId("otp-verification-step")).toBeInTheDocument();
    });

    expect(screen.getByTestId("masked-email")).toHaveTextContent(
      /ne\*+r@example\.com/
    );
    expect(screen.getByTestId("resend-countdown")).toHaveTextContent(
      /Resend OTP in 60 seconds/i
    );

    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toBeDisabled();

    const otpInput = screen.getByLabelText("Enter 6-digit OTP");
    fireEvent.change(otpInput, { target: { value: "12ab3456" } });
    expect(otpInput).toHaveValue("123456");
    expect(continueBtn).not.toBeDisabled();

    fireEvent.click(continueBtn);

    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledWith({
        email: "newtrader@example.com",
        otp: "123456",
        displayName: "Atharv Harde",
        consents: {
          acceptTerms: true,
          acceptPrivacy: true,
          acceptSimulationDisclosure: true,
          termsVersion: "1.0",
          privacyVersion: "1.0",
        },
      });
      expect(redirectSpy).toHaveBeenCalledWith(dashboardURL);
    });

    // Security check: no `flow` key sent, no tokens in redirect URL or web storage
    const sentPayload = verifySpy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(sentPayload.flow).toBeUndefined();

    const redirectedUrl = redirectSpy.mock.calls[0][0] as string;
    expect(redirectedUrl).not.toContain("ephemeral-jwt-token");
    expect(redirectedUrl).not.toContain("token=");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  test("supports change email while preserving entered Full Name, resend countdown, resend OTP action, and OTP error display", async () => {
    jest.useFakeTimers();

    const reqSpy = jest.spyOn(FrontendAuthApi, "requestOtp").mockResolvedValue({
      success: true,
      message: "Verification code sent.",
      resendCooldownSeconds: 3,
    });
    const verifySpy = jest
      .spyOn(FrontendAuthApi, "verifyOtp")
      .mockRejectedValueOnce(
        new AuthClientError(
          "Invalid verification code. 4 attempts remaining.",
          "INVALID_OTP",
          400
        )
      );

    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <Signup />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: "NIVORA Test User" },
    });
    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: "trader@example.com" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Get OTP" }));
    });

    expect(screen.getByTestId("resend-countdown")).toHaveTextContent(
      /Resend OTP in 3 seconds/i
    );

    // Invalid OTP surfaces server error cleanly
    fireEvent.change(screen.getByLabelText("Enter 6-digit OTP"), {
      target: { value: "000000" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy.mock.calls[0][0].displayName).toBe("NIVORA Test User");
    expect(
      screen.getByText(/Invalid verification code\. 4 attempts remaining\./i)
    ).toBeInTheDocument();

    // Advance countdown 3 seconds -> Resend OTP button becomes available
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    const resendBtn = screen.getByRole("button", { name: "Resend OTP" });
    await act(async () => {
      fireEvent.click(resendBtn);
    });
    expect(reqSpy).toHaveBeenCalledTimes(2);

    // Change email returns to Step 1 and preserves entered Full Name
    fireEvent.click(screen.getByRole("button", { name: "(change)" }));
    expect(screen.getByTestId("email-entry-step")).toBeInTheDocument();
    expect(screen.getByLabelText(/Full Name/i)).toHaveValue("NIVORA Test User");
  });
});
