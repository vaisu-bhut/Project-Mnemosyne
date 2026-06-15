"use client";

import { useState } from "react";
import { LogOut, Mic } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { VoiceCaptureDialog } from "@/components/capture/VoiceCaptureDialog";

export function Topbar() {
  const { user, logout } = useAuth();
  const [captureOpen, setCaptureOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 md:px-6">
      <span className="font-semibold tracking-tight md:hidden">Mnemosyne</span>
      <VoiceCaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} />
      <div className="ml-auto flex items-center gap-4">
        <Button size="sm" onClick={() => setCaptureOpen(true)}>
          <Mic className="size-4" /> Capture
        </Button>
        <div className="flex items-center gap-2">
          <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:inline">
            {user?.displayName ?? user?.email}
          </span>
          <Button variant="ghost" size="icon" onClick={() => void logout()} title="Sign out">
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  );
}
