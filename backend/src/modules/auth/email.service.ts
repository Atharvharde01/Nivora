import { AuthError } from "./auth.errors";

export interface IEmailDeliveryService {
  sendOtpEmail(toEmail: string, otp: string): Promise<void>;
}

export interface BrevoEmailServiceOptions {
  apiKey: string;
  senderEmail: string;
  senderName?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class BrevoEmailService implements IEmailDeliveryService {
  private readonly apiKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: BrevoEmailServiceOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error("BrevoEmailService requires a valid API key.");
    }
    if (!options.senderEmail || !options.senderEmail.trim()) {
      throw new Error("BrevoEmailService requires a valid sender email address.");
    }

    this.apiKey = options.apiKey.trim();
    this.senderEmail = options.senderEmail.trim();
    this.senderName = (options.senderName || "NIVORA").trim();
    this.timeoutMs = options.timeoutMs ?? 7000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  public async sendOtpEmail(toEmail: string, otp: string): Promise<void> {
    if (!toEmail || !toEmail.trim()) {
      throw new AuthError("INVALID_EMAIL", "Recipient email is required.", 400);
    }
    if (!/^\d{6}$/.test(otp)) {
      throw new AuthError("INVALID_OTP", "Invalid OTP format.", 400);
    }

    const recipient = toEmail.trim().toLowerCase();
    const subject = "Your NIVORA Sign-In Verification Code";

    const textContent = [
      `Your NIVORA verification code is: ${otp}`,
      "",
      "This code is valid for 5 minutes.",
      "Do NOT share this code with anyone. NIVORA will never ask you for your verification code.",
      "If you did not request this verification code, please ignore this email.",
    ].join("\n");

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your NIVORA Verification Code</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 24px; color: #172b4d; }
    .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05); }
    .brand { font-size: 22px; font-weight: 700; color: #0052cc; letter-spacing: -0.5px; margin-bottom: 24px; }
    .code-box { background-color: #f0f4ff; border: 1px solid #cce0ff; border-radius: 6px; padding: 18px; text-align: center; margin: 24px 0; }
    .code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0052cc; font-family: monospace; }
    .warning { font-size: 13px; color: #6b778c; margin-top: 16px; line-height: 1.5; }
    .footer { font-size: 12px; color: #8993a4; margin-top: 32px; border-top: 1px solid #ebecf0; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">NIVORA</div>
    <h2 style="margin-top: 0; font-size: 18px; color: #172b4d;">Sign-In Verification Code</h2>
    <p style="font-size: 14px; line-height: 1.5; color: #344563;">
      Use the following single-use verification code to sign in to your NIVORA practice trading account:
    </p>
    <div class="code-box">
      <span class="code">${otp}</span>
    </div>
    <p class="warning">
      <strong>Security notice:</strong> This code is valid for <strong>5 minutes</strong>. Never share this code with anyone. NIVORA will never ask for your verification code.
    </p>
    <div class="footer">
      If you did not request this sign-in code, you can safely ignore this email.
    </div>
  </div>
</body>
</html>
    `.trim();

    try {
      const response = await this.fetchFn("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: this.senderName,
            email: this.senderEmail,
          },
          to: [
            {
              email: recipient,
            },
          ],
          subject,
          textContent,
          htmlContent,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`Brevo responded with HTTP status ${response.status}`);
      }
    } catch (err: unknown) {
      // Never log raw OTP or API keys. Throw sanitized error.
      const reason = err instanceof Error ? err.message : "Provider request failed";
      throw new AuthError(
        "EMAIL_DELIVERY_FAILED",
        "Failed to deliver verification code. Please try again.",
        502,
        { providerReason: reason }
      );
    }
  }
}

export class MockEmailService implements IEmailDeliveryService {
  public sentEmails: Array<{ toEmail: string; otp: string; sentAt: Date }> = [];
  public shouldFail = false;
  public failureError: Error | null = null;
  public delayMs = 0;

  public async sendOtpEmail(toEmail: string, otp: string): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFail) {
      throw (
        this.failureError ??
        new AuthError(
          "EMAIL_DELIVERY_FAILED",
          "Mock email delivery failed.",
          502
        )
      );
    }

    this.sentEmails.push({
      toEmail: toEmail.trim().toLowerCase(),
      otp,
      sentAt: new Date(),
    });
  }

  public clear(): void {
    this.sentEmails = [];
    this.shouldFail = false;
    this.failureError = null;
    this.delayMs = 0;
  }
}
