import { z } from "zod";

// Client-side validation is for user experience only. Every one
// of these has an independent server-side enforcement point
// (a CHECK constraint, a function's own validation, or both) —
// see supabase/migrations. Never assume this file is the
// security boundary.

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address")
  .max(320, "Email address is too long")
  .email("Enter a valid email address");

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your email");

export const secretCodeSchema = z
  .string()
  .trim()
  .min(1, "Enter the code")
  .max(64, "That code is too long");

export const diaryTitleSchema = z
  .string()
  .trim()
  .max(200, "Title is too long")
  .optional();

export const diaryContentSchema = z
  .string()
  .trim()
  .min(1, "Write something before saving")
  .max(50000, "This entry is too long");

export const moodNoteSchema = z.string().trim().max(2000, "Note is too long").optional();

export const chatMessageSchema = z
  .string()
  .trim()
  .min(1, "Message cannot be empty")
  .max(4000, "Message is too long");
