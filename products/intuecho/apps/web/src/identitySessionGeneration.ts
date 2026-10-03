let generation = 0;

export function getIdentitySessionGeneration() {
  return generation;
}

export function invalidateIdentitySession() {
  generation += 1;
  return generation;
}
