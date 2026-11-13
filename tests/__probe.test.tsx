// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "@/app/page";
import { probe } from "@/lib/time/__probe";
test("alias + jsdom + react", () => {
  render(<Home />);
  expect(screen.getByRole("heading").textContent).toBe("[APP NAME]");
  expect(probe).toBe(1);
});
