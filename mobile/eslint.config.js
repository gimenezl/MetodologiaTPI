const { defineConfig, globalIgnores } = require('eslint/config')
const expo = require('eslint-config-expo/flat')

module.exports = defineConfig([
  globalIgnores(['dist/**', 'android/**', 'ios/**', '.expo/**', 'coverage/**']),
  expo,
])
