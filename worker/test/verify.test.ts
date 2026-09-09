import { describe, it, expect } from "vitest";
import { readHeaders, verifySignature, isFresh } from "../src/verify";

const SECRET = "a".repeat(64);

async function sign(secret: string, timestamp: string, eventId: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${eventId}.${rawBody}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("readHeaders", () => {
  it("returns the three Elfa headers", () => {
    const h = new Headers({
      "X-Auto-Event-Id": "42",
      "X-Auto-Signature-Timestamp": "1775035200",
      "X-Auto-Signature": "v1=deadbeef",
    });
    expect(readHeaders(h)).toEqual({ eventId: "42", timestamp: "1775035200", signature: "v1=deadbeef" });
  });

  it("returns null when any header is missing", () => {
    const h = new Headers({ "X-Auto-Event-Id": "42", "X-Auto-Signature": "v1=deadbeef" });
    expect(readHeaders(h)).toBeNull();
  });
});

describe("verifySignature", () => {
  const parts = { eventId: "42", timestamp: "1775035200", rawBody: '{"id":42}' };

  it("accepts a correct signature", async () => {
    const hex = await sign(SECRET, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: `v1=${hex}` })).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    const hex = await sign("b".repeat(64), parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: `v1=${hex}` })).toBe(false);
  });

  it("rejects when the body was tampered with after signing", async () => {
    const hex = await sign(SECRET, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, rawBody: '{"id":43}', signature: `v1=${hex}` })).toBe(false);
  });

  it("rejects a missing v1= prefix", async () => {
    const hex = await sign(SECRET, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: hex })).toBe(false);
  });

  it("rejects a malformed hex payload", async () => {
    expect(await verifySignature(SECRET, { ...parts, signature: "v1=zzzz" })).toBe(false);
  });

  it("does NOT accept a signature made with a pre-hashed secret", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET));
    const hashedSecret = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hex = await sign(hashedSecret, parts.timestamp, parts.eventId, parts.rawBody);
    expect(await verifySignature(SECRET, { ...parts, signature: `v1=${hex}` })).toBe(false);
  });
});

describe("isFresh", () => {
  const now = 1775035200;
  it("accepts a timestamp inside the window", () => {
    expect(isFresh(String(now - 29), now)).toBe(true);
    expect(isFresh(String(now + 29), now)).toBe(true);
  });
  it("rejects a timestamp outside the window in either direction", () => {
    expect(isFresh(String(now - 31), now)).toBe(false);
    expect(isFresh(String(now + 31), now)).toBe(false);
  });
  it("rejects a non-numeric timestamp", () => {
    expect(isFresh("not-a-number", now)).toBe(false);
  });
});
