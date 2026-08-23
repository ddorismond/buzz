import type { BackendIntent } from "./instanceInputForDefinition";
import { personaManagedAgentUpdate } from "@/features/profile/ui/UserProfilePanelUtils";
import type {
  AcpRuntimeCatalogEntry,
  AgentPersona,
  ManagedAgent,
  PresenceStatus,
  UpdateManagedAgentInput,
} from "@/shared/api/types";
import {
  isManagedAgentActive,
  isManagedAgentLive,
} from "./managedAgentControlActions";

export type AgentManagementPresenceState = {
  loaded: boolean;
  status?: PresenceStatus;
};

export function canReviewAgentManagementBackend(
  managedAgent: ManagedAgent | undefined,
  requestedProviderId: string | undefined,
  presence: AgentManagementPresenceState = { loaded: false },
): boolean {
  if (!managedAgent) return false;
  if (managedAgent.backend.type === "local") {
    return !isManagedAgentActive(managedAgent);
  }
  return (
    requestedProviderId !== undefined &&
    managedAgent.backend.id === requestedProviderId &&
    presence.loaded &&
    !isManagedAgentLive(managedAgent, presence.status)
  );
}

export function validateAgentManagementBackendEdit({
  backendIntent,
  managedAgent,
  nextName,
  presence = { loaded: false },
}: {
  backendIntent: BackendIntent | null;
  managedAgent: ManagedAgent | undefined;
  nextName: string;
  presence?: AgentManagementPresenceState;
}): string | null {
  if (!backendIntent) return null;
  if (!managedAgent) {
    return "This agent does not have one unique instance to migrate.";
  }
  if (
    managedAgent.backend.type === "local" &&
    isManagedAgentActive(managedAgent)
  ) {
    return "Stop this agent before changing where it runs.";
  }
  if (managedAgent.backend.type === "provider") {
    if (managedAgent.backend.id !== backendIntent.id) {
      return "Provider-backed agents can only reapply their current provider.";
    }
    if (!presence.loaded) {
      return "Wait for remote presence to load before changing where this agent runs.";
    }
    if (isManagedAgentLive(managedAgent, presence.status)) {
      return "Shut down this agent before changing where it runs.";
    }
  }
  if (nextName.trim() !== managedAgent.name) {
    return "Keep the current agent name during migration; rename it in a separate review.";
  }
  return null;
}

/**
 * Build the one instance update that follows an owner-reviewed definition edit.
 * Identity/runtime synchronization and a stopped local→provider migration must
 * land together so one review cannot silently discard either half.
 */
export function agentManagementInstanceUpdate({
  backendIntent,
  managedAgent,
  persona,
  previousPersona,
  runtimes,
}: {
  backendIntent: BackendIntent | null;
  managedAgent: ManagedAgent;
  persona: AgentPersona;
  previousPersona?: AgentPersona;
  runtimes: readonly AcpRuntimeCatalogEntry[];
}): UpdateManagedAgentInput | null {
  const synced = personaManagedAgentUpdate(managedAgent, persona, {
    previousPersona,
    runtimes,
    forceRuntimeSync: Boolean(backendIntent),
  });
  if (!synced && !backendIntent) return null;

  return {
    ...(synced ?? { pubkey: managedAgent.pubkey }),
    ...(backendIntent
      ? {
          backend: {
            type: "provider" as const,
            id: backendIntent.id,
            config: backendIntent.config,
          },
        }
      : {}),
  };
}
