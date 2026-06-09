import { FileText, Mail, Calendar, Contact, type LucideIcon } from "lucide-react";
import type { OAuthProvider, SourceKind } from "@/lib/api/types";

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** OAuth-backed kinds require a connected account of this provider. */
  oauth?: OAuthProvider;
  hint: string;
}

export const KIND_META: Record<SourceKind, KindMeta> = {
  filesystem: {
    label: "Filesystem",
    icon: FileText,
    hint: "A folder of .md / .txt notes, read by the backend.",
  },
  gmail: {
    label: "Gmail",
    icon: Mail,
    oauth: "google",
    hint: "Recent email, sender/recipients become people.",
  },
  gcal: {
    label: "Calendar (Google)",
    icon: Calendar,
    oauth: "google",
    hint: "Events and attendees; powers pre-meeting briefings.",
  },
  gcontacts: {
    label: "Contacts (Google)",
    icon: Contact,
    oauth: "google",
    hint: "Each contact seeds a person entity.",
  },
  msmail: {
    label: "Outlook Mail",
    icon: Mail,
    oauth: "microsoft",
    hint: "Recent Outlook email, sender/recipients become people.",
  },
  mscal: {
    label: "Calendar (Outlook)",
    icon: Calendar,
    oauth: "microsoft",
    hint: "Outlook events and attendees; powers pre-meeting briefings.",
  },
  mscontacts: {
    label: "Contacts (Outlook)",
    icon: Contact,
    oauth: "microsoft",
    hint: "Each Outlook contact seeds a person entity.",
  },
};

export const SCOPE_OPTIONS = ["personal", "work", "health", "shareable"] as const;
