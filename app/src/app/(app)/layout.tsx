"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { FullPageSpinner } from "@/components/common/Spinner";
import { EpisodeDrawerProvider } from "@/components/episodes/EpisodeDrawerProvider";
import { ChatPanelProvider } from "@/lib/chat/ChatPanelProvider";

/** Auth gate + app shell. Unauthenticated users are bounced to /login. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") return <FullPageSpinner />;

  return (
    <EpisodeDrawerProvider>
      <ChatPanelProvider>
        {/* Shell is exactly viewport-height: the sidebar is fixed-left and the
            right column's <main> is the only scrolling region. */}
        <div className="h-svh">
          <Sidebar />
          <div className="flex h-full min-w-0 flex-col md:pl-60">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
          </div>
        </div>
      </ChatPanelProvider>
    </EpisodeDrawerProvider>
  );
}
