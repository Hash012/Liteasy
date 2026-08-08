import argon2 from "argon2";

const passwordHashOptions = {
  hashLength: 32,
  memoryCost: 65536,
  parallelism: 1,
  timeCost: 3,
  type: argon2.argon2id
};

let dummyHashPromise;

export function hashPassword(password) {
  return argon2.hash(password, passwordHashOptions);
}

export function verifyPassword(passwordHash, password) {
  return argon2.verify(passwordHash, password);
}

export async function performDummyPasswordVerification(password) {
  dummyHashPromise ??= hashPassword("Liteasy dummy credential 4f38e1b0");
  const dummyHash = await dummyHashPromise;
  await verifyPassword(dummyHash, password);
}
