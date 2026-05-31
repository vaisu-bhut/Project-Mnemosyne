"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { authApi } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/common/Spinner";

export function GoogleConnectCard() {
  const [loading, setLoading] = useState(false);

  async function connect() {
    setLoading(true);
    try {
      const { url } = await authApi.googleUrl();
      window.open(url, "_blank", "noopener");
      toast.info("Complete Google sign-in in the new tab, then add a Gmail/Calendar source.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't start Google connect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" /> Connect Google
        </CardTitle>
        <CardDescription>
          Required for Gmail, Calendar, and Contacts sources. The OAuth callback
          currently returns tokens as JSON (mobile-shaped) — a web hand-off is a
          pending backend item, so the filesystem source is the no-OAuth path.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={connect} disabled={loading}>
          {loading && <Spinner />}
          Connect Google
        </Button>
      </CardContent>
    </Card>
  );
}
