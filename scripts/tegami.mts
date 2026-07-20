import { tegami } from "tegami";
import { createCli } from "tegami/cli";
import { github } from "tegami/plugins/github";

/**
 * Release configuration.
 *
 * Single-package repo: the npm plugin auto-discovers `pi-codex-micro`
 * from package.json.
 *
 * Flow: write changelog files under `.tegami/`, then CI (`tegami ci`)
 * opens a "Version Packages" PR; merging it publishes to npm and cuts
 * a GitHub release.
 */
const release = tegami({
  plugins: [
    github({
      repo: "jal-co/pi-codex-micro",
      versionPr: {
        base: "main",
        // Conventional title so the squashed merge commit stays clean.
        create: () => ({ title: "chore(release): version packages" }),
      },
    }),
  ],
});

void createCli(release).parseAsync();
