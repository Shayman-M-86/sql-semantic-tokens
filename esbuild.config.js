// esbuild.config.js
// Bundle the VS Code extension into a single JS file in out/extension.js

const esbuild = require("esbuild");

async function main() {
  await esbuild.build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    outfile: "out/extension.js",
    external: ["vscode"], // VS Code provides this at runtime
    sourcemap: false,
    minify: true,
  });

  console.log("✅ Bundled to out/extension.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
