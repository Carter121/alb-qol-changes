import path from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import monkey from "vite-plugin-monkey";
import { sites } from "./src/tweaks/sites";
import pkg from "./package.json" with { type: "json" };

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        author: pkg.author,
        icon: "https://www.google.com/s2/favicons?sz=64&domain=albertsons.com",
        namespace: "com.cartercarling.alb-qol-fixes",
        match: sites.flatMap((site) => [...site.matches]),
      },
    }),
  ],
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
});
