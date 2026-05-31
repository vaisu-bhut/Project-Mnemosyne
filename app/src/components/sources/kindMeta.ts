import { FileText, Mail, Calendar, Contact, type LucideIcon } from "lucide-react";
import type { SourceKind } from "@/lib/api/types";

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** Google connectors require a completed OAuth flow. */
  google: boolean;
  hint: string;
}

export const KIND_META: Record<SourceKind, KindMeta> = {
  filesystem: {
    label: "Filesystem",
    icon: FileText,
    google: false,
    hint: "A folder of .md / .txt notes, read by the backend.",
  },
  gmail: {
    label: "Gmail",
    icon: Mail,
    google: true,
    hint: "Recent email, sender/recipients become people.",
  },
  gcal: {
    label: "Calendar",
    icon: Calendar,
    google: true,
    hint: "Events and attendees; powers pre-meeting briefings.",
  },
  gcontacts: {
    label: "Contacts",
    icon: Contact,
    google: true,
    hint: "Each contact seeds a person entity.",
  },
};

export const SCOPE_OPTIONS = ["personal", "work", "health", "shareable"] as const;
