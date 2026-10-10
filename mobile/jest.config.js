module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.{ts,tsx}'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
}
