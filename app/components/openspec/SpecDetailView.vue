<script setup lang="ts">
import { computed } from "vue";
import { useOpenSpec } from "../../composables/useOpenSpec";
import { renderMarkdown } from "../../composables/useMarkdown";
import type { OpenSpecCapability, OpenSpecChange, SpecTarget } from "../../types/openspec";

const props = defineProps<{
  target: SpecTarget;
}>();

const emit = defineEmits<{
  close: [];
}>();

const openspec = useOpenSpec();

const capability = computed<OpenSpecCapability | undefined>(() => {
  const t = props.target;
  if (t.kind !== "capability") return undefined;
  return openspec.state.capabilities.find((c) => c.name === t.name);
});

const archived = computed<OpenSpecChange | undefined>(() => {
  const t = props.target;
  if (t.kind !== "archived") return undefined;
  return openspec.state.archivedChanges.find((c) => c.id === t.id);
});

const archivedProposalHtml = computed(() => {
  if (!archived.value?.proposal?.raw) return "";
  return renderMarkdown(archived.value.proposal.raw);
});

const purposeHtml = computed(() => {
  if (!capability.value?.purpose) return "";
  return renderMarkdown(capability.value.purpose);
});

function reqTextHtml(text: string): string {
  return text ? renderMarkdown(text) : "";
}
</script>

<template>
  <section class="spec-view">
    <header class="sv-header">
      <div class="sv-titles">
        <span v-if="props.target.kind === 'capability'" class="sv-kicker violet">Capability</span>
        <span v-else class="sv-kicker amber">Archived</span>
        <h1 class="sv-title">
          {{ props.target.kind === "capability" ? props.target.name : props.target.id }}
        </h1>
        <span v-if="archived?.archivedAt" class="sv-sub"> 归档于 {{ archived.archivedAt }} </span>
        <span v-else-if="capability?.specPath" class="sv-sub">{{ capability.specPath }}</span>
      </div>
      <button type="button" class="sv-close" title="关闭" @click="emit('close')">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>

    <div class="sv-body">
      <!-- ═══ Capability 详情 ═══ -->
      <template v-if="props.target.kind === 'capability' && capability">
        <section v-if="capability.purpose" class="md-block">
          <div class="md-block-title">Purpose</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="markdown-body md-card" v-html="purposeHtml" />
        </section>
        <section v-if="capability.requirements?.length" class="md-block">
          <div class="md-block-title">
            Requirements
            <span class="count-pill">{{ capability.requirements.length }}</span>
          </div>
          <ul class="req-list">
            <li v-for="req in capability.requirements" :key="req.name">
              <span class="req-level" :class="req.level">{{ req.level }}</span>
              <div class="req-body">
                <div class="req-name">{{ req.name }}</div>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div
                  v-if="req.text"
                  class="markdown-body req-text"
                  v-html="reqTextHtml(req.text)"
                />
                <div v-if="req.scenarios?.length" class="scenarios">
                  <div v-for="(sc, idx) in req.scenarios" :key="idx" class="scenario">
                    <div class="scenario-name">{{ sc.name }}</div>
                    <ol class="scenario-steps">
                      <li v-for="(step, sIdx) in sc.steps" :key="sIdx">
                        <span class="step-keyword">{{ step.keyword }}</span>
                        <span class="step-text">{{ step.text }}</span>
                      </li>
                    </ol>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </section>
        <div v-if="!capability.hasSpec" class="empty-state">spec.md 缺失</div>
      </template>

      <!-- ═══ Archived 详情 ═══ -->
      <template v-else-if="props.target.kind === 'archived' && archived">
        <div class="headline-row">
          <span v-if="archived.taskStats?.total" class="headline-pill">
            {{ archived.taskStats.completed }}/{{ archived.taskStats.total }} tasks
          </span>
          <span v-if="archived.deltaSpecs?.length" class="headline-pill violet">
            {{ archived.deltaSpecs.length }} spec deltas
          </span>
          <span v-if="archived.hasDesign" class="headline-pill">design</span>
        </div>
        <section class="md-block">
          <div class="md-block-title">Proposal</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div
            v-if="archivedProposalHtml"
            class="markdown-body md-card"
            v-html="archivedProposalHtml"
          />
          <div v-else class="empty-state">proposal.md 为空</div>
        </section>
        <section v-if="archived.deltaSpecs?.length" class="md-block">
          <div class="md-block-title">Affected capabilities</div>
          <ul class="cap-list">
            <li v-for="d in archived.deltaSpecs" :key="d.capability">
              <span class="delta-op">∆</span>
              <span class="cap-name">{{ d.capability }}</span>
              <span v-if="d.requirements?.length" class="cap-meta">
                {{ d.requirements.length }} reqs
              </span>
            </li>
          </ul>
        </section>
      </template>

      <!-- ═══ 找不到目标 ═══ -->
      <template v-else>
        <div class="empty-state">条目不存在或已被移除</div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.spec-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-surface-900, #0f172a) 80%, transparent),
    color-mix(in srgb, var(--color-surface-950, #020617) 92%, transparent)
  );
}

.sv-header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-accent-violet, #a78bfa) 6%, transparent),
    transparent
  );
}

.sv-titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.sv-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.sv-kicker.violet {
  color: var(--color-accent-violet, #a78bfa);
}

.sv-kicker.amber {
  color: var(--color-accent-amber, #f59e0b);
}

.sv-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--color-surface-100, #f1f5f9);
  font-family: var(--font-mono, monospace);
  word-break: break-all;
  line-height: 1.25;
}

.sv-sub {
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
}

.sv-close {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 40%, transparent);
  color: var(--color-surface-400, #94a3b8);
  cursor: pointer;
}

.sv-close:hover {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 14%, transparent);
  color: var(--color-accent-rose, #f43f5e);
  border-color: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 30%, transparent);
}

.sv-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px max(32px, 8vw) 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* ── Markdown 渲染 ──────────────────────────────────────── */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 0.6em 0 0.4em;
  color: var(--color-surface-100, #f1f5f9);
  font-weight: 700;
  line-height: 1.3;
}

.markdown-body :deep(h1) {
  font-size: 20px;
}

.markdown-body :deep(h2) {
  font-size: 17px;
  padding-bottom: 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
}

.markdown-body :deep(h3) {
  font-size: 14px;
  color: var(--color-accent-violet, #a78bfa);
}

.markdown-body :deep(p) {
  margin: 0.5em 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-surface-200, #e2e8f0);
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.6em;
}

.markdown-body :deep(li) {
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-surface-200, #e2e8f0);
  margin: 0.2em 0;
}

.markdown-body :deep(code) {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  padding: 1px 6px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
  color: var(--color-accent-cyan, #06b6d4);
}

.markdown-body :deep(pre) {
  margin: 0.6em 0;
  padding: 12px 14px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 60%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 30%, transparent);
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: var(--color-surface-200, #e2e8f0);
}

.markdown-body :deep(blockquote) {
  margin: 0.6em 0;
  padding: 6px 14px;
  border-left: 3px solid var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 8%, transparent);
  color: var(--color-surface-300, #cbd5e1);
}

.markdown-body :deep(a) {
  color: var(--color-accent-cyan, #06b6d4);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(hr) {
  margin: 1.2em 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 40%, transparent);
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 13px;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 36%, transparent);
  text-align: left;
}

.markdown-body :deep(th) {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
  font-weight: 700;
}

/* ── 结构化区块 ─────────────────────────────────────────── */

.md-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.md-block-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-surface-500, #64748b);
}

.count-pill {
  min-width: 20px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface-600, #475569) 24%, transparent);
  color: var(--color-surface-400, #94a3b8);
  font-size: 10px;
  letter-spacing: 0;
}

.md-card {
  padding: 16px 18px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 36%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 26%, transparent);
}

.headline-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 4px;
}

.headline-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 14%, transparent);
  color: var(--color-accent-amber, #f59e0b);
  border: 1px solid color-mix(in srgb, var(--color-accent-amber, #f59e0b) 26%, transparent);
}

.headline-pill.violet {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 14%, transparent);
  color: var(--color-accent-violet, #a78bfa);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 26%, transparent);
}

.req-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.req-list li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 36%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
}

.req-level {
  flex: 0 0 auto;
  min-width: 58px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-align: center;
  text-transform: uppercase;
  font-family: var(--font-mono, monospace);
}

.req-level.MUST {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 18%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}

.req-level.SHOULD {
  background: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 18%, transparent);
  color: var(--color-accent-amber, #f59e0b);
}

.req-level.MAY {
  background: color-mix(in srgb, var(--color-accent-cyan, #06b6d4) 18%, transparent);
  color: var(--color-accent-cyan, #06b6d4);
}

.req-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.req-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-surface-100, #f1f5f9);
  word-break: break-word;
}

.req-text {
  font-size: 13px;
}

.scenarios {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scenario {
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 30%, transparent);
  border: 1px dashed color-mix(in srgb, var(--color-surface-700, #334155) 36%, transparent);
}

.scenario-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-accent-cyan, #06b6d4);
  margin-bottom: 4px;
}

.scenario-steps {
  margin: 0;
  padding-left: 1.2em;
}

.scenario-steps li {
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-surface-300, #cbd5e1);
}

.step-keyword {
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  color: var(--color-accent-amber, #f59e0b);
  margin-right: 5px;
}

.cap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cap-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 40%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 22%, transparent);
}

.cap-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-family: var(--font-mono, monospace);
  color: var(--color-surface-100, #f1f5f9);
}

.cap-meta {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
}

.delta-op {
  flex: 0 0 auto;
  min-width: 28px;
  padding: 3px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-align: center;
  text-transform: uppercase;
  font-family: var(--font-mono, monospace);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 16%, transparent);
  color: var(--color-accent-violet, #a78bfa);
}

.empty-state {
  padding: 64px 24px;
  text-align: center;
  font-size: 14px;
  color: var(--color-surface-600, #475569);
}
</style>
