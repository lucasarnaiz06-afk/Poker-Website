import { afterEach, describe, expect, it } from "vitest";
import { getClientIp, getDevRequestOrigin } from "./request";
import { devLinkForRequestOrigin } from "./providers";

const previous = process.env.TRUSTED_PROXY_COUNT;
afterEach(() => {
  if (previous === undefined) delete process.env.TRUSTED_PROXY_COUNT;
  else process.env.TRUSTED_PROXY_COUNT = previous;
});

function headersOf(values: Record<string, string>) {
  return new Headers(values);
}

describe("getClientIp", () => {
  it("ignores forwarding headers when no proxy is trusted", () => {
    delete process.env.TRUSTED_PROXY_COUNT;
    expect(getClientIp(headersOf({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }))).toBeNull();
    process.env.TRUSTED_PROXY_COUNT = "0";
    expect(getClientIp(headersOf({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
  });

  it("takes the Nth entry from the right with N trusted proxies", () => {
    process.env.TRUSTED_PROXY_COUNT = "1";
    expect(getClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(getClientIp(headersOf({ "x-real-ip": "6.6.6.6" }))).toBeNull();

    process.env.TRUSTED_PROXY_COUNT = "2";
    expect(getClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
    // Chain shorter than the configured proxy count: don't trust it.
    expect(getClientIp(headersOf({ "x-forwarded-for": "6.6.6.6" }))).toBeNull();
  });
});

describe("dev email links", () => {
  it("uses the request origin (Origin header, else Host) outside production", () => {
    expect(getDevRequestOrigin(headersOf({ origin: "http://localhost:3000", host: "x" }))).toBe("http://localhost:3000");
    expect(getDevRequestOrigin(headersOf({ host: "192.168.1.5:3000" }))).toBe("http://192.168.1.5:3000");
    expect(getDevRequestOrigin(headersOf({ origin: "javascript:alert(1)" }))).toBeNull();
  });

  it("rewrites magic links and their callbackUrl to the request origin", () => {
    const link =
      "https://tunnel.example/api/auth/callback/email?callbackUrl=https%3A%2F%2Ftunnel.example%2Flobby&token=t&email=a%40b.c";
    const out = new URL(devLinkForRequestOrigin(link, "http://localhost:3000"));
    expect(out.origin).toBe("http://localhost:3000");
    expect(out.pathname).toBe("/api/auth/callback/email");
    expect(out.searchParams.get("callbackUrl")).toBe("http://localhost:3000/lobby");
    expect(out.searchParams.get("token")).toBe("t");
    expect(devLinkForRequestOrigin(link, null)).toBe(link);
  });
});
