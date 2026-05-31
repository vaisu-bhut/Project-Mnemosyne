import type { Selectable } from "kysely";
import type { Db } from "../client.js";
import type { UsersTable } from "../types.js";

export type User = Selectable<UsersTable>;

export interface CreateUserInput {
  email: string;
  passwordHash?: string | null;
  displayName?: string | null;
}

export async function createUser(db: Db, input: CreateUserInput): Promise<User> {
  return db
    .insertInto("users")
    .values({
      email: input.email.toLowerCase(),
      password_hash: input.passwordHash ?? null,
      display_name: input.displayName ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getUserByEmail(
  db: Db,
  email: string,
): Promise<User | undefined> {
  return db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", email.toLowerCase())
    .executeTakeFirst();
}

export async function getUserById(
  db: Db,
  id: string,
): Promise<User | undefined> {
  return db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function listUserIds(db: Db): Promise<string[]> {
  const rows = await db.selectFrom("users").select("id").execute();
  return rows.map((r) => r.id);
}
