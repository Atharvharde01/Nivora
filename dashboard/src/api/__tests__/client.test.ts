import {
  apiClient,
  setTokenGetter,
  setOnUnauthorized,
  DEFAULT_API_URL,
  API_TIMEOUT_MS,
} from "../client";

describe("API Client Configuration & Interceptors", () => {
  afterEach(() => {
    setTokenGetter(() => null);
    setOnUnauthorized(() => {});
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
});
