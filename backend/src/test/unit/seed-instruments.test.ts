import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import {
  buildNseInstrumentSeedCatalog,
  INSTRUMENT_SECTOR_METADATA,
  InstrumentSeedRecord,
  SYNTHETIC_NSE_INSTRUMENTS_SEED,
} from "../../../scripts/data/instruments.seed";
import {
  formatPaiseToRupees,
  parseSeedCliArgs,
  runInstrumentSeed,
  validateInstrumentCatalog,
} from "../../../scripts/seed-instruments";

describe("Milestone 3 — Synthetic NSE Instrument Catalog & Seed Validation (Unit)", () => {
  it("contains exactly 50 NSE equity instruments covering all 10 major sectors", () => {
    assert.equal(
      SYNTHETIC_NSE_INSTRUMENTS_SEED.length,
      50,
      "Expected exactly 50 instruments in the synthetic NSE catalog"
    );

    const report = validateInstrumentCatalog(SYNTHETIC_NSE_INSTRUMENTS_SEED);
    assert.equal(report.valid, true, `Validation errors: ${report.errors.join(", ")}`);
    assert.equal(report.totalCount, 50);
    assert.equal(report.uniqueExchangeSymbolCount, 50);

    const sectors = Object.keys(report.sectorBreakdown);
    assert.equal(sectors.length, 10, "Expected 10 distinct sector categories");
    for (const item of SYNTHETIC_NSE_INSTRUMENTS_SEED) {
      assert.ok(
        INSTRUMENT_SECTOR_METADATA[item.symbol],
        `Missing sector metadata for ${item.symbol}`
      );
    }
  });

  it("enforces unique exchange/symbol pairs, valid company names, and NSE-only exchange without market indexes", () => {
    const seenPairs = new Set<string>();
    const forbiddenIndexSymbols = new Set(["NIFTY", "NIFTY50", "NIFTY 50", "SENSEX", "BANKNIFTY"]);

    for (const item of SYNTHETIC_NSE_INSTRUMENTS_SEED) {
      assert.equal(item.exchange, "NSE", `Expected NSE exchange for ${item.symbol}`);
      assert.equal(item.isTradable, true, `Expected isTradable=true for ${item.symbol}`);
      assert.ok(
        !forbiddenIndexSymbols.has(item.symbol),
        `Index symbol ${item.symbol} must not be seeded as an ordinary equity`
      );
      assert.ok(
        /^[A-Z0-9&-]{1,20}$/.test(item.symbol),
        `Invalid symbol format: ${item.symbol}`
      );
      assert.ok(
        item.name.trim().length >= 3 && item.name.length <= 120,
        `Invalid company name for ${item.symbol}: ${item.name}`
      );

      const pair = `${item.exchange}:${item.symbol}`;
      assert.ok(!seenPairs.has(pair), `Duplicate exchange/symbol pair detected: ${pair}`);
      seenPairs.add(pair);
    }
  });

  it("enforces positive safe-integer paise prices, bid <= ask spread, and valid timestamps", () => {
    for (const item of SYNTHETIC_NSE_INSTRUMENTS_SEED) {
      const priceFields = [
        item.lastPricePaise,
        item.bidPricePaise,
        item.askPricePaise,
        item.previousClosePaise,
      ];

      for (const price of priceFields) {
        assert.equal(typeof price, "number");
        assert.ok(
          Number.isSafeInteger(price) && price > 0,
          `Price ${price} for ${item.symbol} must be a positive safe integer in paise`
        );
      }

      assert.ok(
        item.bidPricePaise <= item.askPricePaise,
        `bidPricePaise (${item.bidPricePaise}) > askPricePaise (${item.askPricePaise}) for ${item.symbol}`
      );

      assert.ok(
        item.bidPricePaise <= item.lastPricePaise &&
          item.lastPricePaise <= item.askPricePaise,
        `lastPricePaise (${item.lastPricePaise}) should sit within initial bid-ask spread [${item.bidPricePaise}, ${item.askPricePaise}] for ${item.symbol}`
      );

      assert.ok(
        item.priceUpdatedAt instanceof Date && !Number.isNaN(item.priceUpdatedAt.getTime()),
        `Invalid priceUpdatedAt Date for ${item.symbol}`
      );
    }
  });

  it("designates 15 starter watchlist instruments and passes strict Mongoose schema validation", () => {
    const starterItems = SYNTHETIC_NSE_INSTRUMENTS_SEED.filter(
      (item) => item.isStarterWatchlist
    );
    assert.equal(
      starterItems.length,
      15,
      "Expected 15 starter watchlist instruments (within the 10–15 target range)"
    );
    assert.ok(starterItems.length >= 10 && starterItems.length <= 15);

    // Verify every seed record passes InstrumentModel strict validation with no extra fields
    for (const item of SYNTHETIC_NSE_INSTRUMENTS_SEED) {
      const doc = new InstrumentModel(item);
      const err = doc.validateSync();
      assert.equal(err, undefined, `Mongoose schema validation failed for ${item.symbol}: ${err?.message}`);
    }
  });

  it("rejects malformed catalog entries (duplicate symbols, bid > ask, floats, negative values)", () => {
    const baseValid = buildNseInstrumentSeedCatalog(new Date("2026-11-16T10:00:00.000Z"))[0];

    const malformedCatalog: InstrumentSeedRecord[] = [
      baseValid,
      // Duplicate exchange + symbol
      { ...baseValid },
      // Bid > Ask
      {
        ...baseValid,
        symbol: "BADSPREAD",
        bidPricePaise: 260000,
        askPricePaise: 250000,
      },
      // Floating point price
      {
        ...baseValid,
        symbol: "FLOATPRICE",
        lastPricePaise: 1250.5,
      },
      // Negative price
      {
        ...baseValid,
        symbol: "NEGPRICE",
        previousClosePaise: -100,
      },
    ];

    const report = validateInstrumentCatalog(malformedCatalog);
    assert.equal(report.valid, false);
    assert.ok(report.errors.some((e) => e.includes("Duplicate exchange/symbol pair")));
    assert.ok(report.errors.some((e) => e.includes("bidPricePaise (260000) must not exceed askPricePaise (250000)")));
    assert.ok(report.errors.some((e) => e.includes("lastPricePaise (1250.5) must be a positive safe integer")));
    assert.ok(report.errors.some((e) => e.includes("previousClosePaise (-100) must be a positive safe integer")));
  });

  it("parses CLI flags safely (defaults to dry-run, supports --apply, rejects conflicting flags)", () => {
    assert.equal(parseSeedCliArgs([]), "dry-run");
    assert.equal(parseSeedCliArgs(["--dry-run"]), "dry-run");
    assert.equal(parseSeedCliArgs(["--apply"]), "apply");
    assert.throws(
      () => parseSeedCliArgs(["--dry-run", "--apply"]),
      /Cannot specify both '--dry-run' and '--apply'/
    );

    assert.equal(formatPaiseToRupees(254000), "₹2,540.00");
    assert.equal(formatPaiseToRupees(1215000), "₹12,150.00");
  });

  it("enforces target safety guards against production or non-Nivora databases", async () => {
    await assert.rejects(
      async () => {
        await runInstrumentSeed({
          mode: "dry-run",
          config: {
            nodeEnv: "production",
            isProduction: true,
            port: 5000,
            mongoUrl: "mongodb+srv://user:pass@cluster.mongodb.net/Nivora?retryWrites=true&w=majority",
            frontendUrl: "https://app.nivora.in",
            dashboardUrl: "https://dashboard.nivora.in",
            allowedOrigins: ["https://app.nivora.in", "https://dashboard.nivora.in"],
            otpSecret: "secret32charsminimum_1234567890!",
            brevoApiKey: "mock-key",
            brevoSenderEmail: "noreply@nivora.in",
            brevoSenderName: "NIVORA",
            jwtAccessSecret: "secret32charsminimum_1234567890!",
            jwtIssuer: "nivora-api",
            jwtAudience: "nivora-client",
          },
          verbose: false,
        });
      },
      { message: /NODE_ENV must be 'development'/ }
    );

    await assert.rejects(
      async () => {
        await runInstrumentSeed({
          mode: "apply",
          config: {
            nodeEnv: "development",
            isProduction: false,
            port: 5000,
            mongoUrl: "mongodb+srv://user:pass@cluster.mongodb.net/zerodha?retryWrites=true&w=majority",
            frontendUrl: "http://localhost:3000",
            dashboardUrl: "http://localhost:3001",
            allowedOrigins: ["http://localhost:3000", "http://localhost:3001"],
            otpSecret: "secret32charsminimum_1234567890!",
            brevoApiKey: "mock-key",
            brevoSenderEmail: "noreply@nivora.in",
            brevoSenderName: "NIVORA",
            jwtAccessSecret: "secret32charsminimum_1234567890!",
            jwtIssuer: "nivora-api",
            jwtAudience: "nivora-client",
          },
          verbose: false,
        });
      },
      { message: /MONGO_URL database path must be exactly '\/Nivora'/ }
    );
  });
});
