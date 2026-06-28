// ---------------------------------------------------------------------------
// Display Names
// ---------------------------------------------------------------------------
// User-customizable display names for the agent and the user, shown in chat
// message headers. Persisted via the standard ui:* storage channel (localStorage
// + Electron prefs mirror). Module-level refs so every component instance and
// the settings panel share one source of truth — editing in settings updates
// the chat view reactively without a reload.
// ---------------------------------------------------------------------------

import { computed, ref } from "vue";
import { StorageKeys, storageGet, storageSet } from "../utils/storageKeys";

const DEFAULT_AGENT_NAME = "Hephaestus";
const DEFAULT_USER_NAME = "Patron";

const agentNameRef = ref(storageGet(StorageKeys.ui.agentName) || DEFAULT_AGENT_NAME);
const userNameRef = ref(storageGet(StorageKeys.ui.userName) || DEFAULT_USER_NAME);

export function useDisplayNames() {
  function setAgentName(name: string) {
    const v = name.trim();
    agentNameRef.value = v || DEFAULT_AGENT_NAME;
    storageSet(StorageKeys.ui.agentName, agentNameRef.value);
  }

  function setUserName(name: string) {
    const v = name.trim();
    userNameRef.value = v || DEFAULT_USER_NAME;
    storageSet(StorageKeys.ui.userName, userNameRef.value);
  }

  return {
    defaultAgentName: DEFAULT_AGENT_NAME,
    defaultUserName: DEFAULT_USER_NAME,
    agentName: computed(() => agentNameRef.value),
    userName: computed(() => userNameRef.value),
    setAgentName,
    setUserName,
  };
}
