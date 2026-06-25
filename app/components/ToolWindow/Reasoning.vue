<script setup lang="ts">
import CodeContent from "../CodeContent.vue";
import { useFloatingWindow } from "../../composables/useFloatingWindow";
import { DEFAULT_SYNTAX_THEME } from "../../utils/themeTokens";

export type ReasoningEntry = {
  id: string;
  text: string;
};

withDefaults(
  defineProps<{
    entries: ReasoningEntry[];
    theme?: string;
  }>(),
  {
    theme: DEFAULT_SYNTAX_THEME,
  },
);

const floatingWindow = useFloatingWindow();

function handleRendered() {
  floatingWindow.notifyContentChange();
}
</script>

<template>
  <div class="reasoning-content">
    <div
      v-for="(entry, index) in entries"
      :key="entry.id"
      class="reasoning-entry"
      :class="{ 'reasoning-entry-separator': index > 0 }"
    >
      <CodeContent :html="entry.text" variant="message" @vue:mounted="handleRendered" />
    </div>
  </div>
</template>

<style scoped>
.reasoning-content {
  min-height: 100%;
}

.reasoning-entry-separator {
  margin-top: 0.4em;
  padding-top: 0.4em;
  border-top: 1px solid rgba(148, 163, 184, 0.15);
}
</style>
