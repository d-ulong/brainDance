import "@/app/globals.css";

import type { Metadata } from "next";

import { ThemeBootstrapScript } from "@/components/ui/theme-bootstrap";

export const metadata: Metadata = {
  title: "BrainDance",
  description: "家庭学习与认知训练",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="space" suppressHydrationWarning>
      <head>
        <ThemeBootstrapScript />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
