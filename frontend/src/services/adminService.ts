import { supabase } from "../lib/supabaseClient";

import type { FriendlyError } from "./diaryService";

export interface GeneratedSecretCode {
  id: string;
  plaintextCode: string;
  expiresAt: string | null;
}

export interface CodeGenerationStatus {
  remainingCount: number;
  resetsAt: string | null;
}

function toFriendlyError(
  error: { message: string } | null,
): FriendlyError | null {
  if (!error) return null;

  console.error("adminService error:", error);

  return {
    message: "Something went wrong. Please try again.",
  };
}

export async function getCodeGenerationStatus(): Promise<{
  data: CodeGenerationStatus | null;
  error: FriendlyError | null;
}> {
  const { data, error } = await supabase.rpc("admin_code_generation_status");

  if (error) {
    console.error("admin_code_generation_status failed:", error);
    return { data: null, error: toFriendlyError(error) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { data: null, error: { message: "Something went wrong. Please try again." } };
  }

  return {
    data: {
      remainingCount: Number(row.remaining_count),
      resetsAt: row.resets_at ?? null,
    },
    error: null,
  };
}

export async function generateSecretCode(
  expiresInMinutes: number,
): Promise<{
  data: GeneratedSecretCode | null;
  error: FriendlyError | null;
}> {
  const minutes = Math.floor(expiresInMinutes);

  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) {
    return {
      data: null,
      error: {
        message: "Expiry must be between 1 minute and 7 days.",
      },
    };
  }

  const { data, error } = await supabase.rpc(
    "admin_generate_secret_code",
    {
      p_expires_in_minutes: minutes,
    },
  );

  if (error) {
    console.error("admin_generate_secret_code failed:", error);

    return {
      data: null,
      error: toFriendlyError(error),
    };
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return {
      data: null,
      error: {
        message: "Something went wrong. Please try again.",
      },
    };
  }

  return {
    data: {
      id: row.id,
      plaintextCode: row.plaintext_code,
      expiresAt: row.expires_at ?? null,
    },
    error: null,
  };
}
