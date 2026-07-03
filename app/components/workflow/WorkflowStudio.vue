<script setup lang="ts">
import { computed, ref, onActivated, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useWorkflow } from "../../plugins/workflowPlugin";
import { useOpenSpec } from "../../composables/useOpenSpec";
import { useBackend } from "../../composables/useBackend";
import { useMessages, stripSystemReminder } from "../../composables/useMessages";
import { getStagePrompt } from "../../composables/useStageRunner";
import { useContract } from "../../composables/useContract";
import { useTaskRunner } from "../../composables/useTaskRunner";
import { TIER_LABELS, stagesForTier, type StepName, type WorkflowTier } from "../../types/workflow";
import type { ExecutionContract } from "../../types/openspec";

const router = useRouter();
const wf = useWorkflow();
const openspec = useOpenSpec();
const backend = useBackend();
const msgStore = useMessages();
const { generateContract, loadContract } = useContract();
const taskRunner = useTaskRunner();

const LABELS: Record<StepName, string> = {
  explore: "Explore",
  propose: "Propose",
  plan: "Plan",
  apply: "Apply",
  verify: "Verify",
  review: "Review",
  archive: "Archive",
};
const SUBS: Record<StepName, string> = {
  explore: "需求澄清",
  propose: "固化 spec",
  plan: "任务拆解",
  apply: "TDD 实现",
  verify: "验证 Gate",
  review: "只读审查",
  archive: "归档",
};
const HINTS: Record<StepName, string> = {
  explore: "描述需求开始 — Agent 会 grilling 澄清边界（回复出现在这里）",
  propose: "点 ✦ AI 起草，基于需求生成 proposal / spec delta",
  plan: "由 proposal 拆解任务依赖 DAG",
  apply: "TDD 实现（红→绿）在主对话区进行",
  verify: "点 Run Gates，应用层真实执行 spec/lint/test/build",
  review: "只读审查 spec 合规与质量",
  archive: "归档前 evidence gate 检查",
};
const TIERS: Array<{ id: WorkflowTier; name: string; steps: string; fit: string; skip: string }> = [
  {
    id: "quick",
    name: "Quick",
    steps: "4 步",
    fit: "小需求",
    skip: "跳过 Explore · Plan · Review",
  },
  { id: "standard", name: "Standard", steps: "5 步", fit: "单模块", skip: "跳过 Plan · Review" },
  { id: "full", name: "Full", steps: "7 步", fit: "跨模块", skip: "不跳过任何阶段" },
];

const view = ref<"select" | "wf">(wf.enabled.value ? "wf" : "select");
const need = ref("");
const gating = ref(false);
const archiving = ref(false);
const draftMsg = ref("");
const archiveMsg = ref<{ ok: boolean; text: string } | null>(null);

onMounted(() => {
  if (wf.enabled.value) view.value = "wf";
});
onActivated(() => {
  if (wf.enabled.value) view.value = "wf";
});

const stages = computed(() => stagesForTier(wf.state.value.tier));
const cur = computed(() => wf.state.value.activeStep);
const activeIdx = computed(() => stages.value.indexOf(cur.value));
const isLast = computed(() => activeIdx.value === stages.value.length - 1);
const nextLabel = computed(() => (isLast.value ? "" : LABELS[stages.value[activeIdx.value + 1]]));
const changeId = computed(() => openspec.state.activeChanges[0]?.id ?? "");
const evidence = computed(() =>
  changeId.value ? openspec.state.evidence[changeId.value] : undefined,
);
const stageInteracted = computed(() => messages.value.length > 0 || injected.value[cur.value] === true);
const canAdvance = computed(() => !isLast.value && stageInteracted.value);
const displayTitle = computed(() => {
  if (changeId.value) return changeId.value;
  if (need.value.trim()) return need.value.slice(0, 30);
  return "新建探索";
});

function extractText(id: string): string {
  return msgStore
    .getParts(id)
    .filter((p) => p.type === "text" && !p.synthetic)
    .map((p) => (p.type === "text" ? stripSystemReminder(p.text).trim() : ""))
    .filter(Boolean)
    .join("\n");
}
const messages = computed(() =>
  msgStore
    .list()
    .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", text: extractText(m.id) }))
    .filter((m) => m.text),
);

const tddRed = computed(() => messages.value.some((m) => /fail|✗|exit [^0]/.test(m.text)));
const tddGreen = computed(() =>
  messages.value.some((m) => /pass.*[✓]|[✓].*pass|exit 0/.test(m.text)),
);

function stageState(i: number): "done" | "current" | "idle" {
  if (i === activeIdx.value) return "current";
  return i < activeIdx.value ? "done" : "idle";
}
function tierDots(t: WorkflowTier): number {
  return stagesForTier(t).length;
}
function tierFlow(t: WorkflowTier): string {
  return stagesForTier(t)
    .map((s) => LABELS[s])
    .join(" → ");
}

function pick(t: WorkflowTier) {
  wf.setTier(t);
  wf.enable();
  view.value = "wf";
  injected.value = {};
}
function backToSelect() {
  view.value = "select";
}
function gotoStage(s: StepName) {
  wf.setActiveStep(s);
  if (s === "apply" && changeId.value) {
    loadContract(changeId.value).then((c) => {
      if (c) contract.value = c;
    });
  }
}
function nextStage() {
  if (isLast.value) return;
  const from = cur.value;
  const to = stages.value[activeIdx.value + 1];
  wf.setActiveStep(to);
  if (from === "propose" && changeId.value) {
    generateContract(changeId.value, need.value || changeId.value, wf.state.value.tier);
  }
  if (to === "apply" && changeId.value) {
    loadContract(changeId.value).then((c) => {
      if (c) contract.value = c;
    });
  }
}

const injected = ref<Partial<Record<string, boolean>>>({});
const contract = ref<ExecutionContract | null | undefined>(undefined);
type DraftStage = "explore" | "propose" | "plan" | "apply" | "review";
async function draft(stage: DraftStage) {
  if (!need.value.trim()) {
    draftMsg.value = "请先输入";
    return;
  }
  const isFirst = !injected.value[stage];
  const change = openspec.state.activeChanges[0];
  const text = isFirst
    ? getStagePrompt(stage, {
        tier: wf.state.value.tier,
        changeId: changeId.value,
        need: need.value,
        brainstorm: change?.proposal?.raw ?? need.value,
        proposal: change?.proposal?.raw ?? "",
      })
    : need.value;
  injected.value[stage] = true;
  draftMsg.value = isFirst ? "已注入阶段指令 + 需求" : "已发送";
  if (!wf.state.value.label) {
    wf.state.value.label = need.value.slice(0, 40);
  }
  need.value = "";
  await backend.sendPrompt(text, []);
  window.setTimeout(() => (draftMsg.value = ""), 2500);
}
function sendForCurrent() {
  const s = cur.value;
  if (s === "explore" || s === "propose" || s === "plan" || s === "apply" || s === "review") {
    draft(s);
  }
}
async function runGates() {
  if (!changeId.value) return;
  gating.value = true;
  try {
    await openspec.runGates(changeId.value);
  } finally {
    gating.value = false;
  }
}
async function runSddTasks() {
  if (!changeId.value) return;
  const change = openspec.state.activeChanges.find((c) => c.id === changeId.value);
  if (!change) return;
  const pending = change.tasks.filter((t) => t.status === "pending");
  const specs = pending.map((t) => ({
    id: t.id,
    title: t.title,
    prompt: `你处于 Apply 阶段(TDD 模式)。\n任务: ${t.id} - ${t.title}\n${t.verification ? `验证命令: ${t.verification}` : ""}\n背景: ${change.proposal?.why ?? ""}\n\n流程:写测试→红灯→实现→绿灯→验证。只改这个 task scope,不改其他。完成后更新 tasks.md(${t.id} → [x])。`,
    verification: t.verification,
  }));
  const projectRoot = openspec.state.rootPath;
  taskRunner.setSpecs(specs);
  await taskRunner.loadPendingTasks(specs);
  await taskRunner.runAll(projectRoot || ".");
  for (const r of taskRunner.tasks.value) {
    if (r.status === "done") await openspec.toggleTask(changeId.value, r.taskId, true);
  }
  await openspec.refresh();
}
async function doArchive() {
  if (!changeId.value) return;
  archiving.value = true;
  try {
    const r = await openspec.archiveChange(changeId.value);
    archiveMsg.value = { ok: r.ok, text: r.ok ? "已归档" : r.reason || "归档失败" };
    if (r.ok) window.setTimeout(() => (archiveMsg.value = null), 2500);
  } finally {
    archiving.value = false;
  }
}

function verdictColor(v: string): string {
  if (v === "READY") return "var(--color-accent-emerald, #34d399)";
  if (v === "CONDITIONAL") return "var(--color-accent-amber, #fbbf24)";
  return "var(--color-accent-rose, #f43f5e)";
}
</script>

<template>
  <div class="wf-page">
    <!-- 选档屏 -->
    <div v-if="view === 'select'" class="select-pane">
      <h2>这次改动有多大？</h2>
      <p>不同档位走不同流程长度 — 展开看清区别再选</p>
      <div class="sel-cards">
        <button
          v-for="t in TIERS"
          :key="t.id"
          class="sel-card"
          :data-tier="t.id"
          @click="pick(t.id)"
        >
          <div class="sel-row1">
            <span class="sel-name">{{ t.name }}</span>
            <span class="sel-steps">{{ t.steps }}</span>
            <span class="sel-fit-tag">{{ t.fit }}</span>
          </div>
          <div class="sel-dots"><i v-for="n in tierDots(t.id)" :key="n" class="sel-pt" /></div>
          <div class="sel-flow">{{ tierFlow(t.id) }}</div>
          <div class="sel-skip">{{ t.skip }}</div>
        </button>
      </div>
    </div>

    <!-- 工作流 -->
    <div v-else class="wf-pane">
      <!-- 左轨道(均匀填满高度) -->
      <aside class="track">
        <div class="ckicker">流程 · {{ TIER_LABELS[wf.state.value.tier] }}</div>
        <div class="track-nodes">
          <template v-for="(s, i) in stages" :key="s">
            <button class="tnode" :class="stageState(i)" @click="gotoStage(s)">
              <span class="tnode-dot">
                <span v-if="stageState(i) === 'done'">✓</span>
                <span v-else>{{ i + 1 }}</span>
              </span>
              <span class="tnode-text">
                <span class="tnode-label">{{ LABELS[s] }}</span>
                <span class="tnode-sub">{{ SUBS[s] }}</span>
              </span>
            </button>
            <span v-if="i < stages.length - 1" class="tline" :class="stageState(i)" />
          </template>
        </div>
      </aside>

      <!-- 右侧 -->
      <div class="conv">
        <div class="header">
          <span class="back" @click="backToSelect">← 返回</span>
          <span class="h-title">
            <span class="accent">Spec 探索</span> · {{ displayTitle }}
            <span class="sub">{{ LABELS[cur] }} · {{ SUBS[cur] }}</span>
          </span>
          <span class="h-spacer" />
        </div>

        <!-- 对话流(真实当前会话消息) -->
        <div class="stream">
          <div v-if="messages.length === 0" class="stream-empty">{{ HINTS[cur] }}</div>
          <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <div class="avatar">{{ m.role === "user" ? "你" : "SF" }}</div>
            <div class="mb">
              <div class="name">{{ m.role === "user" ? "you" : "opencode · agent" }}</div>
              <div class="bubble">{{ m.text }}</div>
            </div>
          </div>

          <!-- Execution Contract(apply 阶段生效) -->
          <div v-if="cur === 'apply' && contract" class="contract-card">
            <div class="cc-head">Contract — {{ contract.changeId }} · {{ contract.tier }}</div>
            <div class="cc-section">
              <span class="cc-sl">Scope</span>
              <div v-for="f in contract.scope.files" :key="f" class="cc-item">▸ {{ f }}</div>
              <div v-if="contract.scope.api?.length" class="cc-item api">
                API: {{ contract.scope.api.join(", ") }}
              </div>
            </div>
            <div class="cc-section">
              <span class="cc-sl">Verify</span>
              <div v-for="v in contract.verify" :key="v.command" class="cc-item mon">
                <span class="cc-check">$</span> {{ v.command }}
                <span v-if="v.description" class="cc-desc">{{ v.description }}</span>
              </div>
            </div>
            <div v-if="contract.risks.length" class="cc-section">
              <span class="cc-sl">Risks</span>
              <div v-for="(r, i) in contract.risks" :key="i" class="cc-item warn">⚠ {{ r }}</div>
            </div>
          </div>

          <!-- Apply TDD 可视化 -->
          <div v-if="cur === 'apply'" class="tdd-bar">
            <span class="tdd-item" :class="tddRed ? 'red' : ''">
              <span class="tdd-light" :class="tddRed ? 'red' : ''"></span>RED · 写测试
            </span>
            <span class="tdd-line" :class="tddGreen ? 'green' : tddRed ? 'progress' : ''"></span>
            <span class="tdd-item" :class="tddGreen ? 'green' : ''">
              <span class="tdd-light" :class="tddGreen ? 'green' : ''"></span>GREEN · 通过
            </span>
          </div>

          <!-- SDD Task Runner(apply 阶段) -->
          <div v-if="cur === 'apply'" class="sdd-panel">
            <div class="sdd-head">
              <span class="sdd-title">SDD · 子代理任务</span>
              <button
                class="sdd-run-btn"
                :disabled="taskRunner.busy.value || !changeId"
                @click="runSddTasks"
              >
                {{ taskRunner.busy.value ? "运行中…" : "▶ 运行全部待办" }}
              </button>
            </div>
            <div v-if="!taskRunner.tasks.value.length && !taskRunner.busy.value" class="sdd-empty">
              没有待办任务。{{ changeId ? '点上方「运行全部待办」或先检查 tasks.md' : '先创建一个 change' }}
            </div>
            <div v-for="t in taskRunner.tasks.value" :key="t.taskId" class="sdd-row">
              <span class="sdd-status" :class="t.status">
                {{ t.status === "pending" ? "○" : t.status === "running" ? "◐" : t.status === "done" ? "✓" : "✗" }}
              </span>
              <span class="sdd-id">{{ t.taskId }}</span>
              <span class="sdd-label">{{ t.title }}</span>
              <span v-if="t.status === 'running'" class="sdd-spin">⋯</span>
              <span v-else-if="t.status === 'done'" class="sdd-exit pass">exit 0</span>
              <span v-else-if="t.status === 'failed'" class="sdd-exit fail">exit {{ t.exitCode ?? "?" }}</span>
            </div>
          </div>

          <!-- review verdict 卡片 -->
          <div v-if="cur === 'review'" class="review-card">
            <div class="rc-head">Review Verdict</div>
            <div class="rc-row">
              <span class="rc-key">Spec 合规</span><span class="rc-val">—</span>
            </div>
            <div class="rc-row">
              <span class="rc-key">代码质量</span><span class="rc-val">—</span>
            </div>
            <div class="rc-row">
              <span class="rc-key">Scope creep</span><span class="rc-val">—</span>
            </div>
          </div>

          <!-- verify 真实 evidence -->
          <div v-if="cur === 'verify' && evidence" class="evidence-card">
            <div class="ev-head">
              <span class="ev-label">Verdict</span>
              <span
                class="verdict"
                :style="{
                  color: verdictColor(evidence.verdict),
                  borderColor: verdictColor(evidence.verdict),
                }"
                >{{ evidence.verdict }}</span
              >
            </div>
            <div v-for="g in evidence.gates" :key="g.layer" class="grow">
              <span class="gl">{{ g.layer }}</span>
              <code class="gc">{{ g.command }}</code>
              <span class="gx" :class="g.exitCode === null ? 'skip' : g.passed ? 'pass' : 'fail'">
                {{ g.exitCode === null ? "skip" : g.passed ? "✓ 0" : "✗ " + g.exitCode }}
              </span>
            </div>
          </div>
        </div>

        <!-- composer(阶段特定) -->
        <div class="composer">
          <template v-if="cur === 'explore'">
            <input
              v-model="need"
              placeholder="描述需求 / 回答 grilling… (Enter 发送)"
              @keydown.enter="draft('explore')"
            />
            <button class="btn violet" @click="draft('explore')">发送</button>
          </template>
          <template v-else-if="cur === 'propose'">
            <input
              v-model="need"
              placeholder="先描述改动（必填）…"
              @keydown.enter="draft('propose')"
            />
            <button class="btn violet" :disabled="!need.trim()" @click="draft('propose')">
              ✦ AI 起草
            </button>
          </template>
          <template v-else-if="cur === 'plan' || cur === 'apply' || cur === 'review'">
            <input
              v-model="need"
              :placeholder="`${LABELS[cur]} 阶段 — 输入指令 / 补充… (首次发送注入阶段指令)`"
              @keydown.enter="sendForCurrent"
            />
            <button class="btn violet" :disabled="!need.trim()" @click="sendForCurrent">
              发送
            </button>
            <button
              class="btn ghost"
              @click="router.push('/chat')"
              title="代码生成/审查在主对话区进行"
            >
              主对话 →
            </button>
          </template>
          <template v-else-if="cur === 'verify'">
            <button class="btn emerald" :disabled="gating || !changeId" @click="runGates">
              {{ gating ? "运行中…" : "Run Gates" }}
            </button>
            <span v-if="!changeId" class="composer-hint warn">需要先有 active change</span>
          </template>
          <template v-else-if="cur === 'archive'">
            <span v-if="evidence?.verdict === 'NOT_READY'" class="gate-note"
              >⚠ NOT_READY — gate 将阻止归档</span
            >
            <button class="btn ghost" :disabled="archiving || !changeId" @click="doArchive">
              {{ archiving ? "归档中…" : "Archive" }}
            </button>
            <span v-if="archiveMsg" :class="archiveMsg.ok ? 'composer-hint ok' : 'gate-note'">{{
              archiveMsg.text
            }}</span>
          </template>
          <span v-if="draftMsg" class="composer-hint warn">{{ draftMsg }}</span>
        </div>

        <!-- 下一步(composer 下方,仅在当前阶段有交互后显示) -->
        <div v-if="canAdvance" class="advance-bar">
          <button class="next-cta" @click="nextStage">
            <span>完成 {{ LABELS[cur] }} · 进入 <b>{{ nextLabel }}</b></span>
            <span class="next-cta-arrow">→</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wf-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  font-size: 14px;
  color: var(--color-surface-200, #e2e8f0);
  background:
    radial-gradient(circle at 14% 0%, rgba(167, 139, 250, 0.05), transparent 42%),
    radial-gradient(circle at 86% 100%, rgba(34, 211, 238, 0.04), transparent 42%);
}

/* 选档 */
.select-pane {
  flex: 1;
  overflow-y: auto;
  padding: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.select-pane h2 {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--color-surface-100, #f1f5f9);
}
.select-pane > p {
  font-size: 14px;
  color: var(--color-surface-400, #94a3b8);
  margin-top: 8px;
  text-align: center;
}
.sel-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 28px;
  width: 100%;
  max-width: 580px;
}
.sel-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 70%, transparent);
  border: 1px solid var(--color-surface-800, #1e293b);
  border-left: 3px solid var(--color-surface-700, #334155);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font-family: inherit;
  transition: all 0.18s;
}
.sel-card:hover {
  transform: translateX(3px);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 55%, #fff 5%);
}
.sel-card[data-tier="quick"]:hover {
  border-left-color: var(--color-accent-emerald, #34d399);
}
.sel-card[data-tier="standard"]:hover {
  border-left-color: var(--color-accent-violet, #a78bfa);
}
.sel-card[data-tier="full"]:hover {
  border-left-color: var(--color-accent-amber, #fbbf24);
}
.sel-row1 {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.sel-name {
  font-size: 16px;
  font-weight: 700;
}
.sel-steps {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
}
.sel-fit-tag {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-surface-500, #64748b);
}
.sel-dots {
  display: flex;
  gap: 6px;
}
.sel-pt {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.sel-card[data-tier="quick"] .sel-pt {
  background: var(--color-accent-emerald, #34d399);
  opacity: 0.7;
}
.sel-card[data-tier="standard"] .sel-pt {
  background: var(--color-accent-violet, #a78bfa);
  opacity: 0.7;
}
.sel-card[data-tier="full"] .sel-pt {
  background: var(--color-accent-amber, #fbbf24);
  opacity: 0.7;
}
.sel-card:hover .sel-pt {
  opacity: 1;
}
.sel-flow {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-surface-400, #94a3b8);
}
.sel-skip {
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
}

/* 工作流 */
.wf-pane {
  flex: 1;
  display: flex;
  min-height: 0;
}
.track {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-surface-800, #1e293b);
  padding: 18px 16px;
  overflow-y: auto;
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 50%, transparent);
  display: flex;
  flex-direction: column;
}
.ckicker {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-surface-600, #475569);
  margin-bottom: 18px;
  font-family: var(--font-mono, monospace);
  flex-shrink: 0;
}
.track-nodes {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 0;
}
.tnode {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  text-align: left;
}
.tnode-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--color-surface-700, #334155);
  background: var(--color-surface-950, #020617);
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
  transition: all 0.2s;
}
.tnode.done .tnode-dot {
  border-color: var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 15%, transparent);
  color: var(--color-accent-violet, #a78bfa);
}
.tnode.current .tnode-dot {
  border-color: var(--color-accent-violet, #a78bfa);
  background: var(--color-accent-violet, #a78bfa);
  color: #1e1b3a;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent-violet, #a78bfa) 20%, transparent);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--color-accent-violet, #a78bfa) 8%, transparent);
  }
}
.tnode-text {
  display: flex;
  flex-direction: column;
  padding-top: 1px;
}
.tnode-label {
  font-size: 13px;
  color: var(--color-surface-500, #64748b);
}
.tnode.done .tnode-label {
  color: var(--color-surface-300, #cbd5e1);
}
.tnode.current .tnode-label {
  color: var(--color-surface-100, #f1f5f9);
  font-weight: 600;
}
.tnode-sub {
  font-size: 11px;
  color: var(--color-surface-600, #475569);
  font-family: var(--font-mono, monospace);
  margin-top: 1px;
}
.tline {
  display: block;
  width: 2px;
  flex: 1;
  min-height: 12px;
  background: var(--color-surface-800, #1e293b);
  margin-left: 10px;
}
.tline.done {
  background: var(--color-accent-violet, #a78bfa);
}

/* 右侧 */
.conv {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
  flex-shrink: 0;
}
.back {
  color: var(--color-surface-500, #64748b);
  font-size: 13px;
  cursor: pointer;
  font-family: var(--font-mono, monospace);
}
.back:hover {
  color: var(--color-surface-300, #cbd5e1);
}
.h-title {
  font-size: 15px;
  font-weight: 600;
}
.h-title .accent {
  color: var(--color-accent-violet, #a78bfa);
}
.h-title .sub {
  color: var(--color-surface-500, #64748b);
  font-weight: 400;
  font-size: 13px;
  margin-left: 10px;
  font-family: var(--font-mono, monospace);
}

/* 对话流 */
.stream {
  flex: 1;
  overflow-y: auto;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.stream-empty {
  color: var(--color-surface-600, #475569);
  font-size: 14px;
  padding: 24px 0;
  text-align: center;
}
.msg {
  display: flex;
  gap: 11px;
  max-width: 820px;
}
.msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
}
.msg.assistant .avatar {
  background: linear-gradient(135deg, var(--color-accent-violet, #a78bfa), #8b5cf6);
  color: #1e1b3a;
}
.msg.user .avatar {
  background: var(--color-surface-800, #1e293b);
  color: var(--color-surface-300, #cbd5e1);
}
.mb {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-surface-500, #64748b);
  margin-bottom: 4px;
  font-family: var(--font-mono, monospace);
}
.msg.assistant .name {
  color: var(--color-accent-violet, #a78bfa);
}
.bubble {
  padding: 11px 15px;
  border-radius: 11px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.assistant .bubble {
  background: var(--color-surface-800, #1e293b);
  color: var(--color-surface-200, #e2e8f0);
  border-top-left-radius: 3px;
}
.msg.user .bubble {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  color: #ddd6fe;
  border: 1px solid color-mix(in srgb, var(--color-accent-violet, #a78bfa) 25%, transparent);
  border-top-right-radius: 3px;
}

/* evidence 卡 */
.evidence-card {
  align-self: flex-start;
  margin-left: 41px;
  max-width: 820px;
  border: 1px solid var(--color-surface-800, #1e293b);
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 50%, transparent);
}

.contract-card {
  align-self: flex-start;
  margin-left: 41px;
  max-width: 820px;
  width: 100%;
  border: 1px solid var(--color-accent-amber, #fbbf24);
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 50%, transparent);
}
.cc-head {
  padding: 9px 14px;
  background: var(--color-surface-900, #0f172a);
  border-bottom: 1px solid color-mix(in srgb, var(--color-accent-amber, #fbbf24) 30%, transparent);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent-amber, #fbbf24);
  letter-spacing: 0.04em;
}
.cc-section {
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cc-section:last-child {
  border-bottom: none;
}
.cc-sl {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-surface-500, #64748b);
  font-weight: 600;
  margin-bottom: 3px;
}
.cc-item {
  font-size: 12px;
  color: var(--color-surface-300, #cbd5e1);
  font-family: var(--font-mono, monospace);
  padding-left: 8px;
}
.cc-item.api {
  color: var(--color-accent-violet, #a78bfa);
}
.cc-item.warn {
  color: var(--color-accent-rose, #f43f5e);
}
.cc-item.mon {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cc-check {
  color: var(--color-surface-500, #64748b);
}
.cc-desc {
  color: var(--color-surface-500, #64748b);
  font-size: 10px;
  font-family: var(--font-sans);
}

.sdd-panel {
  align-self: flex-start;
  margin-left: 41px;
  max-width: 820px;
  width: 100%;
  border: 1px solid var(--color-surface-800, #1e293b);
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 50%, transparent);
}
.sdd-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  background: var(--color-surface-900, #0f172a);
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
}
.sdd-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-surface-400, #94a3b8);
}
.sdd-run-btn {
  margin-left: auto;
  background: var(--color-accent-violet, #a78bfa);
  color: #1e1b3a;
  border: none;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.sdd-run-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sdd-empty {
  padding: 14px;
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
  text-align: center;
}
.sdd-row {
  display: grid;
  grid-template-columns: 20px 40px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 7px 14px;
  font-size: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
}
.sdd-row:last-child {
  border-bottom: none;
}
.sdd-status {
  font-size: 14px;
  font-family: var(--font-mono, monospace);
}
.sdd-status.pending {
  color: var(--color-surface-500, #64748b);
}
.sdd-status.running {
  color: var(--color-accent-amber, #fbbf24);
}
.sdd-status.done {
  color: var(--color-accent-emerald, #34d399);
}
.sdd-status.failed {
  color: var(--color-accent-rose, #f43f5e);
}
.sdd-id {
  font-family: var(--font-mono, monospace);
  color: var(--color-surface-500, #64748b);
}
.sdd-label {
  color: var(--color-surface-200, #e2e8f0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdd-spin {
  font-size: 16px;
  color: var(--color-accent-amber, #fbbf24);
}
.sdd-exit {
  font-family: var(--font-mono, monospace);
  font-weight: 700;
  font-size: 11px;
}
.sdd-exit.pass {
  color: var(--color-accent-emerald, #34d399);
}
.sdd-exit.fail {
  color: var(--color-accent-rose, #f43f5e);
}

.tdd-bar {
  align-self: flex-start;
  margin-left: 41px;
  display: flex;
  align-items: center;
  gap: 0;
  padding: 10px 14px;
  border: 1px solid var(--color-surface-800, #1e293b);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 50%, transparent);
  font-size: 12px;
  font-family: var(--font-mono, monospace);
}
.tdd-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-surface-500, #64748b);
}
.tdd-item.red {
  color: var(--color-accent-rose, #f43f5e);
}
.tdd-item.green {
  color: var(--color-accent-emerald, #34d399);
}
.tdd-light {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--color-surface-700, #334155);
  background: var(--color-surface-950, #020617);
  transition: all 0.3s;
}
.tdd-light.red {
  border-color: var(--color-accent-rose, #f43f5e);
  background: var(--color-accent-rose, #f43f5e);
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-accent-rose, #f43f5e) 50%, transparent);
}
.tdd-light.green {
  border-color: var(--color-accent-emerald, #34d399);
  background: var(--color-accent-emerald, #34d399);
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-accent-emerald, #34d399) 50%, transparent);
}
.tdd-line {
  width: 40px;
  height: 2px;
  background: var(--color-surface-700, #334155);
  margin: 0 12px;
  transition: background 0.3s;
}
.tdd-line.progress {
  background: var(--color-accent-rose, #f43f5e);
}
.tdd-line.green {
  background: var(--color-accent-emerald, #34d399);
}

.review-card {
  align-self: flex-start;
  margin-left: 41px;
  max-width: 820px;
  border: 1px solid var(--color-surface-800, #1e293b);
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-surface-950, #020617) 50%, transparent);
}
.rc-head {
  padding: 9px 14px;
  background: var(--color-surface-900, #0f172a);
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-surface-400, #94a3b8);
}
.rc-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px;
  padding: 8px 14px;
  font-size: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 50%, transparent);
}
.rc-row:last-child {
  border-bottom: none;
}
.rc-key {
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
.rc-val {
  color: var(--color-surface-400, #94a3b8);
}
.ev-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  background: var(--color-surface-900, #0f172a);
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
}
.ev-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-surface-500, #64748b);
  font-weight: 600;
}
.verdict {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 9px;
  border: 1px solid;
  border-radius: 4px;
  letter-spacing: 0.04em;
}
.grow {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 9px 14px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-surface-800, #1e293b) 55%, transparent);
}
.grow:last-child {
  border-bottom: none;
}
.gl {
  color: var(--color-accent-violet, #a78bfa);
  text-transform: uppercase;
  font-size: 11px;
}
.gc {
  color: var(--color-surface-400, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gx {
  font-weight: 700;
  font-size: 12px;
}
.gx.pass {
  color: var(--color-accent-emerald, #34d399);
}
.gx.fail {
  color: var(--color-accent-rose, #f43f5e);
}
.gx.skip {
  color: var(--color-surface-600, #475569);
}

.advance-bar {
  flex-shrink: 0;
  padding: 0 22px 14px;
}
.next-cta {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-accent-violet, #a78bfa) 35%, transparent);
  border-radius: 10px;
  cursor: pointer;
  color: var(--color-surface-200, #e2e8f0);
  font-size: 14px;
  font-family: inherit;
  transition: all 0.15s;
}
.next-cta:hover {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 18%, transparent);
}
.next-cta b {
  color: var(--color-accent-violet, #a78bfa);
  font-weight: 700;
}
.next-cta-arrow {
  color: var(--color-accent-violet, #a78bfa);
  font-size: 18px;
  font-family: var(--font-mono, monospace);
  margin-left: auto;
}

/* composer */
.composer {
  flex-shrink: 0;
  padding: 14px 22px;
  border-top: 1px solid var(--color-surface-800, #1e293b);
  display: flex;
  gap: 10px;
  align-items: center;
  background: var(--color-surface-900, #0f172a);
}
.composer input {
  flex: 1;
  background: var(--color-surface-800, #1e293b);
  border: 1px solid var(--color-surface-700, #334155);
  border-radius: 9px;
  padding: 11px 15px;
  color: var(--color-surface-100, #f1f5f9);
  font-size: 14px;
  font-family: inherit;
  outline: none;
}
.composer input:focus {
  border-color: var(--color-accent-violet, #a78bfa);
}
.composer input::placeholder {
  color: var(--color-surface-600, #475569);
}
.composer-hint {
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
}
.composer-hint.warn {
  color: var(--color-accent-amber, #fbbf24);
}
.composer-hint.ok {
  color: var(--color-accent-emerald, #34d399);
}
.btn {
  border: none;
  border-radius: 9px;
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.btn.violet {
  background: var(--color-accent-violet, #a78bfa);
  color: #1e1b3a;
}
.btn.emerald {
  background: var(--color-accent-emerald, #34d399);
  color: #052e1b;
}
.btn.ghost {
  background: transparent;
  color: var(--color-surface-400, #94a3b8);
  border: 1px solid var(--color-surface-700, #334155);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn:hover:not(:disabled) {
  filter: brightness(1.08);
}
.gate-note {
  font-size: 12px;
  color: var(--color-accent-rose, #f43f5e);
  font-family: var(--font-mono, monospace);
}
</style>
