import "@/app/globals.css";

import type { Metadata } from "next";

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
    <html lang="zh-CN">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
