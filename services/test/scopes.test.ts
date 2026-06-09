import { describe, expect, it } from "vitest";
import { servicesFromScope } from "../auth/scopes.js";

const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
const CAL = "https://www.googleapis.com/auth/calendar.readonly";
const CONTACTS = "https://www.googleapis.com/auth/contacts.readonly";

describe("servicesFromScope", () => {
  it("maps known Google scopes to services in a stable order", () => {
    const svc = servicesFromScope(`openid email profile ${CONTACTS} ${GMAIL} ${CAL}`);
    expect(svc.map((s) => s.key)).toEqual(["gmail", "calendar", "contacts", "identity"]);
    expect(svc.map((s) => s.label)).toEqual(["Gmail", "Calendar", "Contacts", "Sign-in"]);
  });

  it("collapses openid/email/profile into a single identity service", () => {
    const svc = servicesFromScope("openid email profile");
    expect(svc).toEqual([{ key: "identity", label: "Sign-in" }]);
  });

  it("ignores unknown scopes", () => {
    const svc = servicesFromScope(`${GMAIL} https://example.com/unknown.scope`);
    expect(svc).toEqual([{ key: "gmail", label: "Gmail" }]);
  });

  it("returns [] for empty / null scope", () => {
    expect(servicesFromScope(null)).toEqual([]);
    expect(servicesFromScope(undefined)).toEqual([]);
    expect(servicesFromScope("")).toEqual([]);
  });

  it("maps Microsoft Graph scopes (case-insensitive, with/without prefix)", () => {
    const svc = servicesFromScope("openid profile Mail.Read Calendars.Read Contacts.Read");
    expect(svc.map((s) => s.label)).toEqual(["Outlook Mail", "Calendar", "Contacts", "Sign-in"]);

    // Graph sometimes returns scopes with the resource prefix.
    const prefixed = servicesFromScope("https://graph.microsoft.com/Mail.Read");
    expect(prefixed).toEqual([{ key: "mail", label: "Outlook Mail" }]);
  });
});
