import type { Metadata } from "next";
import "./globals.css";

// TODO: replace [APP NAME] once the product name is final.
export const metadata: Metadata = {
  title: "[APP NAME]",
  description:
    "Every way to get between two places in the USA without flying: intercity bus, train, ferry, and local transit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
