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
      // Same-tab navigation: after consent the backend hands off to the SPA
      // callback, which captures the tokens and lands us back in the app.
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't start Google connect");
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
          Required for Gmail, Calendar, and Contacts sources. Sends you to Google
          to approve access, then returns you here signed in — after which you can
          add a Gmail, Calendar, or Contacts source.
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
