import assert from "node:assert/strict";
import test from "node:test";

import {
  agentManagementInstanceUpdate,
  canReviewAgentManagementBackend,
  validateAgentManagementBackendEdit,
} from "./agentManagementUpdate.ts";

function agent(overrides = {}) {
  return {
    pubkey: "deadbeef".repeat(8),
    name: "agentos",
    personaId: "persona-1",
    relayUrl: "ws://localhost:3000",
    acpCommand: "buzz-acp",
    agentCommand: "codex-acp",
    agentArgs: [],
    mcpCommand: "",
    turnTimeoutSeconds: 320,
    idleTimeoutSeconds: null,
    maxTurnDurationSeconds: null,
    parallelism: 1,
    systemPrompt: "Old prompt",
    avatarUrl: null,
    model: "old-model",
    envVars: {},
    status: "stopped",
    pid: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastStartedAt: null,
    lastStoppedAt: null,
    lastExitCode: null,
    lastError: null,
    logPath: null,
    startOnAppLaunch: false,
    backend: { type: "local" },
    backendAgentId: null,
    respondTo: "owner-only",
    respondToAllowlist: [],
    ...overrides,
  };
}

function persona(overrides = {}) {
  return {
    id: "persona-1",
    displayName: "agentos",
    avatarUrl: null,
    systemPrompt: "New prompt",
    runtime: "codex-acp",
    model: "gpt-5.6-sol",
    provider: "openai",
    namePool: [],
    isBuiltIn: false,
    isActive: true,
    respondTo: "owner-only",
    respondToAllowlist: [],
    envVars: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("combines linked profile synchronization and provider migration in one instance update", () => {
  assert.deepEqual(
    agentManagementInstanceUpdate({
      backendIntent: {
        type: "provider",
        id: "kubernetes",
        config: {
          namespace: "buzz-agents-pilot",
          workspace_storage: "5Gi",
        },
      },
      managedAgent: agent({
        agentCommand: "claude-agent-acp",
        agentArgs: ["--old"],
        mcpCommand: "claude-mcp",
      }),
      persona: persona(),
      previousPersona: persona({
        systemPrompt: "Old prompt",
        model: "old-model",
      }),
      runtimes: [
        {
          id: "codex-acp",
          command: "codex-agent-acp",
          defaultArgs: [],
          mcpCommand: "codex-mcp",
        },
      ],
    }),
    {
      pubkey: "deadbeef".repeat(8),
      systemPrompt: "New prompt",
      model: "gpt-5.6-sol",
      agentCommand: "codex-agent-acp",
      agentArgs: [],
      mcpCommand: "codex-mcp",
      backend: {
        type: "provider",
        id: "kubernetes",
        config: {
          namespace: "buzz-agents-pilot",
          workspace_storage: "5Gi",
        },
      },
    },
  );
});

test("preserves an unchanged local instance when the review has no migration", () => {
  const unchangedPersona = persona({
    systemPrompt: "Old prompt",
    model: "old-model",
  });
  assert.equal(
    agentManagementInstanceUpdate({
      backendIntent: null,
      managedAgent: agent(),
      persona: unchangedPersona,
      previousPersona: unchangedPersona,
      runtimes: [],
    }),
    null,
  );
});

test("migration validation fails closed before a partial profile save", () => {
  const backendIntent = {
    type: "provider",
    id: "kubernetes",
    config: {},
  };
  assert.equal(
    validateAgentManagementBackendEdit({
      backendIntent,
      managedAgent: agent({ status: "running", pid: 42 }),
      nextName: "agentos",
    }),
    "Stop this agent before changing where it runs.",
  );
  assert.equal(
    validateAgentManagementBackendEdit({
      backendIntent,
      managedAgent: agent(),
      nextName: "agentos renamed",
    }),
    "Keep the current agent name during migration; rename it in a separate review.",
  );
});

test("a stopped provider-backed agent can reapply only its current provider", () => {
  const managedAgent = agent({
    backend: {
      type: "provider",
      id: "kubernetes",
      config: { namespace: "buzz-agents-pilot" },
    },
  });
  assert.equal(
    validateAgentManagementBackendEdit({
      backendIntent: {
        type: "provider",
        id: "kubernetes",
        config: { namespace: "buzz-agents-pilot" },
      },
      managedAgent,
      nextName: "agentos",
    }),
    null,
  );
  assert.equal(
    validateAgentManagementBackendEdit({
      backendIntent: {
        type: "provider",
        id: "another-provider",
        config: {},
      },
      managedAgent,
      nextName: "agentos",
    }),
    "Provider-backed agents can only reapply their current provider.",
  );
  assert.equal(
    validateAgentManagementBackendEdit({
      backendIntent: {
        type: "provider",
        id: "kubernetes",
        config: { namespace: "buzz-agents-pilot" },
      },
      managedAgent: agent({
        status: "running",
        pid: 42,
        backend: managedAgent.backend,
      }),
      nextName: "agentos",
    }),
    "Stop this agent before changing where it runs.",
  );
});

test("backend review opens only for stopped local migration or same-provider reapply", () => {
  assert.equal(canReviewAgentManagementBackend(agent(), "kubernetes"), true);
  assert.equal(canReviewAgentManagementBackend(agent(), undefined), true);
  assert.equal(
    canReviewAgentManagementBackend(
      agent({
        backend: { type: "provider", id: "kubernetes", config: {} },
      }),
      "kubernetes",
    ),
    true,
  );
  assert.equal(
    canReviewAgentManagementBackend(
      agent({
        backend: { type: "provider", id: "kubernetes", config: {} },
      }),
      undefined,
    ),
    false,
  );
  assert.equal(
    canReviewAgentManagementBackend(
      agent({
        backend: { type: "provider", id: "kubernetes", config: {} },
      }),
      "another-provider",
    ),
    false,
  );
  assert.equal(
    canReviewAgentManagementBackend(
      agent({ status: "running", pid: 42 }),
      "kubernetes",
    ),
    false,
  );
});
