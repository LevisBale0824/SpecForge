<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t, locale } = useI18n();

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const languages = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "中文" },
];

const selectedLang = ref(locale.value);

function changeLocale(lang: string) {
  selectedLang.value = lang;
  locale.value = lang;
  localStorage.setItem("openspec-locale", lang);
}

function close() {
  emit("update:modelValue", false);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-[10000] flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60" @click="close" />

      <!-- Panel -->
      <div class="relative w-full max-w-md bg-surface-900 border border-surface-700 rounded-xl shadow-2xl p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-lg font-semibold text-surface-200">{{ t("settings.title") }}</h2>
          <button
            class="p-1 rounded text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
            @click="close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Language -->
        <div class="mb-4">
          <label class="block text-sm text-surface-400 mb-2">{{ t("settings.language") }}</label>
          <div class="flex gap-2">
            <button
              v-for="lang in languages"
              :key="lang.value"
              class="px-3 py-1.5 text-sm rounded-lg transition-colors"
              :class="selectedLang === lang.value
                ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30'
                : 'bg-surface-800 text-surface-400 hover:text-surface-200 border border-transparent'"
              @click="changeLocale(lang.value)"
            >
              {{ lang.label }}
            </button>
          </div>
        </div>

        <!-- Backend (placeholder) -->
        <div class="mb-4">
          <label class="block text-sm text-surface-400 mb-2">{{ t("settings.backend") }}</label>
          <div class="text-sm text-surface-600">{{ t("status.disconnected") }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
