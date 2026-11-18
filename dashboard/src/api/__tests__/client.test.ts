import {
  apiClient,
  setTokenGetter,
  setOnUnauthorized,
  DEFAULT_API_URL,
  API_TIMEOUT_MS,
  WatchlistApi,
  InstrumentsApi,
  OrdersApi,
  PortfolioApi,
  AccountsApi,
} from "../client";

describe("API Client Configuration & Interceptors", () => {
  afterEach(() => {
    setTokenGetter(() => null);
    setOnUnauthorized(() => {});
    jest.restoreAllMocks();
  });

  test("configures default baseURL and timeout", () => {
    expect(apiClient.defaults.baseURL).toBe(DEFAULT_API_URL);
    expect(apiClient.defaults.timeout).toBe(API_TIMEOUT_MS);
  });

  test("injects Bearer token into request headers when token getter returns a token", async () => {
    const mockToken = "mock-jwt-token-12345";
    setTokenGetter(() => mockToken);

    // Test the request interceptor handler directly
    const interceptor = (apiClient.interceptors.request as any).handlers[0];
    const config = {
      headers: {
        set: jest.fn(),
      },
    };

    interceptor.fulfilled(config);
    expect(config.headers.set).toHaveBeenCalledWith(
      "Authorization",
      `Bearer ${mockToken}`
    );
  });

  test("does not set Authorization header when token getter returns null", async () => {
    setTokenGetter(() => null);

    const interceptor = (apiClient.interceptors.request as any).handlers[0];
    const config = {
      headers: {
        set: jest.fn(),
      },
    };

    interceptor.fulfilled(config);
    expect(config.headers.set).not.toHaveBeenCalled();
  });

  test("invokes onUnauthorized handler on 401 response", () => {
    const unauthorizedCallback = jest.fn();
    setOnUnauthorized(unauthorizedCallback);

    const interceptor = (apiClient.interceptors.response as any).handlers[0];
    const error401 = {
      response: {
        status: 401,
      },
    };

    expect(() => interceptor.rejected(error401)).rejects.toBeDefined();
    expect(unauthorizedCallback).toHaveBeenCalled();
  });

  describe("WatchlistApi Endpoints", () => {
    test("getWatchlist calls GET /api/v1/watchlist", async () => {
      const getSpy = jest.spyOn(apiClient, "get").mockResolvedValue({
        data: { success: true, data: { items: [], count: 0 } },
      });

      const res = await WatchlistApi.getWatchlist();
      expect(getSpy).toHaveBeenCalledWith("/api/v1/watchlist");
      expect(res.data?.count).toBe(0);
    });

    test("addItem calls POST /api/v1/watchlist/items with payload", async () => {
      const postSpy = jest.spyOn(apiClient, "post").mockResolvedValue({
        data: {
          success: true,
          data: {
            item: {
              id: "w-1",
              instrumentId: "664000000000000000000010",
              symbol: "RELIANCE",
            },
          },
        },
      });

      await WatchlistApi.addItem("664000000000000000000010");
      expect(postSpy).toHaveBeenCalledWith("/api/v1/watchlist/items", {
        instrumentId: "664000000000000000000010",
      });
    });

    test("removeItem calls DELETE /api/v1/watchlist/items/:instrumentId", async () => {
      const deleteSpy = jest.spyOn(apiClient, "delete").mockResolvedValue({
        data: {
          success: true,
          data: { success: true, removedInstrumentId: "664000000000000000000010" },
        },
      });

      await WatchlistApi.removeItem("664000000000000000000010");
      expect(deleteSpy).toHaveBeenCalledWith(
        "/api/v1/watchlist/items/664000000000000000000010"
      );
    });

    test("reorder calls PATCH /api/v1/watchlist/reorder with payload", async () => {
      const patchSpy = jest.spyOn(apiClient, "patch").mockResolvedValue({
        data: {
          success: true,
          data: { items: [], count: 0 },
        },
      });

      const ids = [
        "664000000000000000000010",
        "664000000000000000000011",
      ];
      await WatchlistApi.reorder(ids);
      expect(patchSpy).toHaveBeenCalledWith("/api/v1/watchlist/reorder", {
        instrumentIds: ids,
      });
    });
  });

  describe("InstrumentsApi Search Endpoints", () => {
    test("search calls GET /api/v1/instruments with params and signal", async () => {
      const controller = new AbortController();
      const getSpy = jest.spyOn(apiClient, "get").mockResolvedValue({
        data: {
          success: true,
          data: { items: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 1 } },
        },
      });

      await InstrumentsApi.search(
        { search: "reliance", isTradable: true, page: 1, limit: 10 },
        { signal: controller.signal }
      );

      expect(getSpy).toHaveBeenCalledWith("/api/v1/instruments", {
        params: { search: "reliance", isTradable: true, page: 1, limit: 10 },
        signal: controller.signal,
      });
    });
  });

  describe("OrdersApi, PortfolioApi & AccountsApi Corrected Endpoints", () => {
    test("OrdersApi.placeOrder sends POST /api/v1/orders with Idempotency-Key header and clean payload", async () => {
      const postSpy = jest.spyOn(apiClient, "post").mockResolvedValue({
        data: {
          success: true,
          data: {
            status: "EXECUTED",
            wasIdempotentReplay: false,
            order: { _id: "ord-1", status: "EXECUTED" },
            trade: { _id: "trd-1" },
          },
        },
      });

      const payload = {
        instrumentId: "664000000000000000000010",
        side: "BUY" as const,
        quantity: 5,
      };
      const idempotencyKey = "test-idempotency-key-12345";

      const res = await OrdersApi.placeOrder(payload, idempotencyKey);
      expect(postSpy).toHaveBeenCalledWith("/api/v1/orders", payload, {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      });
      expect(res.data?.status).toBe("EXECUTED");
    });

    test("OrdersApi.getOrders calls GET /api/v1/orders with query parameters", async () => {
      const getSpy = jest.spyOn(apiClient, "get").mockResolvedValue({
        data: {
          success: true,
          data: { items: [] },
        },
      });

      await OrdersApi.getOrders({ page: 2, limit: 10 });
      expect(getSpy).toHaveBeenCalledWith("/api/v1/orders", {
        params: { page: 2, limit: 10 },
      });
    });

    test("PortfolioApi.getPortfolio calls GET /api/v1/portfolio", async () => {
      const getSpy = jest.spyOn(apiClient, "get").mockResolvedValue({
        data: {
          success: true,
          data: {
            practiceAccountId: "acc-1",
            summary: { cashBalancePaise: 100000000 },
            positions: [],
            activePositionsCount: 0,
          },
        },
      });

      const res = await PortfolioApi.getPortfolio();
      expect(getSpy).toHaveBeenCalledWith("/api/v1/portfolio", {
        params: undefined,
      });
      expect(res.data?.practiceAccountId).toBe("acc-1");
    });

    test("AccountsApi.getActiveAccount calls GET /api/v1/accounts/active", async () => {
      const getSpy = jest.spyOn(apiClient, "get").mockResolvedValue({
        data: {
          success: true,
          data: {
            account: {
              accountId: "acc-1",
              accountNumber: 1001,
              cashBalancePaise: 100000000,
            },
          },
        },
      });

      const res = await AccountsApi.getActiveAccount();
      expect(getSpy).toHaveBeenCalledWith("/api/v1/accounts/active");
      expect(res.data?.account.accountNumber).toBe(1001);
    });
  });
});
