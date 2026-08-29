import { describe, it, expect } from "vitest";
import {
  emailSchema,
  otpCodeSchema,
  secretCodeSchema,
  diaryTitleSchema,
  diaryContentSchema,
  moodNoteSchema,
  chatMessageSchema,
} from "./validation";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse("alice@example.com").success).toBe(true);
  });
  it("rejects a missing email", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
  });
  it("rejects a malformed email", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
  it("trims surrounding whitespace", () => {
    const result = emailSchema.safeParse("  alice@example.com  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("alice@example.com");
  });
});

describe("otpCodeSchema", () => {
  it("accepts a 6-digit code", () => {
    expect(otpCodeSchema.safeParse("123456").success).toBe(true);
  });
  it("rejects a 5-digit code", () => {
    expect(otpCodeSchema.safeParse("12345").success).toBe(false);
  });
  it("rejects a code containing letters", () => {
    expect(otpCodeSchema.safeParse("12345a").success).toBe(false);
  });
});

describe("secretCodeSchema", () => {
  it("accepts a non-empty code", () => {
    expect(secretCodeSchema.safeParse("AAAA-BBBB-CCCC-DDDD-EEEE-FF").success).toBe(true);
  });
  it("rejects an empty code", () => {
    expect(secretCodeSchema.safeParse("").success).toBe(false);
  });
  it("rejects an absurdly long input", () => {
    expect(secretCodeSchema.safeParse("x".repeat(100)).success).toBe(false);
  });
});

describe("diaryTitleSchema", () => {
  it("accepts undefined (title is optional)", () => {
    expect(diaryTitleSchema.safeParse(undefined).success).toBe(true);
  });
  it("accepts a normal title", () => {
    expect(diaryTitleSchema.safeParse("A quiet afternoon").success).toBe(true);
  });
  it("rejects a title over 200 characters", () => {
    expect(diaryTitleSchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});

describe("diaryContentSchema", () => {
  it("rejects empty content", () => {
    expect(diaryContentSchema.safeParse("").success).toBe(false);
  });
  it("rejects whitespace-only content", () => {
    expect(diaryContentSchema.safeParse("   ").success).toBe(false);
  });
  it("accepts normal content", () => {
    expect(diaryContentSchema.safeParse("Today was quiet.").success).toBe(true);
  });
  it("rejects content over 50,000 characters, matching the DB CHECK constraint", () => {
    expect(diaryContentSchema.safeParse("x".repeat(50001)).success).toBe(false);
  });
  it("accepts content at exactly the 50,000-character limit", () => {
    expect(diaryContentSchema.safeParse("x".repeat(50000)).success).toBe(true);
  });
});

describe("moodNoteSchema", () => {
  it("accepts undefined (note is optional)", () => {
    expect(moodNoteSchema.safeParse(undefined).success).toBe(true);
  });
  it("rejects a note over 2,000 characters", () => {
    expect(moodNoteSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  it("rejects an empty message", () => {
    expect(chatMessageSchema.safeParse("").success).toBe(false);
  });
  it("accepts a normal message", () => {
    expect(chatMessageSchema.safeParse("hello").success).toBe(true);
  });
  it("rejects a message over 4,000 characters, matching the DB CHECK constraint", () => {
    expect(chatMessageSchema.safeParse("x".repeat(4001)).success).toBe(false);
  });
});
