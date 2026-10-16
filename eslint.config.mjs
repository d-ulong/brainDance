import { dirname } from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: dirname(fileURLToPath(import.meta.resolve("eslint-config-next"))),
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/db/migrations/**",
      ".trellis/**",
      "docs/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  prettier,
];

export default eslintConfig;
