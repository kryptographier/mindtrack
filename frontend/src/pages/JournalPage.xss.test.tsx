import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JournalPage } from "./JournalPage";

// Mock the service layer so this test doesn't need a real Supabase
// connection — it's testing rendering safety, not data fetching.
vi.mock("../services/diaryService", () => ({
  listDiaryEntries: vi.fn(),
}));

import { listDiaryEntries } from "../services/diaryService";

describe("JournalPage XSS safety", () => {
  it("renders a stored-XSS-shaped payload as literal text, never as executable markup", async () => {
    const maliciousTitle = "<img src=x onerror=alert(1)>";
    const maliciousContent = "<script>alert(1)</script> and some real diary text";

    vi.mocked(listDiaryEntries).mockResolvedValue({
      data: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          user_id: "22222222-2222-2222-2222-222222222222",
          title: maliciousTitle,
          content: maliciousContent,
          mood: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    const { container } = render(
      <MemoryRouter>
        <JournalPage />
      </MemoryRouter>,
    );

    // Wait for the async fetch-and-render to settle.
    await waitFor(() => expect(screen.queryByText(/Loading/i)).toBeNull());

    // The payload must appear as literal visible text...
    expect(container.textContent).toContain(maliciousTitle);
    expect(container.textContent).toContain("alert(1)");

    // ...and must NOT have been parsed into real DOM elements. If
    // dangerouslySetInnerHTML were ever introduced, this specific
    // assertion is what would catch it: a real <script> or <img>
    // element would appear in the DOM tree, not just as escaped text.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();

    // Sanity check on the escaping itself: the raw "<" character
    // from the payload must be encoded in the actual HTML source,
    // not passed through as a real tag delimiter.
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });
});
