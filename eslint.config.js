// ESLint 9 flat config — Vue 3 + TypeScript + Prettier
// Docs: https://eslint.org/docs/latest/use/configure/configuration-files

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
      "cli-bridge/**",
      "node_modules/**",
      "**/node_modules/**",
      "app/workers/render-worker.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],

  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  {
    files: ["**/*.{ts,tsx,vue}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        queueMicrotask: "readonly",
        fetch: "readonly",
        URL: "readonly",
        FormData: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLButtonElement: "readonly",
        ResizeObserver: "readonly",
        MutationObserver: "readonly",
        IntersectionObserver: "readonly",
        localStorage: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        Worker: "readonly",
        MessageEvent: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      // 实用主义规则集
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      // 既有 FloatingWindow 直接修改 props.entry 的字段;改造需引入 emit 链路,先警告。
      "vue/no-mutating-props": "warn",
      "vue/attributes-order": "off",
      "vue/first-attribute-linebreak": "off",
    },
  },

  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },

  {
    // Electron preload 必须是 CJS(contextIsolation 不支持 ESM)。
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },

  {
    // Electron 主进程是 Node 环境,console.log 用于打印子进程 stdout,属合理用法。
    files: ["electron/**"],
    rules: {
      "no-console": "off",
    },
  },

  eslintConfigPrettier,
];
