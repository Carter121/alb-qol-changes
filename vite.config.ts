import path from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import monkey from "vite-plugin-monkey";
import { sites } from "./src/tweaks/sites";
import pkg from "./package.json" with { type: "json" };

const paperworkApi = new URL(
  process.env.VITE_PAPERWORK_API_URL || "http://127.0.0.1:8080",
);
if (
  paperworkApi.protocol !== "https:" &&
  !(
    paperworkApi.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(paperworkApi.hostname)
  )
) {
  throw new Error("Paperwork API requires HTTPS except on localhost");
}
if (
  paperworkApi.username ||
  paperworkApi.password ||
  paperworkApi.search ||
  paperworkApi.hash ||
  paperworkApi.pathname !== "/"
) {
  throw new Error(
    "VITE_PAPERWORK_API_URL must be an origin without credentials, path or query",
  );
}

export default defineConfig(({ mode }) => {
  const isDev = mode === "testing";

  const updateURL = isDev
    ? "https://scripts.yourdomain.com/dev.user.js"
    : "https://carter121.github.io/alb-qol-changes/alb-qol-changes.user.js";

  return {
    define: {
      "import.meta.env.VITE_PAPERWORK_API_URL": JSON.stringify(
        paperworkApi.origin,
      ),
    },
    plugins: [
      tailwindcss(),
      svelte(),
      monkey({
        entry: "src/main.ts",
        userscript: {
          name: isDev ? `${pkg.name} [DEV]` : pkg.name,
          version: isDev
            ? `${pkg.version}.${Math.floor(Date.now() / 1000)}`
            : pkg.version,
          description: pkg.description,
          author: pkg.author,
          icon: "https://www.google.com/s2/favicons?sz=64&domain=albertsons.com",
          namespace: isDev
            ? "com.cartercarling.alb-qol-fixes.dev"
            : "com.cartercarling.alb-qol-fixes",
          connect: [paperworkApi.hostname],
          match: sites.flatMap((site) => [...site.matches]),
          source: "https://github.com/Carter121/alb-qol-changes",
          updateURL: updateURL,
          downloadURL: updateURL,
        },
      }),
    ],
    resolve: {
      alias: {
        $lib: path.resolve("./src/lib"),
      },
    },
  };
});
