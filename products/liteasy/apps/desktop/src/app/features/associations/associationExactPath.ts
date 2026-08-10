export type AssociationExactPoint = {
  left: number;
  top: number;
};

export type AssociationExactSegment = {
  end: AssociationExactPoint;
  start: AssociationExactPoint;
};

export type AssociationExactPath = {
  d: string;
  segments: readonly AssociationExactSegment[];
};

export function createAssociationExactPath(
  start: AssociationExactPoint,
  end: AssociationExactPoint,
  controlRatio: number
): AssociationExactPath {
  const controlLeft = start.left + (end.left - start.left) * controlRatio;
  const controlTop = start.top + (end.top - start.top) * controlRatio;
  return {
    d: `M ${start.left} ${start.top} Q ${controlLeft} ${controlTop} ${end.left} ${end.top}`,
    segments: [{ start, end }]
  };
}
