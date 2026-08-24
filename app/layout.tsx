import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "秋招手账｜个人求职进度管理",
  description: "记录投递、笔试、面试与每一次成长。",
  icons: {
    icon: [
      { url: "/favicon-arrow-v2.ico?v=2", type: "image/x-icon" },
      { url: "/app-icon-arrow-v2.png?v=2", type: "image/png" },
    ],
    shortcut: "/favicon-arrow-v2.ico?v=2",
    apple: "/app-icon-arrow-v2.png?v=2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="light">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
