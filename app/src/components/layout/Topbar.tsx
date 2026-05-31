"use client";

import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ModeSelector } from "@/components/ModeSelector";
import { Button } from "@/components/ui/button";

export function Topbar() {
  const { user, logout } = useAuth();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 md:px-6">
      <span className="font-semibold tracking-tight md:hidden">Mnemosyne</span>
      <div className="ml-auto flex items-center gap-4">
        <ModeSelector />
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
