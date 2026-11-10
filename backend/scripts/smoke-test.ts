/**
 * NIVORA Backend — Automated Deployment Smoke Test Runner
 *
 * Verifies end-to-end API health, authentication, quotes, order execution,
 * idempotency, portfolio valuation, and exact paise ledger reconciliation.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts
 *   TARGET_URL=https://api.nivora.in SMOKE_AUTH_TOKEN=... npx tsx scripts/smoke-test.ts
 */

export interface SmokeTestStageResult {
  stage: string;
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

export interface SmokeTestReport {
  targetUrl: string;
  timestamp: string;
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
  results: SmokeTestStageResult[];
}

export interface RunSmokeOptions {
  targetUrl?: string;
  authToken?: string;
  verbose?: boolean;
}

export async function runSmokeSuite(
  options: RunSmokeOptions = {}
): Promise<SmokeTestReport> {
  const targetUrl = (
    options.targetUrl ||
    process.env.TARGET_URL ||
    process.env.SMOKE_TEST_URL ||
    "http://localhost:3002"
  ).replace(/\/+$/, "");

  let authToken = options.authToken || process.env.SMOKE_AUTH_TOKEN;
  const verbose = options.verbose ?? true;
  const results: SmokeTestStageResult[] = [];
  const suiteStartTime = Date.now();

  const recordResult = (
    stage: string,
    name: string,
    passed: boolean,
    durationMs: number,
    details?: string,
    error?: string
  ) => {
    results.push({ stage, name, passed, durationMs, details, error });
    if (verbose) {
      const statusSymbol = passed ? "✔" : "✖";
      const statusLabel = passed ? "PASS" : "FAIL";
      const timing = `(${durationMs.toFixed(1)}ms)`;
      console.log(
        `  ${statusSymbol} [${stage}] ${name} -> ${statusLabel} ${timing}`
      );
      if (!passed && error) {
        console.error(`      Error: ${error}`);
      }
      if (details) {
        console.log(`      ${details}`);
      }
    }
  };

  const runStep = async (
    stage: string,
    name: string,
    stepFn: () => Promise<string | void>
  ): Promise<boolean> => {
    const start = Date.now();
    try {
      const details = await stepFn();
      recordResult(stage, name, true, Date.now() - start, details || undefined);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      recordResult(stage, name, false, Date.now() - start, undefined, message);
      return false;
    }
  };

  if (verbose) {
    console.log("=========================================================");
    console.log(`  NIVORA DEPLOYMENT SMOKE TEST RUNNER`);
    console.log(`  Target: ${targetUrl}`);
    console.log(`  Time:   ${new Date().toISOString()}`);
    console.log("=========================================================\n");
  }

  // ==========================================
  // STAGE 1: HEALTH & READINESS PROBES
  // ==========================================
  await runStep("1. Health", "Process Liveness (/health/live)", async () => {
    const res = await fetch(`${targetUrl}/health/live`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.status !== "OK") throw new Error(`Unexpected status: ${json.status}`);
    return `Process uptime: ${json.uptime?.toFixed(1)}s`;
  });

  await runStep("1. Health", "Database Readiness (/health/ready)", async () => {
    const res = await fetch(`${targetUrl}/health/ready`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.status !== "OK" || json.database !== "connected") {
      throw new Error(`DB status: ${json.database}`);
    }
    return "MongoDB connected & ping succeeded";
  });

  await runStep("1. Health", "Uptime Monitor Ping (/health)", async () => {
    const res = await fetch(`${targetUrl}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.status !== "OK") throw new Error(`Ping failed: ${json.status}`);
    return "5m monitor probe OK";
  });

  // ==========================================
  // STAGE 2: API SPECIFICATION VERIFICATION
  // ==========================================
  await runStep("2. Docs", "OpenAPI Spec Endpoint (/docs/openapi.yaml or /docs/openapi.json)", async () => {
    // If OpenAPI / Swagger is enabled on target, check it. If disabled in prod, ensure safe 404
    const res = await fetch(`${targetUrl}/docs/openapi.json`);
    if (res.status === 200) {
      const json = await res.json();
      if (json.openapi !== "3.1.0") throw new Error(`Unexpected OpenAPI version: ${json.openapi}`);
      return "OpenAPI 3.1.0 spec verified";
    } else if (res.status === 404) {
      return "Swagger docs safely disabled in production (404 expected)";
    } else {
      throw new Error(`Unexpected docs response: HTTP ${res.status}`);
    }
  });

  // ==========================================
  // STAGE 3: AUTHENTICATION CHECK
  // ==========================================
  let authenticatedUserId: string | null = null;
  if (!authToken) {
    await runStep("3. Auth", "Email OTP Dispatch (/auth/otp/request)", async () => {
      const res = await fetch(`${targetUrl}/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "smoke.test.trader@nivora.in" }),
      });
      if (res.status === 200) {
        return "OTP request accepted. Pending manual verification code in live env.";
      } else if (res.status === 429) {
        return "OTP rate limit active (abuse protection verified)";
      } else {
        throw new Error(`OTP dispatch returned HTTP ${res.status}: ${await res.text()}`);
      }
    });
  } else {
    await runStep("3. Auth", "Verify Session Identity (/auth/me)", async () => {
      const res = await fetch(`${targetUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const json = await res.json();
      if (!json.success || !json.user?.id) {
        throw new Error("Invalid /auth/me payload");
      }
      authenticatedUserId = json.user.id;
      return `Authenticated as: ${json.user.email} (${authenticatedUserId})`;
    });
  }

  // ==========================================
  // STAGE 4: MARKET DATA & QUOTES
  // ==========================================
  let testInstrumentId: string | null = null;
  let testSymbol: string = "RELIANCE";
  let askPricePaise: number = 0;
  let bidPricePaise: number = 0;

  if (authToken) {
    await runStep("4. Market", "List Tradable Instruments (/api/v1/instruments)", async () => {
      const res = await fetch(`${targetUrl}/api/v1/instruments?limit=5`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data?.items) || json.data.items.length === 0) {
        throw new Error("No instruments returned");
      }
      const first = json.data.items[0];
      testInstrumentId = first._id;
      testSymbol = first.symbol;
      return `Found ${json.data.items.length} instruments. Using ${testSymbol} (${testInstrumentId})`;
    });

    if (testInstrumentId) {
      await runStep("4. Market", `Fetch Quote Snapshot for ${testSymbol}`, async () => {
        const res = await fetch(`${targetUrl}/api/v1/instruments/${testInstrumentId}/quote`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const json = await res.json();
        const quote = json.data?.quote;
        if (!quote || typeof quote.askPricePaise !== "number" || typeof quote.bidPricePaise !== "number") {
          throw new Error("Malformed quote snapshot");
        }
        askPricePaise = quote.askPricePaise;
        bidPricePaise = quote.bidPricePaise;
        if (bidPricePaise > askPricePaise) {
          throw new Error(`Spread invariant violated: bid (${bidPricePaise}) > ask (${askPricePaise})`);
        }
        return `Bid: ₹${(bidPricePaise / 100).toFixed(2)} | Ask: ₹${(askPricePaise / 100).toFixed(2)} (paise: ${bidPricePaise}/${askPricePaise})`;
      });
    }

    // ==========================================
    // STAGE 5: TRADING & IDEMPOTENCY
    // ==========================================
    if (testInstrumentId) {
      const idempotencyKey = `smoke-test-order-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      let orderExecutionPricePaise = 0;

      await runStep("5. Trading", "Execute Simulated BUY Order (/api/v1/orders)", async () => {
        const res = await fetch(`${targetUrl}/api/v1/orders`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            instrumentId: testInstrumentId,
            side: "BUY",
            quantity: 1,
          }),
        });
        if (res.status !== 201) {
          throw new Error(`Order placement HTTP ${res.status}: ${await res.text()}`);
        }
        const json = await res.json();
        if (json.data?.status !== "EXECUTED") {
          throw new Error(`Order status was ${json.data?.status}: ${json.data?.rejectionReason}`);
        }
        orderExecutionPricePaise = json.data.order.executionPricePaise;
        if (orderExecutionPricePaise !== askPricePaise) {
          throw new Error(`BUY price mismatch: got ${orderExecutionPricePaise}, expected ask ${askPricePaise}`);
        }
        return `BUY 1 ${testSymbol} executed at ask ₹${(orderExecutionPricePaise / 100).toFixed(2)}`;
      });

      await runStep("5. Trading", "Verify Idempotent Replay Rejection Protection", async () => {
        const res = await fetch(`${targetUrl}/api/v1/orders`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            instrumentId: testInstrumentId,
            side: "BUY",
            quantity: 1,
          }),
        });
        if (res.status !== 200) {
          throw new Error(`Replay expected HTTP 200, got ${res.status}`);
        }
        const json = await res.json();
        if (!json.data?.wasIdempotentReplay) {
          throw new Error("wasIdempotentReplay was not true");
        }
        return "Idempotent replay verified with exact cached response";
      });
    }

    // ==========================================
    // STAGE 6: PORTFOLIO & RECONCILIATION AUDIT
    // ==========================================
    let activeAccountId: string | null = null;
    let reportedCashBalancePaise: number = 0;

    await runStep("6. Portfolio", "Portfolio Valuation Check (/api/v1/portfolio)", async () => {
      const res = await fetch(`${targetUrl}/api/v1/portfolio`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const json = await res.json();
      const summary = json.data?.summary;
      if (!summary) throw new Error("Portfolio summary missing");
      reportedCashBalancePaise = summary.cashBalancePaise;
      activeAccountId = json.data.practiceAccountId;
      return `Cash balance: ₹${(reportedCashBalancePaise / 100).toFixed(2)} | Active positions: ${summary.activePositionsCount}`;
    });

    if (activeAccountId) {
      await runStep("6. Ledger Audit", "Mathematical Cash Ledger Reconciliation", async () => {
        const res = await fetch(`${targetUrl}/api/v1/accounts/${activeAccountId}/ledger?limit=100`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const json = await res.json();
        const entries = json.data?.items;
        if (!Array.isArray(entries) || entries.length === 0) {
          throw new Error("Ledger entries not found");
        }

        // Sort ascending by creation time to audit running balance
        const sorted = [...entries].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        let runningPaise = 0;
        for (const entry of sorted) {
          if (entry.direction === "CREDIT") {
            runningPaise += entry.amountPaise;
          } else if (entry.direction === "DEBIT") {
            runningPaise -= entry.amountPaise;
          }
          if (runningPaise !== entry.balanceAfterPaise) {
            throw new Error(
              `Ledger sequence violation on entry ${entry._id}: calculated ${runningPaise} !== balanceAfter ${entry.balanceAfterPaise}`
            );
          }
        }

        if (runningPaise !== reportedCashBalancePaise) {
          throw new Error(
            `Final ledger balance (${runningPaise} paise) does not match active account cash balance (${reportedCashBalancePaise} paise)`
          );
        }

        return `Reconciled ${entries.length} entries. Balance matches exact paise: ₹${(runningPaise / 100).toFixed(2)} (${runningPaise} paise)`;
      });
    }
  }

  const totalPassed = results.filter((r) => r.passed).length;
  const totalFailed = results.filter((r) => !r.passed).length;
  const totalDurationMs = Date.now() - suiteStartTime;

  if (verbose) {
    console.log("\n=========================================================");
    console.log(`  SMOKE TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED (${(totalDurationMs / 1000).toFixed(2)}s)`);
    console.log("=========================================================\n");
  }

  return {
    targetUrl,
    timestamp: new Date().toISOString(),
    totalPassed,
    totalFailed,
    totalDurationMs,
    results,
  };
}

// Direct CLI execution
if (process.argv[1]?.includes("smoke-test")) {
  runSmokeSuite()
    .then((report) => {
      if (report.totalFailed > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("FATAL: Smoke runner encountered unhandled error:", err);
      process.exit(1);
    });
}
