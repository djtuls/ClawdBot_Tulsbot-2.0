"use client";

import { usePathname } from "next/navigation";
import ChatPanel from "./ChatPanel";
import Sidebar from "./Sidebar";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname.startsWith("/login");

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-56 min-h-screen">{children}</main>
      <ChatPanel context={`User is viewing: ${pathname}`} />
    </div>
  );
}
