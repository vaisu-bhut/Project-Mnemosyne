"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { FullPageSpinner } from "@/components/common/Spinner";
import { EpisodeDrawerProvider } from "@/components/episodes/EpisodeDrawerProvider";
import { ChatPanelProvider } from "@/lib/chat/ChatPanelProvider";
import { ProactiveNotifier } from "@/components/pwa/ProactiveNotifier";

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
        <ProactiveNotifier />
        {/* Ambient signature: a slow aurora drift behind the entire shell.
            Decorative, low-opacity, evokes the memory graph without competing
            with content. Sits at z-0; chrome + content are above. */}
        {/* Faint paper-grain texture behind everything — the cream base reads as
            page, not screen. */}
        <div className="paper-bg" aria-hidden />
        {/* Sidebar = full-height left column. No topbar — the sidebar carries
            all chrome (brand, nav, Capture, identity) and the PageHeader on
            each page is the chapter title, in editorial style. */}
        <div className="relative z-10 h-svh">
          <Sidebar />
          <div className="flex h-full min-w-0 flex-col md:pl-56">
            <main className="flex-1 overflow-y-auto p-5 md:p-7 animate-fade-in">
              {children}
            </main>
          </div>
        </div>
      </ChatPanelProvider>
    </EpisodeDrawerProvider>
  );
}
