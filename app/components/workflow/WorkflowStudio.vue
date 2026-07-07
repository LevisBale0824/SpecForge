<script setup lang="ts">
import { computed, ref, onActivated, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useWorkflow } from "../../plugins/workflowPlugin";
import { useOpenSpec } from "../../composables/useOpenSpec";
import { useBackend } from "../../composables/useBackend";
import { useMessages, stripSystemReminder } from "../../composables/useMessages";
import { getStagePrompt } from "../../composables/useStageRunner";
import { useStageSessions } from "../../composables/useStageSessions";
import { useContract, checkRequirementsCoverage } from "../../composables/useContract";
import { useTaskRunner } from "../../composables/useTaskRunner";
import { useAutoScroller, type ScrollMode } from "../../composables/useAutoScroller";
import { useDisplayNames } from "../../composables/useDisplayNames";
import MessageContent from "../MessageContent.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import { TIER_LABELS, stagesForTier, type StepName, type WorkflowTier } from "../../types/workflow";
import type { ExecutionContract, ContractStaleResult } from "../../types/openspec";
import {
  encodeStageSuffix,
  decodeStageBinding,
  stripStageSuffix,
} from "../../utils/stageTitleEncoding";

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const wf = useWorkflow();
const openspec = useOpenSpec();
const backend = useBackend();
const msgStore = useMessages();
const { generateContract, loadContract, checkStale } = useContract();
const taskRunner = useTaskRunner();

const TIER_KEYS = ["standard", "thorough"] as const;

function stageLabel(s: StepName): string {
  return t(`workflow.stages.${s}.label`);
}
function stageSub(s: StepName): string {
  return t(`workflow.stages.${s}.sub`);
}
function stageHint(s: StepName): string {
  return t(`workflow.stages.${s}.hint`);
}

const need = ref("");
const gating = ref(false);
const archiving = ref(false);
const archiveConfirmDialog = ref<InstanceType<typeof ConfirmDialog> | null>(null);
const draftMsg = ref("");
const archiveMsg = ref<{ ok: boolean; text: string } | null>(null);
const CHANGE_TIERS_KEY = "specforge.workflow.changeTiers";
const stageSessionsStore = useStageSessions();
const changeTiers = ref<Record<string, WorkflowTier>>(
  JSON.parse(localStorage.getItem(CHANGE_TIERS_KEY) || "{}"),
);
const draftKnownChangeIds = ref<Set<string>>(new Set());
const creatingDraftChange = ref(false);
// Snapshot of in-progress draft state, taken when user navigates away to an
// active change. Used to restore the draft when the route returns to no-?change=.
// Without this, opening an active change overwrites label/tier/activeStep and
// the user's explore conversation appears lost even though the registry still
// has the __draft__ → stage → sessionId binding.
const draftBackup = ref<{
  label: string;
  tier: WorkflowTier;
  activeStep: StepName;
  injected: Partial<Record<StepName, boolean>>;
} | null>(null);

const stages = computed(() => stagesForTier(wf.state.value.tier));
const viewedStep = ref<StepName>(wf.state.value.activeStep);
const progressStep = computed(() => wf.state.value.activeStep);
const cur = computed(() =>
  stages.value.includes(viewedStep.value) ? viewedStep.value : progressStep.value,
);
const viewIdx = computed(() => stages.value.indexOf(cur.value));
const progressIdx = computed(() => stages.value.indexOf(progressStep.value));
const isLast = computed(() => viewIdx.value === stages.value.length - 1);
// frontier = 用户实际到过的最远阶段。
// 取"基于 change 产物的推断"和"当前查看位置"的较大者:
//   - 产物推断:有 evidence→verify、有 tasks→apply、有 proposal→propose、否则 explore
//   - 当前位置:activeStep(用户可能正在 propose 写 proposal.md,产物还没落盘)
// 这样在 earlier stage 回看时,后续已解锁的 stage 不会被错误锁定;
// 同时不会把"正在进行的当前阶段"锁死。
const frontierIdx = computed(() => {
  const change = selectedChange.value;
  let inferredIdx = 0;
  if (change) {
    if (openspec.state.evidence[change.id]) {
      inferredIdx = stages.value.indexOf("verify");
    } else if (change.taskStats.total > 0) {
      inferredIdx = stages.value.indexOf("apply");
    } else if (change.deltaSpecs.length > 0 || change.proposal) {
      inferredIdx = stages.value.indexOf("propose");
    }
    if (inferredIdx < 0) inferredIdx = 0;
  }
  return Math.max(inferredIdx, progressIdx.value);
});
const nextLabel = computed(() => (isLast.value ? "" : stageLabel(stages.value[viewIdx.value + 1])));
const requestedChangeId = computed(() => {
  const value = route.query.change;
  return typeof value === "string" ? value : "";
});
const selectedChange = computed(() => {
  if (requestedChangeId.value) {
    return openspec.state.activeChanges.find((change) => change.id === requestedChangeId.value);
  }
  return undefined;
});
const changeId = computed(() => selectedChange.value?.id ?? "");
const showIntro = computed(() => !wf.enabled.value || route.query.intro === "1");
const evidence = computed(() =>
  changeId.value ? openspec.state.evidence[changeId.value] : undefined,
);

type StageGateTone = "ready" | "review" | "blocked" | "info";
type StageGateActionKind = "next" | "generate-tasks" | "start-work" | "run-tasks" | "draft-propose";
type StageGate = {
  tone: StageGateTone;
  kicker: string;
  title: string;
  body: string;
  action?: string;
  actionKind?: StageGateActionKind;
  secondaryAction?: string;
  secondaryActionKind?: StageGateActionKind;
  tertiaryAction?: string;
  tertiaryActionKind?: StageGateActionKind;
  canContinue: boolean;
};

const stageInteracted = computed(
  () => messages.value.length > 0 || injected.value[cur.value] === true,
);
const stageGate = computed<StageGate | null>(() => {
  if (isLast.value) return null;

  const stage = cur.value;
  const next = nextLabel.value;
  const change = selectedChange.value;
  const stats = change?.taskStats;
  const currentEvidence = evidence.value;
  const G = "workflow.studio.gate";

  if (stage === "explore") {
    if (!stageInteracted.value) return null;
    return {
      tone: "review",
      kicker: t(`${G}.exploreReview.kicker`),
      title: t(`${G}.exploreReview.title`),
      body: t(`${G}.exploreReview.body`),
      action: t(`${G}.exploreReview.action`, { next }),
      canContinue: true,
    };
  }

  if (stage === "propose") {
    const hasProposal = Boolean(change?.proposal || change?.deltaSpecs.length);
    if (!hasProposal) {
      return {
        tone: "blocked",
        kicker: t(`${G}.proposeBlocked.kicker`),
        title: t(`${G}.proposeBlocked.title`),
        body: t(`${G}.proposeBlocked.body`),
        action: t(`${G}.proposeBlocked.action`),
        actionKind: "draft-propose",
        canContinue: false,
      };
    }
    return {
      tone: "review",
      kicker: t(`${G}.proposeReview.kicker`),
      title: t(`${G}.proposeReview.title`),
      body: t(`${G}.proposeReview.body`),
      action: t(`${G}.proposeReview.action`, { next }),
      canContinue: true,
    };
  }

  if (stage === "apply") {
    if (!changeId.value) {
      return {
        tone: "blocked",
        kicker: t(`${G}.applyNoChange.kicker`),
        title: t(`${G}.applyNoChange.title`),
        body: t(`${G}.applyNoChange.body`),
        canContinue: false,
      };
    }
    if (!stats || stats.total === 0) {
      return {
        tone: "blocked",
        kicker: t(`${G}.applyNoTasks.kicker`),
        title: t(`${G}.applyNoTasks.title`),
        body: t(`${G}.applyNoTasks.body`),
        action: t(`${G}.applyNoTasks.action`),
        actionKind: "generate-tasks",
        canContinue: false,
      };
    }
    if (stats.pending > 0) {
      return {
        tone: "info",
        kicker: t(`${G}.applyRunning.kicker`),
        title: t(`${G}.applyRunning.title`, { done: stats.completed, total: stats.total }),
        body: t(`${G}.applyRunning.body`),
        action: t(`${G}.applyRunning.action`),
        actionKind: "run-tasks",
        canContinue: false,
      };
    }
    return {
      tone: "ready",
      kicker: t(`${G}.applyReady.kicker`),
      title: t(`${G}.applyReady.title`),
      body: t(`${G}.applyReady.body`),
      action: t(`${G}.applyReady.action`, { next }),
      actionKind: "next",
      canContinue: true,
    };
  }

  if (stage === "verify") {
    if (!currentEvidence) {
      return {
        tone: "blocked",
        kicker: t(`${G}.verifyNoEvidence.kicker`),
        title: t(`${G}.verifyNoEvidence.title`),
        body: t(`${G}.verifyNoEvidence.body`),
        canContinue: false,
      };
    }
    if (currentEvidence.verdict === "NOT_READY") {
      return {
        tone: "blocked",
        kicker: currentEvidence.verdict,
        title: t(`${G}.verifyNotReady.title`),
        body: t(`${G}.verifyNotReady.body`),
        canContinue: false,
      };
    }
    return {
      tone: "ready",
      kicker: currentEvidence.verdict,
      title: t(`${G}.verifyReady.title`),
      body: t(`${G}.verifyReady.body`),
      action: t(`${G}.verifyReady.action`, { next }),
      actionKind: "next",
      canContinue: true,
    };
  }

  if (stage === "review") {
    if (!stageInteracted.value) return null;
    return {
      tone: "review",
      kicker: t(`${G}.reviewConfirm.kicker`),
      title: t(`${G}.reviewConfirm.title`),
      body: t(`${G}.reviewConfirm.body`),
      action: t(`${G}.reviewConfirm.action`, { next }),
      actionKind: "next",
      canContinue: true,
    };
  }

  return null;
});
const displayTitle = computed(() => {
  if (changeId.value) return changeId.value;
  if (need.value.trim()) return need.value.slice(0, 30);
  return t("workflow.studio.newExplore");
});

// Draft 阶段固定用 "__draft__" 作为 workflowKey，避免 label 在首次发送时被
// 设成 need 文本后，与 change 创建后的 migrateWorkflowKey("__draft__", id)
// 错位，导致 explore 阶段已注册的 session 找不到而被 startNewSession 清空。
const workflowKey = computed(() => changeId.value || "__draft__");

function rememberStageSession(stage: StepName, sessionId?: string) {
  if (!sessionId) return;
  stageSessionsStore.registerStageSession(workflowKey.value, stage, sessionId);
  if (wf.state.value.steps[stage]) {
    wf.state.value.steps[stage]!.sessionId = sessionId;
  }
  // Persist the binding in the session title so it survives localStorage
  // clears and is recoverable by discoverStageSessions later.
  void persistStageBindingInTitle(sessionId, stage, workflowKey.value);
}

/**
 * Append the stage-binding suffix to a session's title (best-effort).
 * The suffix is invisible in the main sidebar because stage sessions are
 * filtered out via stageSessionIds; it only matters for recovery.
 */
async function persistStageBindingInTitle(
  sessionId: string,
  stage: StepName,
  wKey: string,
): Promise<void> {
  // Right after createSession the SSE upsert may not have landed in
  // sessionsStore yet — fetch from the backend so we have a real title to
  // append the suffix to (otherwise auto-title's later PATCH would replace
  // the empty title and we'd lose the binding).
  const session =
    backend.sessions.value.find((s) => s.id === sessionId) ??
    (await backend.fetchSession(sessionId));
  if (!session) return;
  const current = session.title ?? "";
  const existing = decodeStageBinding(current);
  if (existing && existing.stage === stage && existing.workflowKey === wKey) return;
  const next = encodeStageSuffix(stripStageSuffix(current), { stage, workflowKey: wKey });
  await backend.patchSessionTitle(sessionId, next);
}

/**
 * Scan known sessions for an encoded `⌁sf:<stage>:<workflowKey>` suffix and
 * backfill the registry for the given workflowKey. Used as a fallback when
 * prepareStageSession finds no binding in localStorage.
 */
function discoverStageSessions(wKey: string): void {
  for (const session of backend.sessions.value) {
    const binding = decodeStageBinding(session.title);
    if (!binding || binding.workflowKey !== wKey) continue;
    const already = stageSessionsStore.stageSessionId(wKey, binding.stage);
    if (!already) {
      stageSessionsStore.registerStageSession(wKey, binding.stage, session.id);
    }
  }
}

/**
 * Ensure the current backend session matches the stage being entered:
 *  - stage already has a recorded session → switch to it (回看历史)
 *  - stage has no record → start a fresh session so the new stage's
 *    conversation is isolated from the previous stage (修阶段串台)
 * The first successful send in the stage binds it via rememberStageSession.
 */
async function prepareStageSession(stage: StepName) {
  let registered = stageSessionsStore.stageSessionId(workflowKey.value, stage);
  if (!registered && workflowKey.value !== "__draft__") {
    discoverStageSessions(workflowKey.value);
    registered = stageSessionsStore.stageSessionId(workflowKey.value, stage);
  }
  if (registered) {
    if (backend.selectedSessionId.value !== registered) {
      await backend.selectSession(registered);
    }
    injected.value[stage] = true;
    return;
  }
  backend.startNewSession();
}

async function loadStageSideEffects(stage: StepName) {
  if (stage === "apply" && changeId.value) {
    const currentChangeId = changeId.value;
    const c = await loadContract(currentChangeId);
    if (cur.value !== "apply" || changeId.value !== currentChangeId) return;
    if (c) contract.value = c;
    contractStale.value = checkStale(currentChangeId, c);
    return;
  }
  if (stage === "verify" && cur.value === "verify") {
    refreshVerifyWarnings();
  }
}

async function enterStage(stage: StepName, opts: { advance?: boolean } = {}) {
  viewedStep.value = stage;
  if (opts.advance) {
    wf.setActiveStep(stage);
  }
  await prepareStageSession(stage);
  await loadStageSideEffects(stage);
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
  const sessions = stageSessionsStore.stageSessions.value[changeId.value];
  if (sessions?.review) return "thorough";
  if (sessions?.explore) return "standard";
  if (stage === "explore") return "standard";
  return "standard";
}

async function openSelectedChange() {
  const requestedId = requestedChangeId.value;
  if (!requestedId) return;
  if (!changeId.value) {
    wf.state.value.label = "";
    contract.value = undefined;
    contractStale.value = null;
    verifyWarnings.value = [];
    taskRunner.reset();
    router.replace({ name: "workflow", query: { intro: "1" } });
    return;
  }
  // Snapshot the in-progress draft before opening the active change overwrites
  // workflow state. Restored by restoreDraft() when user navigates back.
  if (creatingDraftChange.value && wf.state.value.label) {
    draftBackup.value = {
      label: wf.state.value.label,
      tier: wf.state.value.tier,
      activeStep: wf.state.value.activeStep,
      injected: { ...injected.value },
    };
  }
  wf.enable();
  const inferredStage = stageForChange();
  // contract.md 是 tier 的权威来源(持久在 change 目录里,跨机器/清缓存都还在)。
  // localStorage.changeTiers 只在 UI 创建 change 时写入,清数据或 CLI 建 change 时缺失,
  // 会让 tierForChange 跌到默认 lean。先尝试读 contract,失败再回落。
  const c = await loadContract(requestedId);
  // Guard:async 期间用户切了 change、或 openspec refresh 重入 watch 时,
  // 这次 run 的 inferredStage / contract 已经陈旧,放弃继续执行,让新 run 接管。
  // 否则两次 openSelectedChange 会抢着 setTier / enterStage,
  // 后跑的可能 startNewSession 把刚加载的消息清掉。
  if (requestedChangeId.value !== requestedId) return;
  if (!changeId.value) return;
  if (c) contract.value = c;
  const cTier = c?.tier;
  const nextTier: WorkflowTier =
    cTier === "standard" || cTier === "thorough" ? cTier : tierForChange(inferredStage);
  const nextStages = stagesForTier(nextTier);
  const targetStage = nextStages.includes(inferredStage) ? inferredStage : nextStages[0];
  wf.setTier(nextTier);
  // Don't overwrite label — it carries the draft's need text and SidePanel
  // uses it to title the "探索中" item. The active change is already shown in
  // "活跃探索"; mirroring its id here would make the two items look identical.
  creatingDraftChange.value = false;
  void enterStage(targetStage, { advance: true });
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
// Route returned to no-?change= while we have a stashed draft snapshot (user
// clicked "探索中" after opening an active change). Restore the draft's
// workflow state and re-select its bound explore session so the conversation
// reappears instead of leaving the user looking at the active change's empty
// msgStore.
watch(
  () => requestedChangeId.value,
  (newId, oldId) => {
    if (newId || oldId === undefined) return;
    if (!draftBackup.value) return;
    if (creatingDraftChange.value) return; // already in draft, nothing to restore
    void restoreDraft();
  },
);

async function restoreDraft() {
  const backup = draftBackup.value;
  if (!backup) return;
  draftBackup.value = null;
  creatingDraftChange.value = true;
  wf.setTier(backup.tier);
  wf.state.value.label = backup.label;
  wf.state.value.activeStep = backup.activeStep;
  viewedStep.value = backup.activeStep;
  injected.value = { ...backup.injected };
  contract.value = undefined;
  contractStale.value = null;
  verifyWarnings.value = [];
  taskRunner.reset();
  // Re-select the draft's bound session for the active step so the
  // conversation is restored from cache/backend.
  const stageToEnter = backup.activeStep;
  const registered = stageSessionsStore.stageSessionId("__draft__", stageToEnter);
  if (registered) {
    if (backend.selectedSessionId.value !== registered) {
      await backend.selectSession(registered);
    }
    injected.value[stageToEnter] = true;
  }
}
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
    // Migrate the local registry, then re-PATCH each affected session's title
    // so the suffix's workflowKey stays consistent (the encoded binding is what
    // discoverStageSessions reads to recover from a cleared localStorage).
    const draftSessions = stageSessionsStore.sessionsForWorkflow("__draft__");
    stageSessionsStore.migrateWorkflowKey("__draft__", created.id);
    for (const sid of draftSessions) {
      const session = backend.sessions.value.find((s) => s.id === sid);
      const binding = decodeStageBinding(session?.title);
      if (binding && binding.workflowKey === "__draft__") {
        const next = encodeStageSuffix(stripStageSuffix(session!.title), {
          stage: binding.stage,
          workflowKey: created.id,
        });
        void backend.patchSessionTitle(sid, next);
      }
    }
    wf.state.value.label = "";
    creatingDraftChange.value = false;
    draftBackup.value = null;
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

// Mirror ChatView's visibility rules so the workflow stream shows the same
// content (text + reasoning + tool windows) instead of just the trimmed text.
function hasRenderableParts(id: string): boolean {
  return msgStore.getParts(id).some((part) => {
    switch (part.type) {
      case "text":
        return !part.synthetic && stripSystemReminder(part.text).trim().length > 0;
      case "tool":
        return true;
      case "reasoning":
        return part.text.trim().length > 0;
      default:
        return false;
    }
  });
}
function shouldShowMessage(id: string, role: string): boolean {
  if (role === "user") return msgStore.isDisplayable(id);
  return msgStore.getStatus(id) === "streaming" || hasRenderableParts(id);
}

const emit = defineEmits<{ "navigate-session": [sessionId: string] }>();

const messages = computed(() =>
  msgStore
    .list()
    .filter((m) => shouldShowMessage(m.id, m.role))
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      created: m.time?.created,
    })),
);

// tddRed/tddGreen still key off text content (tool/exit-code mentions) so
// they keep working now that messages no longer carry the text inline.
const messageTexts = computed(() => messages.value.map((m) => extractText(m.id)));
const tddRed = computed(() => messageTexts.value.some((t) => /fail|✗|exit [^0]/.test(t)));
const tddGreen = computed(() =>
  messageTexts.value.some((t) => /pass.*[✓]|[✓].*pass|exit 0/.test(t)),
);

// ── 头像与显示名(与 ChatView 同源) ──────────────────────────────────────────
const { agentName, userName } = useDisplayNames();
const avatarBaseUrl = import.meta.env.BASE_URL;
const agentAvatarSrc = `${avatarBaseUrl}avatars/agent.png`;
const userAvatarSrc = `${avatarBaseUrl}avatars/user.png`;

function formatMessageTime(timestamp?: number): string {
  if (!timestamp) return "";
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── 自动滚动到底 / 跳转控件 ─────────────────────────────────────────────────
const streamEl = ref<HTMLElement | undefined>(undefined);
const scrollMode = ref<ScrollMode>("follow");
const historyScrollLocked = ref(true);
const { notifyContentChange, showResumeButton, resumeFollow, pauseFollow } = useAutoScroller(
  streamEl,
  scrollMode,
  { smoothOnInitialFollow: false, scrollOnSetup: false },
);

const contentSignature = computed(() =>
  messages.value
    .map((m) => {
      const partSig = msgStore
        .getParts(m.id)
        .map((p) => {
          if (p.type === "text") return `${p.id}:text:${p.text.length}`;
          if (p.type === "reasoning") return `${p.id}:reasoning:${p.text.length}`;
          if (p.type === "tool") {
            const s = p.state;
            const outLen = s.status === "completed" ? s.output.length : 0;
            const errLen = s.status === "error" ? s.error.length : 0;
            return `${p.id}:tool:${p.tool}:${s.status}:${outLen}:${errLen}`;
          }
          return `${p.id}:${p.type}`;
        })
        .join(",");
      return `${m.id}:${m.role}:${msgStore.getStatus(m.id)}:${partSig}`;
    })
    .join("|"),
);
watch(
  contentSignature,
  () => {
    if (historyScrollLocked.value) return;
    notifyContentChange(false);
  },
  { flush: "post" },
);
watch(
  () => messages.value[0]?.id,
  () => {
    historyScrollLocked.value = false;
    resumeFollow(false);
  },
  { flush: "post" },
);
function jumpToLatest() {
  historyScrollLocked.value = false;
  resumeFollow(false);
}
function jumpToTop() {
  historyScrollLocked.value = true;
  pauseFollow();
  const el = streamEl.value;
  if (el) el.scrollTop = 0;
}

// 复制按钮
const copiedId = ref<string | null>(null);
let copyTimer: ReturnType<typeof setTimeout> | null = null;
async function copyMessage(msgId: string) {
  const text = extractText(msgId);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copiedId.value = msgId;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copiedId.value = null;
  }, 1500);
}
function canCopy(msgId: string): boolean {
  return extractText(msgId).length > 0;
}

function onNavigateSession(sessionId: string) {
  emit("navigate-session", sessionId);
}

function stageState(i: number): "done" | "current" | "locked" {
  if (i === progressIdx.value) return "current";
  return i <= frontierIdx.value ? "done" : "locked";
}
function isViewingStage(i: number): boolean {
  return i === viewIdx.value && i !== progressIdx.value && i <= frontierIdx.value;
}
function lineState(i: number): "done" | "locked" {
  return i < frontierIdx.value ? "done" : "locked";
}
function canOpenStage(i: number): boolean {
  if (archiving.value) return false;
  return i <= frontierIdx.value;
}

function pick(t: WorkflowTier) {
  if (route.query.change) {
    router.replace({ name: "workflow" });
  }
  draftKnownChangeIds.value = new Set(openspec.state.activeChanges.map((change) => change.id));
  creatingDraftChange.value = true;
  draftBackup.value = null;
  wf.setTier(t);
  viewedStep.value = wf.state.value.activeStep;
  wf.enable();
  injected.value = {};
  wf.state.value.label = "";
  need.value = "";
  draftMsg.value = "";
  contract.value = undefined;
  contractStale.value = null;
  // 清空上一轮会话消息，避免新探索的结果区残留旧内容
  backend.startNewSession();
}
function backToIntro() {
  router.replace({ name: "workflow", query: { intro: "1" } });
}
function gotoStage(s: StepName) {
  const idx = stages.value.indexOf(s);
  if (idx > frontierIdx.value) return;
  void enterStage(s);
}
function nextStage() {
  if (isLast.value) return;
  const from = cur.value;
  const to = stages.value[viewIdx.value + 1];
  rememberStageSession(from, backend.selectedSessionId.value);
  if (from === "propose" && changeId.value) {
    generateContract(changeId.value, need.value || changeId.value, wf.state.value.tier);
  }
  void enterStage(to, { advance: true });
}

function stageGateActionDisabled(kind?: StageGateActionKind) {
  if (kind === "draft-propose") return !changeId.value;
  if (kind === "generate-tasks") return !changeId.value;
  if (kind === "start-work") return !changeId.value;
  if (kind === "run-tasks") return !changeId.value;
  return !stageGate.value?.canContinue;
}

async function requestTasksMd() {
  if (!changeId.value) return;
  const prompt = [
    `你处于 Apply 阶段。`,
    `请为 OpenSpec change "${changeId.value}" 生成或更新 openspec/changes/${changeId.value}/tasks.md。`,
    "当前流程需要 tasks.md 作为 Apply/Verify 的执行边界：请拆成可执行、可勾选、可验证的任务。",
    "要求：",
    "- 使用 OpenSpec tasks.md checkbox 格式，例如 `- [ ] 1.1 ...`。",
    "- 每个任务必须有明确完成条件；需要测试/构建/手动验收时写清楚验证方式。",
    "- 不要直接开始实现代码，先只生成或更新 tasks.md，完成后说明任务拆分依据。",
    `Proposal 与 contract 见 openspec/changes/${changeId.value}/proposal.md 与 contract.md,需要时自行读取。`,
  ]
    .filter(Boolean)
    .join("\n");

  draftMsg.value = t("workflow.studio.msg.requestedTasks");
  injected.value[cur.value] = true;
  const sent = await backend.sendPrompt(prompt, []);
  if (sent) rememberStageSession(cur.value, backend.selectedSessionId.value);
  window.setTimeout(() => (draftMsg.value = ""), 2500);
}

async function requestStartWork() {
  if (!changeId.value) return;
  const prompt = [
    "你处于 Apply 阶段。",
    `请直接开始实现 OpenSpec change "${changeId.value}"。`,
    "当前没有可运行的任务上下文时，请先根据 proposal 明确实现范围，再开始改代码。",
    "工作要求：",
    "- 先阅读相关代码和 OpenSpec 产物，不要凭空实现。",
    "- 保持改动聚焦在当前 change 的 scope 内。",
    "- 实现后运行必要验证，并在回复里说明改了什么、验证结果，以及是否建议补写 tasks.md。",
    `Proposal 与 contract 见 openspec/changes/${changeId.value}/proposal.md 与 contract.md,需要时自行读取。`,
  ]
    .filter(Boolean)
    .join("\n");

  draftMsg.value = t("workflow.studio.msg.requestedStartWork");
  injected.value[cur.value] = true;
  const sent = await backend.sendPrompt(prompt, []);
  if (sent) rememberStageSession(cur.value, backend.selectedSessionId.value);
  window.setTimeout(() => (draftMsg.value = ""), 2500);
}

async function requestRunPendingTasksInApply() {
  if (!changeId.value) return;
  const change = selectedChange.value;
  if (!change) return;
  const pending = change.tasks.filter((task) => task.status === "pending");
  if (!pending.length) return;

  await enterStage("apply");

  const tasksRel = `openspec/changes/${changeId.value}/tasks.md`;
  const prompt = [
    `你处于 Apply 阶段。请按顺序执行 OpenSpec change "${changeId.value}" 的待办任务。`,
    "",
    `待办任务清单见 ${tasksRel}（pending 项共 ${pending.length} 条）。`,
    "",
    "执行要求:",
    `- 先读取 ${tasksRel} 拿到完整的待办任务列表与验收方式，再开始实现。`,
    "- 先阅读相关代码和 OpenSpec 产物，不要凭空实现。",
    "- 一次聚焦一个 pending task，保持改动在当前 change scope 内。",
    "- 遵循 TDD: 写/调整测试 -> 看到失败 -> 实现 -> 运行验证。",
    "- 每完成一个 task 后更新 tasks.md 中对应 checkbox。",
    "- 完成后汇总改动、验证命令和结果；如果有任务无法完成，明确说明阻塞原因。",
    `Proposal 与 contract 见 openspec/changes/${changeId.value}/proposal.md 与 contract.md,需要时自行读取。`,
  ]
    .filter(Boolean)
    .join("\n");

  draftMsg.value = t("workflow.studio.msg.sent");
  injected.value.apply = true;
  const sent = await backend.sendPrompt(prompt, []);
  if (sent) rememberStageSession("apply", backend.selectedSessionId.value);
  window.setTimeout(() => (draftMsg.value = ""), 2500);
}

function handleStageGateAction(kind?: StageGateActionKind) {
  if (kind === "draft-propose") {
    void draft("propose");
    return;
  }
  if (kind === "generate-tasks") {
    void requestTasksMd();
    return;
  }
  if (kind === "start-work") {
    void requestStartWork();
    return;
  }
  if (kind === "run-tasks") {
    void requestRunPendingTasksInApply();
    return;
  }
  nextStage();
}

const injected = ref<Partial<Record<string, boolean>>>({});
const contract = ref<ExecutionContract | null | undefined>(undefined);
const contractStale = ref<ContractStaleResult | null>(null);
const verifyWarnings = ref<string[]>([]);

function refreshVerifyWarnings() {
  if (!changeId.value) {
    verifyWarnings.value = [];
    return;
  }
  const warns: string[] = [];
  const staleResult = checkStale(changeId.value, contract.value);
  if (staleResult.stale) {
    warns.push(
      t("workflow.studio.warn.contractStale", {
        reason: staleResult.reason,
        detail: staleResult.detail,
      }),
    );
  }
  const cov = checkRequirementsCoverage(selectedChange.value, contract.value);
  if (cov.uncovered.length > 0) {
    warns.push(
      t("workflow.studio.warn.requirementsUncovered", { items: cov.uncovered.join(", ") }),
    );
  }
  verifyWarnings.value = warns;
}
type DraftStage = "explore" | "propose" | "apply" | "review" | "archive";
async function draft(stage: DraftStage) {
  if (archiving.value) return;
  const isFirst = !injected.value[stage];
  if (!isFirst && !need.value.trim()) {
    draftMsg.value = t("workflow.studio.msg.needInput");
    return;
  }
  const change = selectedChange.value;
  const text = isFirst
    ? getStagePrompt(stage, {
        tier: wf.state.value.tier,
        changeId: changeId.value,
        need: need.value,
        brainstorm: change?.brainstorm ?? need.value,
        proposal: change?.proposal?.raw ?? "",
      })
    : need.value;
  injected.value[stage] = true;
  draftMsg.value = isFirst ? t("workflow.studio.msg.injected") : t("workflow.studio.msg.sent");
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
  if (s === "explore" || s === "propose" || s === "apply" || s === "review" || s === "archive") {
    draft(s);
  }
}
async function runGates() {
  if (!changeId.value) return;
  refreshVerifyWarnings();
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
  const cid = changeId.value;
  const confirmed = await archiveConfirmDialog.value?.confirm({
    title: t("workflow.studio.archiveConfirmTitle", { id: cid }),
    message: t("workflow.studio.archiveConfirmMessage"),
    confirmText: t("workflow.studio.archiveConfirm"),
    cancelText: t("workflow.studio.archiveCancel"),
    danger: true,
  });
  if (!confirmed) return;
  archiving.value = true;
  try {
    const r = await openspec.archiveChange(changeId.value);
    archiveMsg.value = {
      ok: r.ok,
      text: r.ok
        ? t("workflow.studio.msg.archived")
        : r.reason || t("workflow.studio.msg.archiveFailed"),
    };
    if (r.ok) {
      const archivedKey = changeId.value;
      await cleanupWorkflowSessions(archivedKey);
      window.setTimeout(() => (archiveMsg.value = null), 2500);
    }
  } finally {
    archiving.value = false;
  }
}

/**
 * Best-effort teardown of all stage sessions bound to a workflow key:
 *  1. delete each registered session from the backend (best-effort, never throws)
 *  2. clear the registry entry + persist
 *  3. drop dangling wf.state.steps[*].sessionId references
 * Used by doArchive (real change) and backToIntro (draft) to prevent orphans.
 */
async function cleanupWorkflowSessions(key: string) {
  const ids = stageSessionsStore.sessionsForWorkflow(key);
  await Promise.all(
    ids.map((id) =>
      backend.deleteSession(id).catch((e) => {
        console.warn(`[WorkflowStudio] deleteSession(${id}) failed during cleanup:`, e);
      }),
    ),
  );
  stageSessionsStore.clearStageSessions(key);
  const steps = wf.state.value.steps;
  for (const name of Object.keys(steps) as StepName[]) {
    const step = steps[name];
    if (step?.sessionId && ids.includes(step.sessionId)) {
      step.sessionId = undefined;
    }
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
    <div v-if="showIntro" class="wf-intro">
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
        <div class="ckicker">
          {{ t("workflow.studio.flowLabel") }} · {{ t(TIER_LABELS[wf.state.value.tier]) }}
        </div>
        <div class="track-nodes">
          <template v-for="(s, i) in stages" :key="s">
            <button
              class="tnode"
              :class="[stageState(i), { viewing: isViewingStage(i) }]"
              :disabled="!canOpenStage(i)"
              :title="canOpenStage(i) ? '' : t('workflow.studio.lockedStageHint')"
              @click="gotoStage(s)"
            >
              <span class="tnode-dot">
                <span v-if="stageState(i) === 'done'">✓</span>
                <span v-else>{{ i + 1 }}</span>
              </span>
              <span class="tnode-text">
                <span class="tnode-label">{{ stageLabel(s) }}</span>
                <span class="tnode-sub">{{ stageSub(s) }}</span>
              </span>
            </button>
            <span v-if="i < stages.length - 1" class="tline" :class="lineState(i)" />
          </template>
        </div>
      </aside>

      <!-- 右侧 -->
      <div class="conv">
        <div class="header">
          <button
            type="button"
            class="back-btn"
            :disabled="archiving"
            :title="t('workflow.studio.backTitle')"
            @click="backToIntro"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>{{ t("workflow.studio.back") }}</span>
          </button>
          <div class="h-title">
            <span class="h-main">{{ displayTitle }}</span>
            <span class="h-sub">{{ t("workflow.studio.specExplore") }}</span>
          </div>
          <span class="stage-pill">{{ stageLabel(cur) }}</span>
        </div>

        <!-- 对话流(真实当前会话消息,复用 ChatView 同款渲染) -->
        <div class="conv-body">
          <div ref="streamEl" class="stream">
            <div v-if="messages.length === 0" class="stream-empty">{{ stageHint(cur) }}</div>
            <template v-else>
              <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
                <template v-if="m.role === 'assistant'">
                  <img :src="agentAvatarSrc" alt="Agent" class="avatar-img" />
                  <div class="mb group">
                    <div class="bubble agent">
                      <div class="name agent-name">
                        {{ agentName }}
                        <span v-if="formatMessageTime(m.created)" class="msg-time">{{
                          formatMessageTime(m.created)
                        }}</span>
                      </div>
                      <MessageContent :message-id="m.id" @navigate-session="onNavigateSession" />
                    </div>
                    <button
                      v-if="canCopy(m.id)"
                      type="button"
                      class="copy-btn"
                      :title="
                        copiedId === m.id ? t('workflow.studio.copied') : t('workflow.studio.copy')
                      "
                      @click="copyMessage(m.id)"
                    >
                      {{
                        copiedId === m.id ? t("workflow.studio.copied") : t("workflow.studio.copy")
                      }}
                    </button>
                  </div>
                </template>

                <template v-else>
                  <div class="mb group user-mb">
                    <div class="bubble user">
                      <div class="name user-name">
                        {{ userName }}
                        <span v-if="formatMessageTime(m.created)" class="msg-time">{{
                          formatMessageTime(m.created)
                        }}</span>
                      </div>
                      <MessageContent :message-id="m.id" @navigate-session="onNavigateSession" />
                    </div>
                    <button
                      v-if="canCopy(m.id)"
                      type="button"
                      class="copy-btn"
                      :title="
                        copiedId === m.id ? t('workflow.studio.copied') : t('workflow.studio.copy')
                      "
                      @click="copyMessage(m.id)"
                    >
                      {{
                        copiedId === m.id ? t("workflow.studio.copied") : t("workflow.studio.copy")
                      }}
                    </button>
                  </div>
                  <img :src="userAvatarSrc" alt="User" class="avatar-img" />
                </template>
              </div>
            </template>

            <!-- Execution Contract(apply 阶段生效) -->
            <div v-if="cur === 'apply' && contract" class="contract-card">
              <div class="cc-head">
                {{
                  t("workflow.studio.contractHead", {
                    changeId: contract.changeId,
                    tier: contract.tier,
                  })
                }}
              </div>
              <div v-if="contractStale?.stale" class="cc-section">
                <div class="cc-item warn">
                  {{
                    t("workflow.studio.contractStaleWarn", {
                      reason: contractStale.reason,
                      detail: contractStale.detail,
                    })
                  }}
                </div>
              </div>
              <div v-if="contract.intent" class="cc-section">
                <span class="cc-sl">{{ t("workflow.studio.intentLock") }}</span>
                <div class="cc-item intent">{{ contract.intent }}</div>
              </div>
              <div v-if="contract.outOfScope?.length" class="cc-section">
                <span class="cc-sl">{{ t("workflow.studio.outOfScope") }}</span>
                <div v-for="(o, i) in contract.outOfScope" :key="i" class="cc-item fence">
                  ⊘ {{ o }}
                </div>
              </div>
              <div class="cc-section">
                <span class="cc-sl">{{ t("workflow.studio.scope") }}</span>
                <div v-for="f in contract.scope.files" :key="f" class="cc-item">▸ {{ f }}</div>
                <div v-if="contract.scope.api?.length" class="cc-item api">
                  {{ t("workflow.studio.api") }} {{ contract.scope.api.join(", ") }}
                </div>
              </div>
              <div v-if="contract.requirements?.length" class="cc-section">
                <span class="cc-sl">{{
                  t("workflow.studio.requirements", { count: contract.requirements.length })
                }}</span>
                <div
                  v-for="r in contract.requirements"
                  :key="`${r.source}::${r.name}`"
                  class="cc-item mon"
                >
                  <span class="cc-level" :class="r.level.toLowerCase()">{{ r.level }}</span>
                  {{ r.name }}
                  <span class="cc-src">{{ r.source }}</span>
                </div>
              </div>
              <div class="cc-section">
                <span class="cc-sl">{{ t("workflow.studio.verify") }}</span>
                <div v-for="v in contract.verify" :key="v.command" class="cc-item mon">
                  <span class="cc-check">$</span> {{ v.command }}
                  <span v-if="v.description" class="cc-desc">{{ v.description }}</span>
                </div>
              </div>
              <div v-if="contract.risks.length" class="cc-section">
                <span class="cc-sl">{{ t("workflow.studio.risks") }}</span>
                <div v-for="(r, i) in contract.risks" :key="i" class="cc-item warn">⚠ {{ r }}</div>
              </div>
            </div>

            <!-- Apply TDD 可视化 -->
            <div v-if="cur === 'apply'" class="tdd-bar">
              <span class="tdd-item" :class="tddRed ? 'red' : ''">
                <span class="tdd-light" :class="tddRed ? 'red' : ''"></span
                >{{ t("workflow.studio.tddRed") }}
              </span>
              <span class="tdd-line" :class="tddGreen ? 'green' : tddRed ? 'progress' : ''"></span>
              <span class="tdd-item" :class="tddGreen ? 'green' : ''">
                <span class="tdd-light" :class="tddGreen ? 'green' : ''"></span
                >{{ t("workflow.studio.tddGreen") }}
              </span>
            </div>

            <!-- SDD Task Runner(apply 阶段) -->
            <div v-if="cur === 'apply'" class="sdd-panel">
              <div class="sdd-head">
                <span class="sdd-title">{{ t("workflow.studio.sddTitle") }}</span>
                <button
                  class="sdd-run-btn"
                  :disabled="taskRunner.busy.value || !changeId"
                  @click="runSddTasks"
                >
                  {{
                    taskRunner.busy.value
                      ? t("workflow.studio.running")
                      : t("workflow.studio.sddRunAll")
                  }}
                </button>
              </div>
              <div
                v-if="!taskRunner.tasks.value.length && !taskRunner.busy.value"
                class="sdd-empty"
              >
                {{
                  changeId
                    ? t("workflow.studio.sddEmptyWithChange")
                    : t("workflow.studio.sddEmptyNoChange")
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
              <div class="rc-head">{{ t("workflow.studio.reviewVerdict") }}</div>
              <div class="rc-row">
                <span class="rc-key">{{ t("workflow.studio.reviewSpecCompliance") }}</span
                ><span class="rc-val">—</span>
              </div>
              <div class="rc-row">
                <span class="rc-key">{{ t("workflow.studio.reviewCodeQuality") }}</span
                ><span class="rc-val">—</span>
              </div>
              <div class="rc-row">
                <span class="rc-key">{{ t("workflow.studio.reviewScopeCreep") }}</span
                ><span class="rc-val">—</span>
              </div>
            </div>

            <!-- verify 前置门禁警告(契约过期 / Requirements 未覆盖) -->
            <div v-if="cur === 'verify' && verifyWarnings.length" class="verify-warn-card">
              <div class="vw-head">
                {{ t("workflow.studio.verifyWarnHead", { count: verifyWarnings.length }) }}
              </div>
              <div v-for="(w, i) in verifyWarnings" :key="i" class="vw-item">· {{ w }}</div>
              <div class="vw-foot">{{ t("workflow.studio.verifyWarnFoot") }}</div>
            </div>

            <!-- verify 真实 evidence -->
            <div v-if="cur === 'verify' && evidence" class="evidence-card">
              <div class="ev-head">
                <span class="ev-label">{{ t("workflow.studio.verdict") }}</span>
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
                  {{
                    g.exitCode === null
                      ? t("workflow.studio.gateSkip")
                      : g.passed
                        ? t("workflow.studio.gatePassed")
                        : t("workflow.studio.gateFailed", { code: g.exitCode })
                  }}
                </span>
              </div>
            </div>
          </div>

          <!-- 滚动控件 -->
          <div class="stream-nav">
            <button
              v-if="!showResumeButton"
              type="button"
              class="stream-nav-btn"
              :title="t('workflow.studio.jumpTop')"
              @click="jumpToTop"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
            <button
              v-if="showResumeButton"
              type="button"
              class="stream-nav-btn primary"
              :title="t('workflow.studio.jumpBottom')"
              @click="jumpToLatest"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- composer(阶段特定) -->
        <div class="composer">
          <template v-if="cur === 'explore'">
            <input
              v-model="need"
              :disabled="archiving"
              :placeholder="t('workflow.studio.placeholderExplore')"
              @keydown.enter="draft('explore')"
            />
            <button class="btn violet" :disabled="archiving" @click="draft('explore')">
              {{ t("workflow.studio.send") }}
            </button>
          </template>
          <template v-else-if="cur === 'propose'">
            <input
              v-model="need"
              :disabled="archiving"
              :placeholder="t('workflow.studio.placeholderPropose')"
              @keydown.enter="draft('propose')"
            />
            <button class="btn violet" :disabled="archiving" @click="draft('propose')">
              {{ t("workflow.studio.send") }}
            </button>
          </template>
          <template v-else-if="cur === 'apply' || cur === 'review'">
            <input
              v-model="need"
              :disabled="archiving"
              :placeholder="t('workflow.studio.placeholderStage', { label: stageLabel(cur) })"
              @keydown.enter="sendForCurrent"
            />
            <button class="btn violet" :disabled="archiving" @click="sendForCurrent">
              {{ t("workflow.studio.send") }}
            </button>
          </template>
          <template v-else-if="cur === 'verify'">
            <button
              class="btn emerald"
              :disabled="gating || !changeId || archiving"
              @click="runGates"
            >
              {{ gating ? t("workflow.studio.running") : t("workflow.studio.runGates") }}
            </button>
            <span v-if="!changeId" class="composer-hint warn">{{
              t("workflow.studio.needActiveChange")
            }}</span>
          </template>
          <template v-else-if="cur === 'archive'">
            <input
              v-model="need"
              :disabled="archiving"
              :placeholder="t('workflow.studio.placeholderStage', { label: stageLabel(cur) })"
              @keydown.enter="sendForCurrent"
            />
            <button class="btn violet" :disabled="archiving" @click="sendForCurrent">
              {{ t("workflow.studio.send") }}
            </button>
            <button class="btn ghost" :disabled="archiving || !changeId" @click="doArchive">
              {{ archiving ? t("workflow.studio.archiving") : t("workflow.studio.archive") }}
            </button>
            <span v-if="evidence?.verdict === 'NOT_READY'" class="gate-note">{{
              t("workflow.studio.notReadyWarn")
            }}</span>
            <span v-if="archiveMsg" :class="archiveMsg.ok ? 'composer-hint ok' : 'gate-note'">{{
              archiveMsg.text
            }}</span>
          </template>
          <span v-if="draftMsg" class="composer-hint warn">{{ draftMsg }}</span>
        </div>

        <!-- 阶段门禁(composer 下方,基于真实产物状态显示) -->
        <div v-if="stageGate" class="stage-gate" :class="stageGate.tone">
          <div class="stage-gate-copy">
            <span class="stage-gate-kicker">{{ stageGate.kicker }}</span>
            <strong>{{ stageGate.title }}</strong>
            <span>{{ stageGate.body }}</span>
          </div>
          <button
            v-if="stageGate.action"
            class="stage-gate-action"
            :disabled="stageGateActionDisabled(stageGate.actionKind)"
            @click="handleStageGateAction(stageGate.actionKind)"
          >
            {{ stageGate.action }}
            <span v-if="stageGate.actionKind === 'next'">→</span>
          </button>
          <button
            v-if="stageGate.secondaryAction"
            class="stage-gate-action secondary"
            :disabled="stageGateActionDisabled(stageGate.secondaryActionKind)"
            @click="handleStageGateAction(stageGate.secondaryActionKind)"
          >
            {{ stageGate.secondaryAction }}
          </button>
          <button
            v-if="stageGate.tertiaryAction"
            class="stage-gate-action tertiary"
            :disabled="stageGateActionDisabled(stageGate.tertiaryActionKind)"
            @click="handleStageGateAction(stageGate.tertiaryActionKind)"
          >
            {{ stageGate.tertiaryAction }}
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  </div>
  <ConfirmDialog ref="archiveConfirmDialog" />
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
.tnode.current:hover .tnode-label,
.tnode.viewing:hover .tnode-label {
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
.tnode.viewing .tnode-dot {
  border-color: var(--color-accent-violet, #a78bfa);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 8%, transparent);
  color: var(--color-accent-violet, #a78bfa);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
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
.tnode.viewing .tnode-label {
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
.back-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: 8px;
  border: 1px solid var(--color-surface-700, #334155);
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 60%, transparent);
  color: var(--color-surface-400, #94a3b8);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}
.back-btn:hover {
  color: var(--color-accent-violet, #a78bfa);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 40%, transparent);
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 10%, transparent);
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

/* 对话流容器 — 包住滚动区与浮动跳转按钮 */
.conv-body {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 对话流 */
.stream {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overscroll-behavior: contain;
  overflow-anchor: none;
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
.avatar-img {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  border: 1px solid color-mix(in srgb, var(--color-surface-700, #334155) 50%, transparent);
}
.mb {
  display: flex;
  flex-direction: column;
  min-width: 180px;
  max-width: 100%;
}
.msg.user .mb {
  align-items: flex-end;
}
.name {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.agent-name {
  color: var(--color-accent-emerald, #34d399);
}
.user-name {
  color: var(--color-accent-cyan, #22d3ee);
  justify-content: flex-end;
}
.msg-time {
  font-size: 10px;
  font-weight: 400;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-mono, monospace);
}
.bubble {
  padding: 11px 15px;
  border-radius: 11px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}
.msg.assistant .bubble {
  background: var(--color-surface-800, #1e293b);
  color: var(--color-surface-200, #e2e8f0);
  border-top-left-radius: 3px;
}
.msg.user .bubble {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 12%, transparent);
  color: var(--color-surface-100, #f1f5f9);
  border: 1px solid color-mix(in srgb, var(--color-accent-violet, #a78bfa) 25%, transparent);
  border-top-right-radius: 3px;
}
.copy-btn {
  margin-top: 4px;
  align-self: flex-start;
  padding: 3px 8px;
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}
.mb:hover .copy-btn {
  opacity: 1;
}
.copy-btn:hover {
  color: var(--color-surface-300, #cbd5e1);
  background: color-mix(in srgb, var(--color-surface-700, #334155) 25%, transparent);
}

/* 浮动跳转按钮 */
.stream-nav {
  position: absolute;
  bottom: 14px;
  right: 14px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}
.stream-nav-btn {
  pointer-events: auto;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--color-surface-700, #334155);
  background: color-mix(in srgb, var(--color-surface-900, #0f172a) 90%, transparent);
  color: var(--color-surface-300, #cbd5e1);
  cursor: pointer;
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}
.stream-nav-btn:hover {
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 80%, transparent);
  color: var(--color-surface-100, #f1f5f9);
}
.stream-nav-btn.primary {
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 50%, transparent);
  color: var(--color-accent-cyan, #22d3ee);
}
.stream-nav-btn.primary:hover {
  background: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 15%, transparent);
}
.stream-nav-btn svg {
  width: 14px;
  height: 14px;
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
.cc-item.intent {
  color: var(--color-accent-amber, #fbbf24);
  font-style: italic;
  font-family: var(--font-sans);
}
.cc-item.fence {
  color: var(--color-accent-rose, #f43f5e);
  opacity: 0.85;
}
.cc-level {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-surface-700, #334155) 60%, transparent);
  color: var(--color-surface-200, #e2e8f0);
}
.cc-level.must,
.cc-level.shall {
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 30%, transparent);
  color: var(--color-accent-rose, #f43f5e);
}
.cc-src {
  color: var(--color-surface-500, #64748b);
  font-size: 10px;
  margin-left: auto;
}
.verify-warn-card {
  align-self: flex-start;
  margin-left: 41px;
  max-width: 820px;
  width: 100%;
  border: 1px solid var(--color-accent-rose, #f43f5e);
  border-radius: 10px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-accent-rose, #f43f5e) 8%, transparent);
}
.vw-head {
  padding: 8px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent-rose, #f43f5e);
  letter-spacing: 0.04em;
  border-bottom: 1px solid color-mix(in srgb, var(--color-accent-rose, #f43f5e) 25%, transparent);
}
.vw-item {
  padding: 4px 14px;
  font-size: 12px;
  color: var(--color-surface-200, #e2e8f0);
  font-family: var(--font-mono, monospace);
}
.vw-foot {
  padding: 6px 14px 8px;
  font-size: 10px;
  color: var(--color-surface-500, #64748b);
  font-family: var(--font-sans);
  border-top: 1px solid color-mix(in srgb, var(--color-accent-rose, #f43f5e) 15%, transparent);
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

.stage-gate {
  flex-shrink: 0;
  margin: 0 22px 14px;
  padding: 13px 14px;
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--color-surface-700, #334155);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-surface-800, #1e293b) 82%, transparent);
}
.stage-gate.review {
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 34%, transparent);
  background: color-mix(
    in srgb,
    var(--color-accent-violet, #a78bfa) 9%,
    var(--color-surface-900, #0f172a)
  );
}
.stage-gate.ready {
  border-color: color-mix(in srgb, var(--color-accent-emerald, #34d399) 36%, transparent);
  background: color-mix(
    in srgb,
    var(--color-accent-emerald, #34d399) 8%,
    var(--color-surface-900, #0f172a)
  );
}
.stage-gate.blocked {
  border-color: color-mix(in srgb, var(--color-accent-amber, #f59e0b) 38%, transparent);
  background: color-mix(
    in srgb,
    var(--color-accent-amber, #f59e0b) 9%,
    var(--color-surface-900, #0f172a)
  );
}
.stage-gate.info {
  border-color: color-mix(in srgb, var(--color-accent-cyan, #22d3ee) 28%, transparent);
}
.stage-gate-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
}
.stage-gate-kicker {
  color: var(--color-surface-500, #64748b);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.stage-gate.review .stage-gate-kicker {
  color: var(--color-accent-violet, #a78bfa);
}
.stage-gate.ready .stage-gate-kicker {
  color: var(--color-accent-emerald, #34d399);
}
.stage-gate.blocked .stage-gate-kicker {
  color: var(--color-accent-amber, #f59e0b);
}
.stage-gate.info .stage-gate-kicker {
  color: var(--color-accent-cyan, #22d3ee);
}
.stage-gate-copy strong {
  color: var(--color-surface-100, #f1f5f9);
  font-size: 13px;
}
.stage-gate-copy span:last-child {
  color: var(--color-surface-400, #94a3b8);
  font-size: 12px;
  line-height: 1.45;
}
.stage-gate-action {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 13px;
  border: 1px solid color-mix(in srgb, var(--color-accent-violet, #a78bfa) 34%, transparent);
  border-radius: 9px;
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 14%, transparent);
  color: var(--color-surface-100, #f1f5f9);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  transition:
    background 0.15s ease-out,
    border-color 0.15s ease-out,
    opacity 0.15s ease-out;
}
.stage-gate-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 22%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-violet, #a78bfa) 52%, transparent);
}
.stage-gate-action.secondary {
  background: transparent;
  color: var(--color-surface-300, #cbd5e1);
}
.stage-gate-action.secondary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-surface-700, #334155) 42%, transparent);
  border-color: color-mix(in srgb, var(--color-surface-500, #64748b) 52%, transparent);
}
.stage-gate.ready .stage-gate-action {
  border-color: color-mix(in srgb, var(--color-accent-emerald, #34d399) 36%, transparent);
  background: color-mix(in srgb, var(--color-accent-emerald, #34d399) 14%, transparent);
}
.stage-gate.ready .stage-gate-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent-emerald, #34d399) 22%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-emerald, #34d399) 54%, transparent);
}
.stage-gate-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
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
