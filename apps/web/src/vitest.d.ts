// Fait connaître à `tsc` les matchers jest-dom (toBeInTheDocument, etc.)
// enregistrés au runtime par `import '@testing-library/jest-dom/vitest'`
// dans `vitest.setup.ts`. Sans ce fichier, ce setup n'est pas dans le
// programme TS (hors de `include: ["src"]`) et les types d'augmentation
// de `vitest.Assertion` ne sont jamais chargés par tsc.
/// <reference types="@testing-library/jest-dom/vitest" />
