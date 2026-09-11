import { resolve } from "node:path";

const config = {
  plugins: {
    "@tailwindcss/postcss": { base: resolve(process.cwd(), "src") },
  },
};

export default config;
