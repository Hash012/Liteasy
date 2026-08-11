const maxFormulaLength = 256;
const maxFormulaDepth = 8;
const maxAtomsPerFormula = 4096;
const maxCoefficient = 4096;
const elementSymbols = new Set(
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" ")
);

export function parseChemicalFormula(formula) {
  return { ...parseChemicalSpeciesFormula(formula).atoms };
}

export function parseChemicalSpeciesFormula(formula) {
  if (typeof formula !== "string" || formula.length === 0 || formula.length > maxFormulaLength ||
    formula.trim() !== formula || /\s/u.test(formula)) {
    throw new Error("reaction_formula_invalid");
  }
  const withoutState = formula.replace(/\((?:aq|s|l|g)\)$/u, "");
  const { charge, formulaBody } = splitCharge(withoutState);
  if (formulaBody === "e") return { atomOrder: [], atoms: {}, charge: charge || -1 };
  if (formulaBody.length === 0) throw new Error("reaction_formula_invalid");

  const atoms = {};
  const atomOrder = [];
  for (const segment of formulaBody.split(/[.·•]/u)) {
    if (!segment) throw new Error("reaction_formula_invalid");
    const coefficientMatch = segment.match(/^(\d+)(?=[A-Z([{])/u);
    const coefficient = coefficientMatch ? boundedPositiveInteger(coefficientMatch[1]) : 1;
    const body = coefficientMatch ? segment.slice(coefficientMatch[1].length) : segment;
    const parsed = parseAtDepth(body, 0, undefined, 0);
    if (parsed.nextIndex !== body.length) throw new Error("reaction_formula_invalid");
    mergeCounts(atoms, parsed.atoms, coefficient);
    appendAtoms(atomOrder, parsed.atomOrder, coefficient);
  }
  if (atomOrder.length === 0 || atomOrder.length > maxAtomsPerFormula) throw new Error("reaction_formula_atom_limit");
  return { atomOrder, atoms, charge };
}

export function balanceReaction(step, species) {
  const speciesById = new Map(species.map((item) => [item.id, item]));
  assertReferences(step, speciesById);
  const items = [...step.reactants, ...step.products];
  const parsed = items.map((item) => parseChemicalSpeciesFormula(speciesById.get(item.speciesId).formula));
  const elements = [...new Set(parsed.flatMap((formula) => Object.keys(formula.atoms)))].sort();
  const matrix = [...elements, "__charge__"].map((element) => items.map((_, columnIndex) => {
    const side = columnIndex < step.reactants.length ? 1 : -1;
    const value = element === "__charge__" ? parsed[columnIndex].charge : parsed[columnIndex].atoms[element] ?? 0;
    return rational(BigInt(side * value));
  }));
  const coefficients = solveOneDimensionalNullspace(matrix);
  return Object.fromEntries(items.map((item, index) => [item.speciesId, coefficients[index]]));
}

export function validateReactionProcessPayload(payload) {
  const speciesById = new Map(payload.species.map((species) => [species.id, species]));
  if (speciesById.size !== payload.species.length || speciesById.size === 0) throw new Error("reaction_species_duplicate");
  for (const species of payload.species) {
    requireEvidence(species.evidenceClaimIds, "reaction_species_unbound");
    parseChemicalSpeciesFormula(species.formula);
  }
  const stepIds = new Set();
  for (const step of payload.steps) {
    if (stepIds.has(step.id)) throw new Error("reaction_step_duplicate");
    stepIds.add(step.id);
    requireEvidence(step.evidenceClaimIds, "reaction_step_unbound");
    for (const mechanism of step.mechanism ?? []) requireEvidence(mechanism.evidenceClaimIds, "reaction_mechanism_unbound");
    assertReferences(step, speciesById);
    assertConserved(step, speciesById);
    assertMinimalCoefficients(step, balanceReaction(step, payload.species));
  }
  if (payload.steps.length === 0) throw new Error("reaction_step_missing");
  for (const condition of payload.conditions) requireEvidence(condition.evidenceClaimIds, "reaction_condition_unbound");
  validateAtomMap(payload, speciesById);
}

function requireEvidence(ids, code) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(code);
}

function parseAtDepth(body, startIndex, closing, depth) {
  if (depth > maxFormulaDepth) throw new Error("reaction_formula_depth_limit");
  const atoms = {};
  const atomOrder = [];
  let index = startIndex;
  let parsedAny = false;
  while (index < body.length) {
    const character = body[index];
    if (closing && character === closing) {
      if (!parsedAny) throw new Error("reaction_formula_invalid");
      return { atomOrder, atoms, nextIndex: index + 1 };
    }
    if (character === "(" || character === "[" || character === "{") {
      const expectedClosing = character === "(" ? ")" : character === "[" ? "]" : "}";
      const group = parseAtDepth(body, index + 1, expectedClosing, depth + 1);
      const multiplier = readNumber(body, group.nextIndex);
      mergeCounts(atoms, group.atoms, multiplier.value);
      appendAtoms(atomOrder, group.atomOrder, multiplier.value);
      index = multiplier.nextIndex;
      parsedAny = true;
      continue;
    }
    if (/[A-Z]/u.test(character)) {
      let symbol = character;
      index += 1;
      if (index < body.length && /[a-z]/u.test(body[index])) {
        symbol += body[index];
        index += 1;
      }
      if (!elementSymbols.has(symbol)) throw new Error("reaction_element_invalid");
      const multiplier = readNumber(body, index);
      atoms[symbol] = (atoms[symbol] ?? 0) + multiplier.value;
      appendAtoms(atomOrder, [symbol], multiplier.value);
      index = multiplier.nextIndex;
      parsedAny = true;
      continue;
    }
    throw new Error("reaction_formula_invalid");
  }
  if (closing || !parsedAny) throw new Error("reaction_formula_invalid");
  return { atomOrder, atoms, nextIndex: index };
}

function splitCharge(formula) {
  const caret = formula.match(/\^(\d*)([+-])$/u);
  if (caret) return { charge: signedCharge(caret[1], caret[2]), formulaBody: formula.slice(0, caret.index) };
  const signThenMagnitude = formula.match(/([+-])(\d+)$/u);
  if (signThenMagnitude) return { charge: signedCharge(signThenMagnitude[2], signThenMagnitude[1]), formulaBody: formula.slice(0, signThenMagnitude.index) };
  const signOnly = formula.match(/([+-])$/u);
  if (!signOnly) return { charge: 0, formulaBody: formula };
  const unsigned = formula.slice(0, -1);
  const trailingMagnitude = unsigned.match(/(\d+)$/u);
  if (trailingMagnitude) {
    const prefix = unsigned.slice(0, trailingMagnitude.index);
    if (/^[A-Z][a-z]?$/u.test(prefix) || /[\])}]$/u.test(prefix)) {
      return { charge: signedCharge(trailingMagnitude[1], signOnly[1]), formulaBody: prefix };
    }
  }
  return { charge: signOnly[1] === "+" ? 1 : -1, formulaBody: unsigned };
}

function signedCharge(magnitudeText, sign) {
  const magnitude = magnitudeText ? boundedPositiveInteger(magnitudeText) : 1;
  return sign === "+" ? magnitude : -magnitude;
}

function readNumber(body, startIndex) {
  let index = startIndex;
  while (index < body.length && /\d/u.test(body[index])) index += 1;
  if (index === startIndex) return { nextIndex: index, value: 1 };
  return { nextIndex: index, value: boundedPositiveInteger(body.slice(startIndex, index)) };
}

function boundedPositiveInteger(value) {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error("reaction_formula_invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maxAtomsPerFormula) throw new Error("reaction_formula_atom_limit");
  return parsed;
}

function mergeCounts(target, source, multiplier) {
  for (const [element, count] of Object.entries(source)) {
    const next = (target[element] ?? 0) + count * multiplier;
    if (!Number.isSafeInteger(next) || next > maxAtomsPerFormula) throw new Error("reaction_formula_atom_limit");
    target[element] = next;
  }
}

function appendAtoms(target, source, multiplier) {
  if (target.length + source.length * multiplier > maxAtomsPerFormula) throw new Error("reaction_formula_atom_limit");
  for (let copy = 0; copy < multiplier; copy += 1) target.push(...source);
}

function assertReferences(step, speciesById) {
  if (step.reactants.length === 0 || step.products.length === 0) throw new Error("reaction_reference_invalid");
  const sideIds = [new Set(), new Set()];
  for (const [sideIndex, items] of [step.reactants, step.products].entries()) {
    for (const item of items) {
      if (!speciesById.has(item.speciesId) || !Number.isInteger(item.coefficient) || item.coefficient <= 0 ||
        item.coefficient > maxCoefficient || sideIds[sideIndex].has(item.speciesId)) {
        throw new Error("reaction_reference_invalid");
      }
      sideIds[sideIndex].add(item.speciesId);
    }
  }
  if ([...sideIds[0]].some((id) => sideIds[1].has(id))) throw new Error("reaction_reference_invalid");
}

function assertConserved(step, speciesById) {
  const reactants = aggregate(step.reactants, speciesById);
  const products = aggregate(step.products, speciesById);
  const elements = new Set([...Object.keys(reactants.atoms), ...Object.keys(products.atoms)]);
  for (const element of elements) {
    if ((reactants.atoms[element] ?? 0) !== (products.atoms[element] ?? 0)) throw new Error("reaction_conservation_failed");
  }
  if (reactants.charge !== products.charge) throw new Error("reaction_charge_conservation_failed");
}

function assertMinimalCoefficients(step, balanced) {
  for (const item of [...step.reactants, ...step.products]) {
    if (balanced[item.speciesId] !== item.coefficient) throw new Error("reaction_coefficients_not_minimal");
  }
}

function aggregate(items, speciesById) {
  const atoms = {};
  let charge = 0;
  for (const item of items) {
    const parsed = parseChemicalSpeciesFormula(speciesById.get(item.speciesId).formula);
    mergeCounts(atoms, parsed.atoms, item.coefficient);
    charge += parsed.charge * item.coefficient;
  }
  return { atoms, charge };
}

function validateAtomMap(payload, speciesById) {
  if (payload.atomMap.length === 0) return;
  const mapIds = new Set();
  const entriesByStep = new Map();
  for (const entry of payload.atomMap) {
    if (mapIds.has(entry.id)) throw new Error("reaction_atom_map_duplicate");
    mapIds.add(entry.id);
    requireEvidence(entry.evidenceClaimIds, "reaction_atom_map_unbound");
    const stepId = entry.stepId ?? (payload.steps.length === 1 ? payload.steps[0].id : undefined);
    if (!stepId || !payload.steps.some((step) => step.id === stepId)) throw new Error("reaction_atom_map_step_invalid");
    const entries = entriesByStep.get(stepId) ?? [];
    entries.push(entry);
    entriesByStep.set(stepId, entries);
  }

  for (const [stepId, entries] of entriesByStep) {
    const step = payload.steps.find((item) => item.id === stepId);
    const reactantAtoms = enumerateSideAtoms(step.reactants, speciesById);
    const productAtoms = enumerateSideAtoms(step.products, speciesById);
    const seenFrom = new Set();
    const seenTo = new Set();
    for (const entry of entries) {
      const from = resolveMappedAtom(entry.fromSpeciesId, entry.fromMolecule, entry.fromAtom, step.reactants, reactantAtoms);
      const to = resolveMappedAtom(entry.toSpeciesId, entry.toMolecule, entry.toAtom, step.products, productAtoms);
      if (from.element !== to.element) throw new Error("reaction_atom_map_element_mismatch");
      if (seenFrom.has(from.key) || seenTo.has(to.key)) throw new Error("reaction_atom_map_duplicate");
      seenFrom.add(from.key);
      seenTo.add(to.key);
    }
    if (seenFrom.size !== reactantAtoms.size || seenTo.size !== productAtoms.size) throw new Error("reaction_atom_map_incomplete");
  }
}

function enumerateSideAtoms(items, speciesById) {
  const atoms = new Map();
  for (const item of items) {
    const atomOrder = parseChemicalSpeciesFormula(speciesById.get(item.speciesId).formula).atomOrder;
    for (let molecule = 0; molecule < item.coefficient; molecule += 1) {
      for (let atom = 0; atom < atomOrder.length; atom += 1) {
        if (atoms.size >= maxAtomsPerFormula) throw new Error("reaction_atom_map_limit");
        atoms.set(atomKey(item.speciesId, molecule, atom), atomOrder[atom]);
      }
    }
  }
  return atoms;
}

function resolveMappedAtom(speciesId, requestedMolecule, atom, items, atoms) {
  const item = items.find((candidate) => candidate.speciesId === speciesId);
  if (!item || !Number.isInteger(atom) || atom < 0) throw new Error("reaction_atom_map_reference_invalid");
  if (requestedMolecule === undefined && item.coefficient !== 1) throw new Error("reaction_atom_map_molecule_ambiguous");
  const molecule = requestedMolecule ?? 0;
  if (!Number.isInteger(molecule) || molecule < 0 || molecule >= item.coefficient) throw new Error("reaction_atom_map_reference_invalid");
  const key = atomKey(speciesId, molecule, atom);
  const element = atoms.get(key);
  if (!element) throw new Error("reaction_atom_map_reference_invalid");
  return { element, key };
}

function atomKey(speciesId, molecule, atom) {
  return `${speciesId}:${molecule}:${atom}`;
}

function solveOneDimensionalNullspace(matrix) {
  if (matrix.length === 0 || matrix[0]?.length === 0) throw new Error("reaction_balance_impossible");
  const rows = matrix.map((row) => row.map((value) => rational(value.numerator, value.denominator)));
  const columnCount = rows[0].length;
  const pivotColumns = [];
  let pivotRow = 0;
  for (let column = 0; column < columnCount && pivotRow < rows.length; column += 1) {
    const candidate = rows.findIndex((row, index) => index >= pivotRow && row[column].numerator !== 0n);
    if (candidate < 0) continue;
    [rows[pivotRow], rows[candidate]] = [rows[candidate], rows[pivotRow]];
    const pivot = rows[pivotRow][column];
    rows[pivotRow] = rows[pivotRow].map((value) => divideRational(value, pivot));
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      if (rowIndex === pivotRow || rows[rowIndex][column].numerator === 0n) continue;
      const factor = rows[rowIndex][column];
      rows[rowIndex] = rows[rowIndex].map((value, index) => subtractRational(value, multiplyRational(factor, rows[pivotRow][index])));
    }
    pivotColumns.push(column);
    pivotRow += 1;
  }
  const freeColumns = Array.from({ length: columnCount }, (_, index) => index).filter((column) => !pivotColumns.includes(column));
  if (freeColumns.length !== 1) throw new Error("reaction_balance_ambiguous");
  const solution = Array.from({ length: columnCount }, () => rational(0n));
  solution[freeColumns[0]] = rational(1n);
  for (let rowIndex = pivotColumns.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const pivotColumn = pivotColumns[rowIndex];
    let sum = rational(0n);
    for (let column = pivotColumn + 1; column < columnCount; column += 1) {
      sum = addRational(sum, multiplyRational(rows[rowIndex][column], solution[column]));
    }
    solution[pivotColumn] = rational(-sum.numerator, sum.denominator);
  }
  const commonDenominator = solution.reduce((value, item) => leastCommonMultiple(value, item.denominator), 1n);
  let integers = solution.map((item) => item.numerator * (commonDenominator / item.denominator));
  if (integers.every((value) => value < 0n)) integers = integers.map((value) => -value);
  if (integers.some((value) => value <= 0n)) throw new Error("reaction_balance_impossible");
  const divisor = integers.reduce((value, item) => greatestCommonDivisor(value, item), integers[0]);
  return integers.map((value) => {
    const coefficient = Number(value / divisor);
    if (!Number.isSafeInteger(coefficient) || coefficient > maxCoefficient) throw new Error("reaction_balance_limit");
    return coefficient;
  });
}

function rational(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error("reaction_balance_impossible");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { denominator: (denominator / divisor) * sign, numerator: (numerator / divisor) * sign };
}

function addRational(left, right) {
  return rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

function subtractRational(left, right) {
  return rational(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
}

function multiplyRational(left, right) {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divideRational(left, right) {
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function leastCommonMultiple(left, right) {
  return (left / greatestCommonDivisor(left, right)) * right;
}
