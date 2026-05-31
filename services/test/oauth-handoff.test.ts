import { describe, expect, it } from "vitest";
import { signState, verifyState } from "../auth/jwt.js";
import { buildWebHandoffUrl } from "../auth/google.js";

// Pure (network-free, DB-free) coverage for the Google OAuth web hand-off:
// the state token carries the client mode, and the callback builds a fragment
// redirect URL for the web flow.

describe("OAuth state mode", () => {
  const secret = "test-secret";

  it("round-trips the web mode through the state token", async () => {
    const token = await signState(secret, "nonce-1", "web");
    const claims = await verifyState(secret, token);
    expect(claims).toMatchObject({ nonce: "nonce-1", mode: "web" });
  });

  it("defaults to json mode when unspecified", async () => {
    const claims = await verifyState(secret, await signState(secret, "nonce-2"));
    expect(claims?.mode).toBe("json");
  });

  it("returns null for a token signed with a different secret", async () => {
    expect(await verifyState("other", await signState(secret, "n", "web"))).toBeNull();
  });
});

describe("buildWebHandoffUrl", () => {
  const tokens = { accessToken: "acc.123", refreshToken: "ref-456" };

  it("puts the token pair in the URL fragment of the SPA callback", () => {
    const url = buildWebHandoffUrl("http://localhost:3001", tokens);
    expect(url.split("#")[0]).toBe("http://localhost:3001/auth/google/callback");
    const frag = new URLSearchParams(url.split("#")[1]);
    expect(frag.get("accessToken")).toBe("acc.123");
    expect(frag.get("refreshToken")).toBe("ref-456");
    // The query string is empty — tokens live only in the fragment.
    expect(url).not.toContain("?");
  });

  it("uses the first origin and strips a trailing slash", () => {
    const url = buildWebHandoffUrl("https://app.example.com/, https://other.test", tokens);
    expect(url.startsWith("https://app.example.com/auth/google/callback#")).toBe(true);
  });

  it("rejects a wildcard or empty origin (no concrete redirect target)", () => {
    expect(() => buildWebHandoffUrl("*", tokens)).toThrow();
    expect(() => buildWebHandoffUrl("", tokens)).toThrow();
  });
});
