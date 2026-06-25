import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_ALGORITHM = "scrypt";
const HASH_KEY_LENGTH = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptPassword(password, salt);

  return [
    HASH_ALGORITHM,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPasswordHash(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const parsedHash = parsePasswordHash(passwordHash);

  if (!parsedHash) {
    return false;
  }

  const key = scryptPassword(password, parsedHash.salt);

  return (
    key.length === parsedHash.key.length && timingSafeEqual(key, parsedHash.key)
  );
}

interface ParsedPasswordHash {
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parsePasswordHash(passwordHash: string): ParsedPasswordHash | undefined {
  const [algorithm, cost, blockSize, parallelization, salt, key] =
    passwordHash.split("$");

  if (
    algorithm !== HASH_ALGORITHM ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
    !salt ||
    !key
  ) {
    return undefined;
  }

  return {
    key: Buffer.from(key, "base64url"),
    salt: Buffer.from(salt, "base64url"),
  };
}

function scryptPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, HASH_KEY_LENGTH, {
    N: SCRYPT_COST,
    maxmem: SCRYPT_MAX_MEMORY,
    p: SCRYPT_PARALLELIZATION,
    r: SCRYPT_BLOCK_SIZE,
  });
}
