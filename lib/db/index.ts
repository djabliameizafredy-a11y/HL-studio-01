import { databaseFilePath, ensureHlHome } from "@/lib/paths";
import { MIGRATIONS } from "./migrations";

// `node:sqlite` est intégré à Node — aucun module natif à compiler, donc
// `npx hlstudio` ne peut pas échouer sur une absence de toolchain C++.
// Disponible sans option depuis Node 23.4 ; sur Node 22.5–23.3 il faut
// --experimental-sqlite, que bin/hlstudio.js ajoute automatiquement.
type SqliteModule = typeof import("node:sqlite");
type Database = InstanceType<SqliteModule["DatabaseSync"]>;

export type SqlRow = Record<string, unknown>;

let db: Database | null = null;

function loadSqlite(): SqliteModule {
  // Chargement paresseux plutôt qu'un import statique : sur un Node trop
  // ancien on veut un message lisible, pas un crash au chargement du module.
  //
  // getBuiltinModule est la seule forme qui marche partout : `require`
  // n'existe pas quand ce fichier est chargé en ESM (tests), et
  // `import.meta` n'existe pas une fois transpilé en CommonJS par Next.
  try {
    const sqlite = process.getBuiltinModule?.("node:sqlite") as SqliteModule | undefined;
    if (sqlite?.DatabaseSync) return sqlite;
  } catch {
    // Node 22.5–23.3 sans --experimental-sqlite : on tombe dans le message
    // d'aide ci-dessous plutôt que de propager une erreur interne.
  }

  throw new Error(
    `HL Studio a besoin du module SQLite intégré à Node (22.5 minimum, 24 recommandé). ` +
      `Version détectée : ${process.versions.node}. ` +
      `Sur Node 22.5 à 23.3, relance avec --experimental-sqlite ; sinon mets Node à jour depuis https://nodejs.org.`
  );
}

function runMigrations(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (database.prepare("SELECT id FROM schema_migrations").all() as SqlRow[]).map(
      (row) => Number(row.id)
    )
  );

  const record = database.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // Chaque migration est atomique : si une instruction échoue, la base
    // reste dans l'état précédent et n'est pas marquée comme appliquée.
    database.exec("BEGIN");
    try {
      database.exec(migration.sql);
      record.run(migration.id, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.id} (${migration.name}) a échoué : ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

/**
 * Base SQLite locale, créée au premier appel. Le fichier vit dans
 * ~/.hlstudio pour survivre aux mises à jour de `npx hlstudio`.
 */
export function getDb(): Database {
  if (db) return db;

  ensureHlHome();
  const { DatabaseSync } = loadSqlite();
  const database = new DatabaseSync(databaseFilePath());

  // WAL : les lectures ne bloquent pas les écritures, utile parce que le
  // streaming du chat écrit en fin de réponse pendant que l'historique
  // peut être relu. foreign_keys n'est pas actif par défaut dans SQLite,
  // sans quoi les ON DELETE CASCADE seraient ignorés.
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");

  runMigrations(database);

  db = database;
  return db;
}

/** Ferme la base (arrêt du serveur, tests). */
export function closeDb(): void {
  db?.close();
  db = null;
}
