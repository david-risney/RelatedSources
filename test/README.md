# WatchBuildLog Extension Test Suite

This directory contains comprehensive unit tests for the WatchBuildLog VS Code extension. The tests are built using Node.js's built-in test runner (Web Platform Tests - WPT style) and provide thorough coverage of all extension functionality.

## Test Structure

```
test/
├── runner.js                 # Test runner script with enhanced output
├── utils/
│   └── mockVscode.js         # Mock VS Code API for testing
└── unit/
    ├── parser.test.js        # Error parsing and severity mapping tests
    ├── glob.test.js          # File glob matching and path resolution tests
    ├── integration.test.js   # End-to-end log file parsing tests
    ├── edge-cases.test.js    # Edge cases and error handling tests
    └── config.test.js        # Configuration validation tests
```

## Test Categories

### 1. Parser Tests (`parser.test.js`)
Tests the core error parsing functionality:
- **parseErrorLine**: Tests regex pattern matching for various log formats (GCC, Clang, MSVC, etc.)
- **mapSeverity**: Tests severity level mapping (error, warning, info, hint)
- **Pattern validation**: Tests handling of invalid regex patterns and malformed input

**Key test scenarios:**
- GCC/Clang format: `main.cpp:42:10: error: undefined variable "test"`
- MSVC format: `main.cpp(15,8): error C2065: undeclared identifier`
- Simple format: `error: Build failed with 3 errors`
- Multiple patterns with priority handling
- Invalid regex pattern graceful handling

### 2. Glob Matching Tests (`glob.test.js`)
Tests file path wildcard matching and resolution:
- **globMatch**: Tests wildcard pattern matching (`*.log`, `**/*.log`, etc.)
- **searchPath**: Tests recursive directory traversal
- **findMatchingFiles**: Tests workspace-relative and absolute path resolution

**Key test scenarios:**
- Simple wildcards: `logs/*.log`
- Directory wildcards: `*/build/*.log`
- Complex patterns: `**/debug/**/*.log`
- Cross-platform path handling (Windows vs Unix)
- Permission error handling
- Non-existent path handling

### 3. Integration Tests (`integration.test.js`)
Tests complete log file parsing workflow:
- **parseLogFile**: Tests end-to-end log file parsing with multiple error types
- **Diagnostic creation**: Tests VS Code diagnostic object creation and ranges
- **File handling**: Tests various file conditions (empty, large, unicode, etc.)

**Key test scenarios:**
- Complete build logs with mixed error formats
- Unicode file paths and error messages
- Very large line/column numbers
- Mixed line endings (Windows/Unix)
- Malformed log files
- Diagnostic range calculation

### 4. Edge Cases Tests (`edge-cases.test.js`)
Tests robustness and error handling:
- **Input validation**: Tests null/undefined/extreme inputs
- **Performance**: Tests with large datasets and complex patterns
- **Cross-platform**: Tests Windows/Unix path differences
- **Internationalization**: Tests non-ASCII file paths and messages
- **Concurrency**: Tests simultaneous operations

**Key test scenarios:**
- Extremely long strings (1MB+)
- Special regex characters in file paths
- Catastrophic backtracking prevention
- Memory usage with large pattern sets
- Unicode file paths (Cyrillic, Chinese, Japanese, etc.)
- Concurrent parsing operations

### 5. Configuration Tests (`config.test.js`)
Tests configuration validation and handling:
- **Problem matcher patterns**: Tests pattern validation and compilation
- **File path wildcards**: Tests wildcard pattern validation
- **Auto-start configuration**: Tests boolean configuration handling
- **Configuration changes**: Tests dynamic configuration updates

**Key test scenarios:**
- Valid and invalid problem matcher patterns
- Malformed regex patterns
- Missing configuration properties
- Configuration schema validation
- Rapid configuration changes

## Mock VS Code API

The `mockVscode.js` file provides a comprehensive mock of the VS Code API including:
- **Diagnostic and DiagnosticSeverity**: For error reporting
- **Range and Position**: For error location handling
- **Uri**: For file path handling
- **Languages API**: For diagnostic collection management
- **Workspace API**: For configuration management

## Running Tests

### Using npm scripts (recommended):
```bash
# Run all tests
npm test

# Run specific test categories
npm run test-parser        # Parser tests only
npm run test-glob          # Glob matching tests only
npm run test-integration   # Integration tests only
npm run test-edge-cases    # Edge case tests only
npm run test-config        # Configuration tests only

# Development workflows
npm run test-watch         # Run tests in watch mode
npm run test-coverage      # Run tests with coverage analysis
```

### Using the test runner directly:
```bash
# Run all tests with enhanced output
node test/runner.js

# Run with coverage analysis
node test/runner.js --coverage

# Show help
node test/runner.js --help
```

### Using Node.js test runner directly:
```bash
# Run all unit tests
node --test test/unit/**/*.test.js

# Run specific test file
node --test test/unit/parser.test.js

# Run with coverage (experimental)
node --test --experimental-test-coverage test/unit/**/*.test.js
```

## Test Philosophy

The test suite follows these principles:

1. **Comprehensive Coverage**: Tests cover all major functions and edge cases
2. **Isolation**: Each test is independent and doesn't affect others
3. **Realistic Scenarios**: Tests use real-world log formats and error patterns
4. **Cross-Platform**: Tests work on Windows, macOS, and Linux
5. **Performance Awareness**: Tests include performance benchmarks for critical paths
6. **Error Resilience**: Tests verify graceful handling of malformed input

## Adding New Tests

When adding new functionality to the extension:

1. **Add unit tests** for new functions in the appropriate test file
2. **Update integration tests** if the change affects the overall workflow
3. **Add edge case tests** for any new input validation or error handling
4. **Update configuration tests** if new settings are added
5. **Run the full test suite** to ensure no regressions

### Test File Template

```javascript
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { mockVscode } = require('../utils/mockVscode.js');

// Mock VS Code before requiring the extension
global.vscode = mockVscode;

describe('Feature Name Tests', () => {
    let testObject;

    beforeEach(() => {
        testObject = new TestableClass();
    });

    describe('functionName', () => {
        it('should handle normal case', () => {
            const result = testObject.functionName('input');
            assert.strictEqual(result, 'expected');
        });

        it('should handle edge case', () => {
            const result = testObject.functionName('');
            assert.strictEqual(result, null);
        });
    });
});
```

## Test Coverage Goals

The test suite aims for:
- **Function coverage**: >95% of functions tested
- **Line coverage**: >90% of lines executed
- **Branch coverage**: >85% of conditional branches tested
- **Error path coverage**: All error handling paths tested

## Continuous Integration

The tests are designed to run in CI environments:
- No external dependencies (beyond Node.js built-ins)
- Fast execution (typically <30 seconds for full suite)
- Clear failure reporting
- Cross-platform compatibility
- Deterministic results (no flaky tests)

## Debugging Tests

To debug failing tests:

1. **Run specific test file**: `npm run test-parser`
2. **Use console.log**: Add logging to see intermediate values
3. **Check mock setup**: Ensure VS Code API mocking is correct
4. **Verify test data**: Check that test inputs match expected formats
5. **Run in isolation**: Comment out other tests to isolate the issue

## Performance Testing

The test suite includes performance benchmarks for critical operations:
- Pattern matching with large datasets
- File system operations with many files
- Regex compilation overhead
- Memory usage with large log files

These help ensure the extension remains responsive under load.
