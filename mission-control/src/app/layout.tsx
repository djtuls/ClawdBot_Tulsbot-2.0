import type { Metadata } from "next";
import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Tulsbot Mission Control",
  description: "Local-first operations dashboard for Tulsbot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <Shell>{children}</Shell>
        </ErrorBoundary>
      </body>
    </html>
  );
}
