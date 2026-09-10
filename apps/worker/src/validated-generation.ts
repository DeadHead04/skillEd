export async function validatedGeneration<T>(options: {
  generate: (feedback: string, attempt: number) => Promise<unknown>;
  validate: (value: unknown) => T | Promise<T>;
  rejected: (value: unknown, error: string, attempt: number) => Promise<void>;
}) {
  let feedback = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const value = await options.generate(feedback, attempt);
    try {
      return await options.validate(value);
    } catch (error) {
      feedback = String(error).slice(0, 6000);
      await options.rejected(value, feedback, attempt);
      if (attempt === 3)
        throw new Error(
          `Generation failed validation after 3 attempts: ${feedback}`,
        );
    }
  }
  throw new Error("Generation did not return a validated result");
}
