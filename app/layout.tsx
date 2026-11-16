import type { Metadata, Viewport } from "next";
import { Overpass } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { palette } from "@/lib/theme/palette";
import "./globals.css";

// Variable font: one file covers every weight we use.
const overpass = Overpass({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-overpass",
});

// TODO: replace [APP NAME] once the product name is final.
export const metadata: Metadata = {
  title: "[APP NAME]",
  description:
    "Every way to get between two places in the USA without flying: intercity bus, train, ferry, and local transit.",
};

export const viewport: Viewport = {
  themeColor: palette.asphalt,
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={overpass.variable}>
      <body className="bg-asphalt text-ink flex min-h-dvh flex-col font-sans antialiased">
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
