/** @type {import('jest').Config} */
const base = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  modulePathIgnorePatterns: ["<rootDir>/dist"],
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] }
}
module.exports = {
  projects: [
    { ...base, displayName: "unit", roots: ["<rootDir>/test/unit"] },
    { ...base, displayName: "integration", roots: ["<rootDir>/test/integration"], setupFiles: ["<rootDir>/test/integration/setup.ts"] }
  ]
}
