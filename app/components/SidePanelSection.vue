<script setup lang="ts">
defineProps<{
  title: string;
  badge?: number;
  collapsed?: boolean;
  canCreate?: boolean;
  actionIcon?: "plus" | "folder";
}>();

defineEmits<{
  toggle: [];
  new: [];
}>();
</script>

<template>
  <section class="side-section" :class="{ 'is-collapsed': collapsed }">
    <div class="section-header" :title="collapsed ? '展开' : '折叠'" @click="$emit('toggle')">
      <span class="section-toggle" aria-hidden="true">
        <svg
          class="chevron"
          :class="{ 'is-collapsed': collapsed }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
      <span class="section-title">{{ title }}</span>
      <span v-if="badge !== undefined && badge > 0" class="section-badge">
        {{ badge }}
      </span>
      <button
        v-if="canCreate"
        type="button"
        class="section-new"
        :title="actionIcon === 'folder' ? '打开项目' : '新建'"
        @click.stop="$emit('new')"
      >
        <svg
          v-if="actionIcon === 'folder'"
          class="folder-icon"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span v-else>+</span>
      </button>
    </div>
    <div v-if="!collapsed" class="section-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.side-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
}

.side-section:last-child {
  border-bottom: 0;
}

.side-section.is-collapsed {
  flex: 0 0 auto;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.6rem;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 80%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
  user-select: none;
  flex: 0 0 auto;
  cursor: pointer;
}

.section-header:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 70%, transparent);
}

.section-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--color-surface-500, #64748b);
  /* No longer a button — just a visual chevron. The whole header toggles. */
  pointer-events: none;
}

.chevron {
  width: 14px;
  height: 14px;
  transition: transform 0.15s ease;
}

.chevron.is-collapsed {
  transform: rotate(-90deg);
}

.section-title {
  flex: 1;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-surface-400, #94a3b8);
}

.section-badge {
  flex: 0 0 auto;
  padding: 0 0.4rem;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 18%, transparent);
  color: var(--color-accent-cyan, #06b6d4);
}

.section-new {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--color-surface-500, #64748b);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.folder-icon {
  width: 13px;
  height: 13px;
}

.section-new:hover {
  background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 18%, transparent);
  color: var(--color-accent-cyan, #06b6d4);
}

.section-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.4rem 0.5rem;
}
</style>
