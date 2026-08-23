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
      provider: "openai",
      envVars: {},
      agentCommand: "",
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

test("provider reapply clears stale runtime hidden by effective summary projection", () => {
  assert.deepEqual(
    agentManagementInstanceUpdate({
      backendIntent: {
        type: "provider",
        id: "kubernetes",
        config: { namespace: "buzz-agents-pilot" },
      },
      managedAgent: agent({
        // Summary values already project the edited persona even when the
        // underlying provider instance record is stale.
        agentCommand: "codex-acp",
        agentArgs: [],
        mcpCommand: "buzz-dev-mcp",
        model: "gpt-5.6-sol",
        provider: "openai",
        systemPrompt: "New prompt",
      }),
      persona: persona({ runtime: "codex" }),
      previousPersona: persona({ runtime: "codex" }),
      runtimes: [
        {
          id: "codex",
          command: "codex-acp",
          defaultArgs: [],
          mcpCommand: "buzz-dev-mcp",
        },
      ],
    }),
    {
      pubkey: "deadbeef".repeat(8),
      model: "gpt-5.6-sol",
      provider: "openai",
      envVars: {},
      agentCommand: "",
      agentArgs: [],
      mcpCommand: "buzz-dev-mcp",
      backend: {
        type: "provider",
        id: "kubernetes",
        config: { namespace: "buzz-agents-pilot" },
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

test("an offline deployed agent can reapply only its current provider", () => {
  const managedAgent = agent({
    status: "deployed",
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
      presence: { loaded: true, status: "offline" },
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
      presence: { loaded: true, status: "offline" },
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
        status: "deployed",
        backend: managedAgent.backend,
      }),
      nextName: "agentos",
      presence: { loaded: true, status: "online" },
    }),
    "Shut down this agent before changing where it runs.",
  );
  assert.equal(
    validateAgentManagementBackendEdit({
      backendIntent: {
        type: "provider",
        id: "kubernetes",
        config: { namespace: "buzz-agents-pilot" },
      },
      managedAgent,
      nextName: "agentos",
      presence: { loaded: false },
    }),
    "Wait for remote presence to load before changing where this agent runs.",
  );
});

test("backend review requires stopped local or confirmed-offline same-provider state", () => {
  assert.equal(canReviewAgentManagementBackend(agent(), "kubernetes"), true);
  assert.equal(canReviewAgentManagementBackend(agent(), undefined), true);
  assert.equal(
    canReviewAgentManagementBackend(
      agent({
        status: "deployed",
        backend: { type: "provider", id: "kubernetes", config: {} },
      }),
      "kubernetes",
      { loaded: true, status: "offline" },
    ),
    true,
  );
  assert.equal(
    canReviewAgentManagementBackend(
      agent({
        backend: { type: "provider", id: "kubernetes", config: {} },
      }),
      undefined,
      { loaded: true, status: "offline" },
    ),
    false,
  );
  assert.equal(
    canReviewAgentManagementBackend(
      agent({
        backend: { type: "provider", id: "kubernetes", config: {} },
      }),
      "another-provider",
      { loaded: true, status: "offline" },
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
  for (const presence of [
    { loaded: false },
    { loaded: true, status: "online" },
    { loaded: true, status: "away" },
  ]) {
    assert.equal(
      canReviewAgentManagementBackend(
        agent({
          status: "deployed",
          backend: { type: "provider", id: "kubernetes", config: {} },
        }),
        "kubernetes",
        presence,
      ),
      false,
    );
  }
});
