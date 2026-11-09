import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Where large, immutable blobs live (source maps today). The application only ever sees this interface, so the
 * backing service (a directory, an S3-compatible bucket, GCS) is a deployment choice, not application logic.
 *
 * Keys are slash-separated paths of letters, digits and `._-=`. Every key the application builds starts with a tenant
 * prefix (the site id), so a key can never address another tenant's data.
 */
export interface ObjectStore {
  put(key: string, data: Uint8Array): Promise<void>;
  /** The object's bytes, or null when it does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Every object under a prefix, with its age. Streams are not needed at the sizes this holds (thousands of keys). */
  list(prefix: string): Promise<Array<{ key: string; modifiedAt: Date; size: number }>>;
}

const KEY = /^[A-Za-z0-9._=-]+(?:\/[A-Za-z0-9._=-]+)*$/;

/** Rejects empty keys, `..`, absolute paths and anything outside the allowed characters. */
export function assertValidKey(key: string): void {
  if (!KEY.test(key) || key.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`Invalid object key: ${JSON.stringify(key.slice(0, 80))}`);
  }
}

/**
 * Stores objects as files under one directory. Good for development and single-host deployments; with several
 * hosts the directory must be shared, or use an S3-compatible adapter instead. Writes are atomic (a temp file is
 * renamed into place), so a reader never sees half an object.
 */
export class FileSystemObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, ...key.split("/"));
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Object key escapes the store");
    return full;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    const temp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temp, data);
    await rename(temp, full);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async list(prefix: string): Promise<Array<{ key: string; modifiedAt: Date; size: number }>> {
    assertValidKey(prefix);
    const out: Array<{ key: string; modifiedAt: Date; size: number }> = [];
    const walk = async (dir: string, keyPrefix: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const key = `${keyPrefix}/${entry.name}`;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), key);
        else if (!entry.name.endsWith(".tmp")) {
          const info = await stat(path.join(dir, entry.name));
          out.push({ key, modifiedAt: info.mtime, size: info.size });
        }
      }
    };
    await walk(this.resolve(prefix), prefix);
    return out;
  }
}

/** The store the services use. `OBJECT_STORE_DIR` selects the directory (default `.data/objects` under the working directory). */
export function createObjectStore(env: { OBJECT_STORE_DIR?: string | undefined } = process.env): ObjectStore {
  return new FileSystemObjectStore(path.resolve(env.OBJECT_STORE_DIR || ".data/objects"));
}
