<script setup lang="ts">
import { computed, ref, onActivated, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useWorkflow } from "../../plugins/workflowPlugin";
import { useOpenSpec } from "../../composables/useOpenSpec";
import { useBackend } from "../../composables/useBackend";
import { useMessages, stripSystemReminder } from "../../composables/useMessages";
import { getStagePrompt } from "../../composables/useStageRunner";
import { useContract } from "../../composables/useContract";
import { useTaskRunner } from "../../composables/useTaskRunner";
import { TIER_LABELS, stagesForTier, type StepName, type WorkflowTier } from "../../types/workflow";
import type { ExecutionContract } from "../../types/openspec";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
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

const TIER_KEYS = ["lean", "standard", "thorough"] as const;

const need = ref("");
const gating = ref(false);
const archiving = ref(false);
const draftMsg = ref("");
const archiveMsg = ref<{ ok: boolean; text: string } | null>(null);
const STAGE_SESSIONS_KEY = "specforge.workflow.stageSessions";
const CHANGE_TIERS_KEY = "specforge.workflow.changeTiers";
const stageSessions = ref<Record<string, Partial<Record<StepName, string>>>>(
  JSON.parse(localStorage.getItem(STAGE_SESSIONS_KEY) || "{}"),
);
const changeTiers = ref<Record<string, WorkflowTier>>(
  JSON.parse(localStorage.getItem(CHANGE_TIERS_KEY) || "{}"),
);
const draftKnownChangeIds = ref<Set<string>>(new Set());
const creatingDraftChange = ref(false);

const stages = computed(() => stagesForTier(wf.state.value.tier));
const cur = computed(() => wf.state.value.activeStep);
const activeIdx = computed(() => stages.value.indexOf(cur.value));
const isLast = computed(() => activeIdx.value === stages.value.length - 1);
const nextLabel = computed(() => (isLast.value ? "" : LABELS[stages.value[activeIdx.value + 1]]));
const requestedChangeId = computed(() => {
  const value = route.query.change;
  return typeof value === "string" ? value : "";
});
const selectedChange = computed(() => {
  if (creatingDraftChange.value) return undefined;
  if (requestedChangeId.value) {
    return openspec.state.activeChanges.find((change) => change.id === requestedChangeId.value);
  }
  return undefined;
});
const changeId = computed(() => selectedChange.value?.id ?? "");
const evidence = computed(() =>
  changeId.value ? openspec.state.evidence[changeId.value] : undefined,
);
const stageInteracted = computed(
  () => messages.value.length > 0 || injected.value[cur.value] === true,
);
const canAdvance = computed(() => !isLast.value && stageInteracted.value);
const displayTitle = computed(() => {
  if (changeId.value) return changeId.value;
  if (need.value.trim()) return need.value.slice(0, 30);
  return "新建探索";
});

const workflowKey = computed(() => changeId.value || wf.state.value.label || "__draft__");

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findSessionForChange(id: string): string | undefined {
  const needle = normalizeLookup(id);
  if (!needle) return undefined;
  return backend.sessions.value.find((session) => {
    return [session.id, session.slug, session.title].some((value) =>
      normalizeLookup(value || "").includes(needle),
    );
  })?.id;
}

function stageSessionId(stage: StepName): string | undefined {
  return (
    stageSessions.value[workflowKey.value]?.[stage] ||
    wf.state.value.steps[stage]?.sessionId ||
    (changeId.value ? findSessionForChange(changeId.value) : undefined)
  );
}

function rememberStageSession(stage: StepName, sessionId?: string) {
  if (!sessionId) return;
  const key = workflowKey.value;
  stageSessions.value[key] = {
    ...(stageSessions.value[key] ?? {}),
    [stage]: sessionId,
  };
  localStorage.setItem(STAGE_SESSIONS_KEY, JSON.stringify(stageSessions.value));
  if (wf.state.value.steps[stage]) {
    wf.state.value.steps[stage]!.sessionId = sessionId;
  }
}

async function openStageSession(stage: StepName) {
  const sessionId = stageSessionId(stage);
  if (!sessionId || backend.selectedSessionId.value === sessionId) return;
  await backend.selectSession(sessionId);
}

function stageForChange(): StepName {
  const change = selectedChange.value;
  if (!change) return wf.state.value.activeStep;
  if (openspec.state.evidence[change.id]) return "verify";
  if (change.taskStats.total > 0) return "apply";
  if (change.deltaSpecs.length > 0 || change.proposal) return "propose";
  return "explore";
}

function tierForChange(stage: StepName): WorkflowTier {
  if (!changeId.value) return wf.state.value.tier;
  const remembered = changeTiers.value[changeId.value];
  if (remembered) return remembered;
  const sessions = stageSessions.value[changeId.value];
  if (sessions?.plan || sessions?.review) return "thorough";
  if (sessions?.explore) return "standard";
  if (stage === "explore") return "standard";
  return "lean";
}

function openSelectedChange() {
  if (!requestedChangeId.value) return;
  if (!changeId.value) return;
  wf.enable();
  const inferredStage = stageForChange();
  const nextTier = tierForChange(inferredStage);
  const nextStages = stagesForTier(nextTier);
  wf.setTier(nextTier);
  wf.setActiveStep(nextStages.includes(inferredStage) ? inferredStage : nextStages[0]);
  wf.state.value.label = changeId.value;
  creatingDraftChange.value = false;
}

onMounted(openSelectedChange);
onActivated(openSelectedChange);
// 外部请求新建草稿(TierPickerDialog 触发)→ 执行 pick 并消费标记
watch(
  () => wf.pendingNewDraftTier.value,
  (tier) => {
    if (tier) {
      pick(tier);
      wf.pendingNewDraftTier.value = null;
    }
  },
  { immediate: true },
);
watch(
  () => [
    requestedChangeId.value,
    openspec.state.activeChanges.length,
    openspec.state.lastRefreshedAt,
  ],
  openSelectedChange,
);
watch(
  () => [openspec.state.activeChanges.length, openspec.state.lastRefreshedAt],
  () => {
    if (!creatingDraftChange.value || requestedChangeId.value) return;
    const created = openspec.state.activeChanges.find(
      (change) => !draftKnownChangeIds.value.has(change.id),
    );
    if (!created) return;
    changeTiers.value[created.id] = wf.state.value.tier;
    localStorage.setItem(CHANGE_TIERS_KEY, JSON.stringify(changeTiers.value));
    if (stageSessions.value.__draft__) {
      stageSessions.value[created.id] = { ...stageSessions.value.__draft__ };
      delete stageSessions.value.__draft__;
      localStorage.setItem(STAGE_SESSIONS_KEY, JSON.stringify(stageSessions.value));
    }
    wf.state.value.label = created.id;
    creatingDraftChange.value = false;
    router.replace({ name: "workflow", query: { change: created.id } });
  },
);

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

function stageState(i: number): "done" | "current" | "locked" {
  if (i === activeIdx.value) return "current";
  return i < activeIdx.value ? "done" : "locked";
}
function canOpenStage(i: number): boolean {
  return i <= activeIdx.value;
}

function pick(t: WorkflowTier) {
  if (route.query.change) {
    router.replace({ name: "workflow" });
  }
  draftKnownChangeIds.value = new Set(openspec.state.activeChanges.map((change) => change.id));
  creatingDraftChange.value = true;
  wf.setTier(t);
  wf.enable();
  injected.value = {};
  wf.state.value.label = "";
  need.value = "";
  draftMsg.value = "";
  contract.value = undefined;
}
function gotoStage(s: StepName) {
  const idx = stages.value.indexOf(s);
  if (idx > activeIdx.value) return;
  wf.setActiveStep(s);
  void openStageSession(s);
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
  rememberStageSession(from, backend.selectedSessionId.value);
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
  const change = selectedChange.value;
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
  const sent = await backend.sendPrompt(text, []);
  if (sent) {
    rememberStageSession(stage, backend.selectedSessionId.value);
    const currentChangeId = selectedChange.value?.id;
    if (currentChangeId) {
      changeTiers.value[currentChangeId] = wf.state.value.tier;
      localStorage.setItem(CHANGE_TIERS_KEY, JSON.stringify(changeTiers.value));
    } else {
      creatingDraftChange.value = true;
    }
  }
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
  const change = selectedChange.value;
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
    <!-- 未启用工作流:模块介绍 -->
    <div v-if="!wf.enabled.value" class="wf-intro">
      <div class="wf-intro-kicker">{{ t("workflow.intro.kicker") }}</div>
      <h2 class="wf-intro-title">{{ t("workflow.intro.title") }}</h2>
      <p class="wf-intro-sub">{{ t("workflow.intro.sub") }}</p>
      <div class="wf-intro-flow">
        <span>Explore</span><i>→</i> <span>Propose</span><i>→</i> <span>Plan</span><i>→</i>
        <span>Apply</span><i>→</i> <span>Verify</span><i>→</i> <span>Review</span><i>→</i>
        <span>Archive</span>
      </div>
      <div class="wf-intro-tiers">
        <span v-for="tk in TIER_KEYS" :key="tk" class="wf-tier" :data-tier="tk">
          <i class="wf-tier-dot" />{{ t(`workflow.intro.tiers.${tk}.name`)
          }}<em>{{ t(`workflow.intro.tiers.${tk}.steps`) }}</em
          >{{ t(`workflow.intro.tiers.${tk}.fit`) }}
        </span>
      </div>
      <div class="wf-intro-cta">
        {{ t("workflow.intro.ctaPre") }} <strong>+</strong> {{ t("workflow.intro.ctaPost") }}
      </div>
    </div>

    <!-- 工作流 -->
    <div v-else class="wf-pane">
      <!-- 左轨道(均匀填满高度) -->
      <aside class="track">
        <div class="ckicker">流程 · {{ TIER_LABELS[wf.state.value.tier] }}</div>
        <div class="track-nodes">
          <template v-for="(s, i) in stages" :key="s">
            <button
              class="tnode"
              :class="stageState(i)"
              :disabled="!canOpenStage(i)"
              :title="canOpenStage(i) ? '' : '完成当前阶段后才能进入'"
              @click="gotoStage(s)"
            >
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
          <div class="h-title">
            <span class="h-main">{{ displayTitle }}</span>
            <span class="h-sub">Spec 探索</span>
          </div>
          <span class="stage-pill">{{ LABELS[cur] }}</span>
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
              没有待办任务。{{
                changeId ? "点上方「运行全部待办」或先检查 tasks.md" : "先创建一个 change"
              }}
            </div>
            <div v-for="task in taskRunner.tasks.value" :key="task.taskId" class="sdd-row">
              <span class="sdd-status" :class="task.status">
                {{
                  task.status === "pending"
                    ? "○"
                    : task.status === "running"
                      ? "◐"
                      : task.status === "done"
                        ? "✓"
                        : "✗"
                }}
              </span>
              <span class="sdd-id">{{ task.taskId }}</span>
              <span class="sdd-label">{{ task.title }}</span>
              <span v-if="task.status === 'running'" class="sdd-spin">⋯</span>
              <span v-else-if="task.status === 'done'" class="sdd-exit pass">exit 0</span>
              <span v-else-if="task.status === 'failed'" class="sdd-exit fail"
                >exit {{ task.exitCode ?? "?" }}</span
              >
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
            <span
              >完成 {{ LABELS[cur] }} · 进入 <b>{{ nextLabel }}</b></span
            >
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

/* 未启用工作流的模块介绍 */
.wf-intro {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px;
  text-align: center;
}
.wf-intro-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-accent-violet, #a78bfa);
}
.wf-intro-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--color-surface-100, #f1f5f9);
}
.wf-intro-sub {
  margin: 0;
  max-width: 520px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-surface-400, #94a3b8);
}
.wf-intro-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 8px;
  margin-top: 6px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.wf-intro-flow span {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 60%, transparent);
  color: var(--color-surface-300, #cbd5e1);
}
.wf-intro-flow i {
  font-style: normal;
  color: var(--color-surface-600, #475569);
}
.wf-intro-tiers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 14px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-surface-400, #94a3b8);
}
.wf-tier {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wf-tier-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.wf-tier em {
  font-style: normal;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--color-surface-500, #64748b);
  margin: 0 2px;
}
.wf-tier[data-tier="lean"] .wf-tier-dot {
  background: var(--color-accent-emerald, #34d399);
}
.wf-tier[data-tier="standard"] .wf-tier-dot {
  background: var(--color-accent-violet, #a78bfa);
}
.wf-tier[data-tier="thorough"] .wf-tier-dot {
  background: var(--color-accent-amber, #fbbf24);
}
.wf-intro-cta {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-surface-500, #64748b);
}
.wf-intro-cta strong {
  display: inline-block;
  margin: 0 2px;
  padding: 1px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 18%, transparent);
  color: var(--color-accent-violet, #a78bfa);
  font-weight: 800;
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
.tnode:disabled {
  cursor: not-allowed;
}
.tnode.done:hover .tnode-label,
.tnode.current:hover .tnode-label {
  color: var(--color-surface-100, #f1f5f9);
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
.tnode.locked .tnode-dot {
  background: transparent;
  border-color: color-mix(in srgb, var(--color-surface-700, #334155) 70%, transparent);
  color: var(--color-surface-500, #64748b);
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
.tnode.locked .tnode-label,
.tnode.locked .tnode-sub {
  color: color-mix(in srgb, var(--color-surface-600, #475569) 78%, transparent);
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
  gap: 10px;
  min-height: 52px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--color-surface-800, #1e293b);
  flex-shrink: 0;
}
.h-title {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.h-main {
  overflow: hidden;
  color: var(--color-surface-100, #f1f5f9);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.h-sub {
  color: var(--color-surface-600, #475569);
  font-size: 11px;
  line-height: 1.2;
}
.stage-pill {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  color: var(--color-accent-violet, #a78bfa);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
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
