<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useWorkflow } from "../../plugins/workflowPlugin";
import { TIER_LABELS, type StepName, type WorkflowTier } from "../../types/workflow";
import StepNav from "./StepNav.vue";

const { t, te } = useI18n();
const { state, enabled, setActiveStep, nextStep, setTier, activeStages } = useWorkflow();

const STAGE_LABELS: Record<StepName, string> = {
  explore: "Explore",
  propose: "Propose",
  plan: "Plan",
  apply: "Apply",
  verify: "Verify",
  review: "Review",
  archive: "Archive",
};

function labelFor(name: StepName): string {
  const key = `workflow.${name}`;
  return te(key) ? (t(key) as string) : STAGE_LABELS[name];
}

const steps = computed(() =>
  activeStages().map((name) => ({
    name,
    label: labelFor(name),
    phase: state.value.steps[name]?.phase ?? "idle",
    active: state.value.activeStep === name,
  })),
);

const tiers = computed<Array<{ id: WorkflowTier; label: string }>>(() => [
  { id: "lean", label: t(TIER_LABELS.lean) },
  { id: "standard", label: t(TIER_LABELS.standard) },
  { id: "thorough", label: t(TIER_LABELS.thorough) },
]);
</script>

<template>
  <div v-if="enabled" class="border-b border-surface-800 bg-surface-900 px-4 py-2">
    <div class="flex items-center gap-4 max-w-3xl mx-auto">
      <!-- Tier selector -->
      <div class="flex items-center gap-1 mr-2 shrink-0">
        <button
          v-for="tier in tiers"
          :key="tier.id"
          class="px-2 py-1 text-[11px] font-medium rounded transition-colors"
          :class="
            state.tier === tier.id
              ? 'bg-accent-emerald/20 text-accent-emerald'
              : 'text-surface-400 hover:text-surface-200'
          "
          :title="tier.label"
          @click="setTier(tier.id)"
        >
          {{ tier.id }}
        </button>
      </div>

      <!-- Step indicators (tier-aware) -->
      <StepNav :steps="steps" @select="setActiveStep" />

      <!-- Next step button -->
      <button
        class="px-3 py-1 text-xs font-medium rounded bg-accent-emerald/15 text-accent-emerald hover:bg-accent-emerald/25 disabled:opacity-30 transition-colors"
        :disabled="state.steps[state.activeStep]?.phase !== 'done'"
        @click="nextStep()"
      >
        {{ t("workflow.next") }}
      </button>
    </div>
  </div>
</template>
