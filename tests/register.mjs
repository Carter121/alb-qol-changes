import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";
import { compileModule } from "svelte/compiler";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "vite-plugin-monkey/dist/client")
      return {
        url: new URL("./userscript-mock.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    if (specifier.startsWith(".") && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".svelte.ts"]) {
        const url = new URL(base.href + suffix);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) {
      let source = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText;
      if (url.endsWith(".svelte.ts"))
        source = compileModule(source, {
          filename: new URL(url).pathname,
          generate: "client",
        }).js.code;
      source = source.replaceAll(
        "import.meta.env.VITE_PAPERWORK_API_URL",
        '"http://127.0.0.1:8080"',
      );
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});
