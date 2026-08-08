export type AssociationInkPathInput = {
  edgeId: string;
  exactPath: string;
};

export type AssociationInkPaths = {
  echoPath: string;
  hitPath: string;
  inkPath: string;
  washPath: string;
};

const pathTokenPattern = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gu;

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function signedOffset(seed: string, limit: number) {
  return (((hashText(seed) & 0xffff) / 0x7fff) - 1) * limit;
}

function formatCoordinate(value: number) {
  return Number(value.toFixed(2)).toString();
}

function perturbInteriorCoordinates(exactPath: string, edgeId: string, variant: string, limit: number) {
  const tokens = exactPath.match(pathTokenPattern);
  if (!tokens) return exactPath;
  const numericIndexes = tokens.flatMap((token, index) => Number.isFinite(Number(token)) ? [index] : []);
  if (numericIndexes.length < 6) return exactPath;
  const protectedIndexes = new Set([
    numericIndexes[0]!,
    numericIndexes[1]!,
    numericIndexes[numericIndexes.length - 2]!,
    numericIndexes[numericIndexes.length - 1]!
  ]);
  let coordinateIndex = 0;
  return tokens.map((token, tokenIndex) => {
    if (!Number.isFinite(Number(token))) return token;
    const currentCoordinateIndex = coordinateIndex;
    coordinateIndex += 1;
    if (protectedIndexes.has(tokenIndex)) return token;
    const axis = currentCoordinateIndex % 2 === 0 ? "x" : "y";
    const offset = signedOffset(`${edgeId}:${variant}:${currentCoordinateIndex}:${axis}`, limit);
    return formatCoordinate(Number(token) + offset);
  }).join(" ");
}

/**
 * Builds stable visible strokes over an exact routed path. The hit path is deliberately returned
 * byte-for-byte so visual texture cannot change edge endpoints or interaction geometry.
 */
export function createAssociationInkPaths({ edgeId, exactPath }: AssociationInkPathInput): AssociationInkPaths {
  return {
    echoPath: perturbInteriorCoordinates(exactPath, edgeId, "echo", 4.5),
    hitPath: exactPath,
    inkPath: perturbInteriorCoordinates(exactPath, edgeId, "ink", 3.4),
    washPath: perturbInteriorCoordinates(exactPath, edgeId, "wash", 2.6)
  };
}
