import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "hl-github-"));
process.env.HLSTUDIO_HOME = home;

const {
  isValidBranchName,
  maskSecrets,
  parseGithubRemote,
  gitAuthEnv,
  getGithubToken,
} = await import("@/lib/workspace/github");
const { isSensitiveEnvName, safeEnv } = await import("@/lib/agent/safeEnv");
const { setGithubToken } = await import("@/lib/config/store");

test("accepte des noms de branche usuels", () => {
  for (const name of ["main", "feat/ajout-sqlite", "release-1.2", "user/fix_42"]) {
    assert.ok(isValidBranchName(name), `devrait accepter ${name}`);
  }
});

test("refuse les noms de branche dangereux ou invalides pour Git", () => {
  const refused = [
    "--upload-pack=touch /tmp/pwn",
    "-b",
    "ma branche",
    "feat/..//evasion",
    "a..b",
    "feat//double",
    "termine/",
    "termine.",
    "ma-branche.lock",
    "branche;rm -rf /",
    "branche$(whoami)",
    "branche`id`",
    "",
    "x".repeat(101),
  ];
  for (const name of refused) {
    assert.equal(isValidBranchName(name), false, `devrait refuser ${JSON.stringify(name)}`);
  }
  assert.equal(isValidBranchName(undefined), false);
  assert.equal(isValidBranchName(42), false);
});

test("reconnaît les URL GitHub légitimes", () => {
  const expected = { owner: "djabliameizafredy-a11y", repo: "HL-studio-01" };
  for (const remote of [
    "https://github.com/djabliameizafredy-a11y/HL-studio-01",
    "https://github.com/djabliameizafredy-a11y/HL-studio-01.git",
    "https://github.com/djabliameizafredy-a11y/HL-studio-01/",
    "git@github.com:djabliameizafredy-a11y/HL-studio-01.git",
  ]) {
    assert.deepEqual(parseGithubRemote(remote), expected, remote);
  }
});

test("refuse tout remote qui n'est pas exactement github.com", () => {
  const refused = [
    "https://github.com.attaquant.test/o/r",
    "https://githubXcom/o/r",
    "https://raw.githubusercontent.com/o/r",
    "https://gitlab.com/o/r",
    "git@gitlab.com:o/r.git",
    "http://github.com/o/r",
    "https://user:motdepasse@github.com/o/r",
    "file:///etc/passwd",
    "pas-une-url",
    "https://github.com/",
    "https://github.com/trop/de/segments",
  ];
  for (const remote of refused) {
    assert.equal(parseGithubRemote(remote), null, `devrait refuser ${remote}`);
  }
});

test("maskSecrets masque le token fourni et les formats GitHub connus", () => {
  const token = "mon-token-prive-xyz";
  const masked = maskSecrets(`git: échec avec ${token} sur le remote`, token);
  assert.ok(!masked.includes(token));
  assert.ok(masked.includes("***"));

  const prefixA = "ghp_";
  const prefixB = "github_pat_";
  const fakeA = `${prefixA}0123456789abcdefghijklmnopqrstuvwxyz`;
  const fakeB = `${prefixB}01234567890123456789_abc`;
  const spotted = maskSecrets(`remote: ${fakeA} rejeté, ${fakeB} aussi`);
  assert.ok(!spotted.includes(fakeA));
  assert.ok(!spotted.includes(fakeB));

  assert.equal(maskSecrets("rien à masquer", undefined), "rien à masquer");
});

test("le token passe par un en-tête HTTP, jamais par l'URL", () => {
  const env = gitAuthEnv("token-secret-abc");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_CONFIG_KEY_0, "http.extraHeader");

  const header = env.GIT_CONFIG_VALUE_0!;
  assert.ok(header.startsWith("Authorization: Basic "));
  assert.ok(!header.includes("token-secret-abc"));
  const decoded = Buffer.from(header.replace("Authorization: Basic ", ""), "base64").toString();
  assert.equal(decoded, "x-access-token:token-secret-abc");
});

test("l'environnement git ne transporte aucune clé d'API", () => {
  process.env.TEST_FOURNISSEUR_API_KEY = "sk-secret";
  process.env.GITHUB_TOKEN = "token-dans-env";
  process.env.TEST_VARIABLE_ANODINE = "valeur";
  try {
    const env = gitAuthEnv("token-secret-abc");
    assert.equal(env.TEST_FOURNISSEUR_API_KEY, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.TEST_VARIABLE_ANODINE, "valeur");
  } finally {
    delete process.env.TEST_FOURNISSEUR_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.TEST_VARIABLE_ANODINE;
  }
});

test("isSensitiveEnvName reconnaît les noms porteurs de secrets", () => {
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "HL_AGENT_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "DB_PASSWORD",
    "SESSION_COOKIE",
    "SERVICE_CREDENTIAL",
    "AUTH_HEADER",
    "SIGNING_KEY",
  ]) {
    assert.ok(isSensitiveEnvName(name), `devrait filtrer ${name}`);
  }
  for (const name of ["PATH", "HOME", "LANG", "NODE_ENV", "KEYBOARD_LAYOUT"]) {
    assert.equal(isSensitiveEnvName(name), false, `ne devrait pas filtrer ${name}`);
  }
});

test("safeEnv ajoute les variables explicites après le filtrage", () => {
  const env = safeEnv({ SERVICE_API_KEY: "voulu-par-l-utilisateur" });
  assert.equal(env.SERVICE_API_KEY, "voulu-par-l-utilisateur");
});

test("getGithubToken préfère la config locale à la variable d'environnement", () => {
  process.env.GITHUB_TOKEN = "token-environnement";
  try {
    setGithubToken("");
    assert.equal(getGithubToken(), "token-environnement");

    setGithubToken("token-de-la-config");
    assert.equal(getGithubToken(), "token-de-la-config");

    setGithubToken("");
    assert.equal(getGithubToken(), "token-environnement");
  } finally {
    delete process.env.GITHUB_TOKEN;
  }
  assert.equal(getGithubToken(), null);
});

test.after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});
