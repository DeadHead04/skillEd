// Modified for the skilled TypeScript distribution.
import type { CaseConfig } from "../contracts/schema.js";
export const configurationWithSkill = "with_skill",
  configurationWithoutSkill = "without_skill";
export interface Plan {
  startIteration: number;
  iterations: IterationPlan[];
  taskTotal: number;
}
export interface IterationPlan {
  number: number;
  tasks: PlannedTask[];
}
export interface PlannedTask {
  id: string;
  globalIndex: number;
  globalTotal: number;
  iteration: number;
  case: CaseConfig;
  configuration: string;
}
export function buildPlan(
  cases: CaseConfig[],
  startIteration: number,
  iterationCount: number,
  configurations: string[],
): Plan {
  startIteration = Math.max(1, startIteration);
  iterationCount = Math.max(1, iterationCount);
  const taskTotal = cases.length * iterationCount * configurations.length,
    iterations: IterationPlan[] = [];
  let globalIndex = 0;
  for (let offset = 0; offset < iterationCount; offset++) {
    const number = startIteration + offset,
      tasks: PlannedTask[] = [];
    for (const cfg of cases)
      for (const configuration of configurations) {
        globalIndex++;
        tasks.push({
          id: "task-" + globalIndex,
          globalIndex,
          globalTotal: taskTotal,
          iteration: number,
          case: cfg,
          configuration,
        });
      }
    iterations.push({ number, tasks });
  }
  return { startIteration, iterations, taskTotal };
}
