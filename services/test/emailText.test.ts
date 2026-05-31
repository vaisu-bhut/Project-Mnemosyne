import { describe, expect, it } from "vitest";
import {
  htmlToText,
  parseAddressList,
  participantsFromHeaders,
  stripQuoted,
} from "../ingest/emailText.js";

describe("parseAddressList", () => {
  it("parses names and bare emails, lowercasing addresses", () => {
    const addrs = parseAddressList('"Sara Lin" <Sara@X.com>, bob@y.com');
    expect(addrs).toEqual([
      { name: "Sara Lin", email: "sara@x.com" },
      { email: "bob@y.com" },
    ]);
  });

  it("returns [] for undefined", () => {
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

describe("participantsFromHeaders", () => {
  it("tags roles from From/To/Cc", () => {
    const ps = participantsFromHeaders({ from: "a@x.com", to: "b@x.com", cc: "c@x.com" });
    expect(ps).toEqual([
      { email: "a@x.com", role: "from" },
      { email: "b@x.com", role: "to" },
      { email: "c@x.com", role: "cc" },
    ]);
  });
});

describe("htmlToText", () => {
  it("strips tags/scripts and decodes entities", () => {
    const out = htmlToText("<style>x{}</style><p>Hi&amp;bye<br>there</p><script>1</script>");
    expect(out).toBe("Hi&bye\nthere");
  });
});

describe("stripQuoted", () => {
  it("drops the quoted reply chain", () => {
    const out = stripQuoted("My new reply.\n\nOn Mon, Sara wrote:\n> old stuff\n> more");
    expect(out).toBe("My new reply.");
  });

  it("drops a signature block", () => {
    expect(stripQuoted("Thanks!\n-- \nSara Lin\nArchitect")).toBe("Thanks!");
  });
});
