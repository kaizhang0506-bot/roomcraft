import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "筑境 Roomcraft · 室内设计工作台",
  description: "从一张户型图开始，设计每一种生活。户型编辑、三维空间、水电图层与真实 AI 效果生成。",
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
