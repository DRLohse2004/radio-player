// ESLint für die Oberfläche (src/) und die Tests. Der Electron-Teil (electron/*.cjs) ist reines CommonJS
// und wird hier nicht geprüft.
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
  ignorePatterns: ['dist', 'release', 'vendor', 'electron', 'custom_components', 'native', 'scripts', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  rules: {},
};
