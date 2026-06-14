import { describe, it, expect } from "vitest";
import {
  applyTaskToggle,
  parseDeltaSpec,
  parseProposal,
  parseSpec,
  parseTasks,
  updateTaskStatuses,
  countTaskStats,
} from "../openspecParser";

// ── Proposal ───────────────────────────────────────────────────────────

describe("parseProposal", () => {
  it("parses skill-style headers (Why / What Changes / Impact)", () => {
    const md = `# Proposal: Add 2FA

## Why
Users need stronger auth.

## What Changes
- Add TOTP enrollment flow
- Add backup codes

### New Capabilities
- \`two-factor-auth\`: TOTP enrollment and verification

### Modified Capabilities
- \`session\`: enforce 2FA after login

## Impact
Adds a new dependency on otplib.
`;
    const p = parseProposal(md);
    expect(p.why).toContain("Users need stronger auth");
    expect(p.whatChanges).toContain("TOTP");
    expect(p.capabilitiesNew).toEqual(["two-factor-auth"]);
    expect(p.capabilitiesModified).toEqual(["session"]);
    expect(p.impact).toContain("otplib");
  });

  it("parses official-style headers (Intent / Scope / Approach) as fallback", () => {
    const md = `# Proposal: Dark mode

## Intent
Improve UX at night.

## Scope
In scope:
- toggle

## Approach
Use CSS vars.
`;
    const p = parseProposal(md);
    expect(p.why).toContain("Improve UX");
    expect(p.whatChanges).toContain("In scope");
    expect(p.impact).toContain("CSS vars");
    expect(p.capabilitiesNew).toEqual([]);
  });
});

// ── Tasks ──────────────────────────────────────────────────────────────

describe("parseTasks", () => {
  it("groups tasks by ## N. header, captures subfields and stats", () => {
    const md = `# Tasks

## 1. Data Layer

- [ ] 1.1 Create User model
  - Requirement: user-registration
  - Verification: \`pytest tests/test_user.py\`
  - Estimate: 30 min
  - Depends on: 1.0

- [x] 1.2 Create Token model
  - Result: 5 passed

## 2. API

- [ ] 2.1 Expose /register endpoint
`;
    const parsed = parseTasks(md);
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0].title).toBe("Data Layer");
    const t11 = parsed.groups[0].tasks[0];
    expect(t11.id).toBe("1.1");
    expect(t11.status).toBe("pending");
    expect(t11.requirement).toBe("user-registration");
    expect(t11.verification).toBe("pytest tests/test_user.py");
    expect(t11.estimate).toBe(30);
    expect(t11.dependsOn).toEqual(["1.0"]);

    const t12 = parsed.groups[0].tasks[1];
    expect(t12.status).toBe("completed");
    expect(t12.result).toBe("5 passed");

    expect(parsed.stats.total).toBe(3);
    expect(parsed.stats.completed).toBe(1);
    expect(parsed.stats.pending).toBe(2);
    expect(parsed.stats.progress).toBeCloseTo(1 / 3);
  });

  it("applyTaskToggle flips a single line and preserves evidence subfields", () => {
    const md = `# Tasks

## 1. Group

- [ ] 1.1 Do thing
  - Result: existing result
  - Verification: \`npm test\`
`;
    const original = md.split("\n");
    const toggled = applyTaskToggle(original, "1.1", true);
    // task line itself changed
    const taskLine = toggled.find((l) => l.includes("1.1 Do thing"));
    expect(taskLine).toMatch(/\[x\]/);
    // evidence lines untouched
    expect(toggled.find((l) => l.includes("existing result"))).toBeDefined();
    expect(toggled.find((l) => l.includes("Verification:"))).toBeDefined();
    // length unchanged
    expect(toggled.length).toBe(original.length);
  });

  it("updateTaskStatuses flips status of matching task in memory", () => {
    const md = `## 1. G

- [ ] 1.1 A
- [ ] 1.2 B
`;
    const parsed = parseTasks(md);
    const updated = updateTaskStatuses(parsed.groups[0].tasks, "1.2", true);
    expect(updated[1].status).toBe("completed");
    expect(updated[0].status).toBe("pending");
  });

  it("countTaskStats handles empty list", () => {
    const s = countTaskStats([]);
    expect(s).toEqual({ total: 0, completed: 0, pending: 0, progress: 0 });
  });
});

// ── Spec(源真理) ────────────────────────────────────────────────────────

describe("parseSpec", () => {
  it("extracts requirements with scenarios and SHALL level", () => {
    const md = `# Auth Spec

## Purpose
Auth domain.

## Requirements

### Requirement: Login
The system SHALL issue a JWT upon successful login.

#### Scenario: Valid credentials
- GIVEN a registered user
- WHEN the user submits valid credentials
- THEN a JWT is returned

### Requirement: Logout
The system MUST invalidate the session on logout.
`;
    const { requirements, purpose } = parseSpec(md, "auth");
    expect(purpose).toContain("Auth domain");
    expect(requirements).toHaveLength(2);
    const login = requirements[0];
    expect(login.name).toBe("Login");
    expect(login.level).toBe("SHALL");
    expect(login.scenarios).toHaveLength(1);
    const sc = login.scenarios[0];
    expect(sc.name).toBe("Valid credentials");
    expect(sc.steps.map((s) => s.keyword)).toEqual(["GIVEN", "WHEN", "THEN"]);
    const logout = requirements[1];
    expect(logout.level).toBe("MUST");
  });
});

// ── Delta Spec ──────────────────────────────────────────────────────────

describe("parseDeltaSpec", () => {
  it("parses all 4 sections: ADDED / MODIFIED / REMOVED / RENAMED", () => {
    const md = `## ADDED Requirements

### Requirement: Two-Factor Auth
The system MUST support TOTP 2FA.

#### Scenario: Enrollment
- GIVEN a user without 2FA
- WHEN the user enables 2FA
- THEN a QR code is shown

## MODIFIED Requirements

### Requirement: Session Expiration
The system MUST expire sessions after 15 minutes.

## REMOVED Requirements

### Requirement: Remember Me

## RENAMED Requirements

- FROM: \`### Requirement: Old Name\`
- TO: \`### Requirement: New Name\`
`;
    const delta = parseDeltaSpec(md, "auth", "changes/add-2fa/specs/auth/spec.md");
    expect(delta.capability).toBe("auth");
    const ops = delta.requirements.map((r) => r.op);
    expect(ops).toEqual(expect.arrayContaining(["added", "modified", "removed", "renamed"]));

    const added = delta.requirements.find((r) => r.op === "added");
    expect(added?.name).toBe("Two-Factor Auth");
    expect(added?.requirement?.scenarios[0].name).toBe("Enrollment");

    const modified = delta.requirements.find((r) => r.op === "modified");
    expect(modified?.name).toBe("Session Expiration");
    expect(modified?.requirement?.level).toBe("MUST");

    const removed = delta.requirements.find((r) => r.op === "removed");
    expect(removed?.name).toBe("Remember Me");
    expect(removed?.requirement).toBeUndefined();

    const renamed = delta.requirements.find((r) => r.op === "renamed");
    expect(renamed?.name).toBe("New Name");
    expect(renamed?.fromName).toBe("Old Name");
  });
});
