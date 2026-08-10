import { CircuitRenderer, renderCircuit } from "../../app/features/visualization/renderers/circuitRenderer";
import { PhysicsDiagramRenderer, renderPhysicsDiagram } from "../../app/features/visualization/renderers/physicsDiagramRenderer";
import { ohmsLawFixture, projectileFixture } from "./staticScienceFixtures";

export default function ScienceDiagramBrowserFixture() {
  const circuit = renderCircuit(ohmsLawFixture());
  const physics = renderPhysicsDiagram(projectileFixture());

  return (
    <main data-testid="science-diagram-browser-fixture">
      <section data-testid="science-circuit">
        <CircuitRenderer rendered={circuit} />
      </section>
      <section data-testid="science-physics">
        <PhysicsDiagramRenderer rendered={physics} />
      </section>
      <output data-testid="science-diagram-metadata">
        {circuit.selectableObjectIds.join(",")}|{physics.selectableObjectIds.join(",")}
      </output>
    </main>
  );
}
