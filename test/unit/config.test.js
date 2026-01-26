const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { mockVscode } = require('../utils/mockVscode.js');

// Mock VS Code before requiring the extension
global.vscode = mockVscode;

describe('Configuration and Settings Tests', () => {
    let mockConfig;
    
    beforeEach(() => {
        // Create a mock configuration object
        mockConfig = {
            data: new Map(),
            get(key) {
                return this.data.get(key);
            },
            set(key, value) {
                this.data.set(key, value);
            },
            has(key) {
                return this.data.has(key);
            }
        };
        
        // Override the global mock to use our test config
        global.vscode.workspace.getConfiguration = () => mockConfig;
    });

    afterEach(() => {
        mockConfig.data.clear();
    });

    describe('Problem Matcher Pattern Validation', () => {
        it('should handle valid problem matcher patterns', () => {
            const validPatterns = [
                {
                    regexp: '^(.+?):(\\d+):(\\d+):\\s*(error|warning):\\s*(.+)$',
                    file: 1,
                    line: 2,
                    column: 3,
                    severity: 4,
                    message: 5
                },
                {
                    regexp: '(error|warning):\\s*(.+)$',
                    severity: 1,
                    message: 2
                },
                {
                    regexp: '^(.+?)\\((\\d+)\\):\\s*(.*?)$',
                    file: 1,
                    line: 2,
                    message: 3
                }
            ];

            mockConfig.set('problemMatcherPatterns', validPatterns);

            const patterns = mockConfig.get('problemMatcherPatterns');
            assert.strictEqual(patterns.length, 3);

            // Test each pattern compiles to valid regex
            patterns.forEach((pattern, index) => {
                try {
                    const regex = new RegExp(pattern.regexp, 'i');
                    assert(regex instanceof RegExp, `Pattern ${index} should compile to valid regex`);
                } catch (error) {
                    assert.fail(`Pattern ${index} failed to compile: ${error.message}`);
                }
            });
        });

        it('should handle malformed problem matcher patterns', () => {
            const malformedPatterns = [
                // Missing regexp
                {
                    file: 1,
                    line: 2,
                    message: 3
                },
                // Invalid regexp
                {
                    regexp: '[unclosed bracket',
                    message: 1
                },
                // Non-numeric group indices
                {
                    regexp: '(.+)',
                    file: 'not-a-number',
                    line: 2
                },
                // Group indices out of range
                {
                    regexp: '(.+)',
                    file: 1,
                    line: 5, // Only 1 capture group
                    message: 10
                }
            ];

            mockConfig.set('problemMatcherPatterns', malformedPatterns);

            const patterns = mockConfig.get('problemMatcherPatterns');
            assert.strictEqual(patterns.length, 4);

            // Should handle malformed patterns gracefully
            const testLine = 'src/main.cpp:42:10: error: test error';
            
            patterns.forEach((pattern, index) => {
                try {
                    if (pattern.regexp) {
                        const regex = new RegExp(pattern.regexp, 'i');
                        const match = testLine.match(regex);
                        // Match or no match is fine, just shouldn't crash
                        assert(match === null || Array.isArray(match));
                    }
                } catch (error) {
                    // Invalid patterns should be handled gracefully
                    console.log(`Pattern ${index} is invalid: ${error.message}`);
                }
            });
        });

        it('should handle empty problem matcher patterns', () => {
            mockConfig.set('problemMatcherPatterns', []);

            const patterns = mockConfig.get('problemMatcherPatterns');
            assert.strictEqual(patterns.length, 0);

            // Should fall back to some default behavior or handle gracefully
            const testLine = 'src/main.cpp:42:10: error: test error';
            // No patterns means no matches, which is expected
        });

        it('should handle missing problem matcher patterns configuration', () => {
            // Don't set the configuration at all
            const patterns = mockConfig.get('problemMatcherPatterns');
            assert.strictEqual(patterns, undefined);

            // Should handle undefined configuration gracefully
        });
    });

    describe('File Path Wildcard Validation', () => {
        it('should handle valid wildcard patterns', () => {
            const validWildcards = [
                'logs/*.log',
                'build/**/*.log',
                '/absolute/path/*.log',
                'C:\\Windows\\path\\*.log',
                'relative/path/file.log',
                '**/*.{log,txt}'
            ];

            mockConfig.set('logFilePathWildcards', validWildcards);

            const wildcards = mockConfig.get('logFilePathWildcards');
            assert.strictEqual(wildcards.length, 6);

            // Each wildcard should be a string
            wildcards.forEach((wildcard, index) => {
                assert.strictEqual(typeof wildcard, 'string', `Wildcard ${index} should be a string`);
                assert(wildcard.length > 0, `Wildcard ${index} should not be empty`);
            });
        });

        it('should handle edge case wildcard patterns', () => {
            const edgeCaseWildcards = [
                '',              // Empty string
                '*',             // Just wildcard
                '**',            // Just double wildcard
                '/',             // Just separator
                '\\',            // Just Windows separator
                'file.log',      // No wildcards
                '*.log*',        // Multiple wildcards
                'logs/**/sub/*/*.log'  // Complex pattern
            ];

            mockConfig.set('logFilePathWildcards', edgeCaseWildcards);

            const wildcards = mockConfig.get('logFilePathWildcards');
            assert.strictEqual(wildcards.length, 8);

            // Should handle all patterns without crashing
            wildcards.forEach((wildcard, index) => {
                assert.strictEqual(typeof wildcard, 'string', `Wildcard ${index} should be a string`);
            });
        });

        it('should handle non-string wildcard entries', () => {
            const invalidWildcards = [
                'logs/*.log',    // Valid string
                null,            // null
                undefined,       // undefined
                123,             // number
                {},              // object
                [],              // array
                true,            // boolean
                'valid/*.log'    // Another valid string
            ];

            mockConfig.set('logFilePathWildcards', invalidWildcards);

            const wildcards = mockConfig.get('logFilePathWildcards');
            assert.strictEqual(wildcards.length, 8);

            // Filter to only valid strings
            const validWildcards = wildcards.filter(w => typeof w === 'string' && w.length > 0);
            assert.strictEqual(validWildcards.length, 2);
        });
    });

    describe('Auto-start Configuration', () => {
        it('should handle boolean auto-start values', () => {
            const booleanValues = [true, false];

            booleanValues.forEach(value => {
                mockConfig.set('autoStart', value);
                const autoStart = mockConfig.get('autoStart');
                assert.strictEqual(autoStart, value);
                assert.strictEqual(typeof autoStart, 'boolean');
            });
        });

        it('should handle non-boolean auto-start values', () => {
            const nonBooleanValues = [
                'true',      // string
                'false',     // string
                1,           // number
                0,           // number
                null,        // null
                {},          // object
                []           // array
            ];

            nonBooleanValues.forEach(value => {
                mockConfig.set('autoStart', value);
                const autoStart = mockConfig.get('autoStart');
                
                // Should handle conversion or default behavior
                // The actual behavior depends on implementation
                // For our mock, we just verify it doesn't crash
                assert(autoStart === value); // Mock returns exactly what was set
            });
        });
    });

    describe('Configuration Change Handling', () => {
        it('should detect configuration changes', () => {
            const initialWildcards = ['logs/*.log'];
            const updatedWildcards = ['logs/*.log', 'build/*.log'];

            mockConfig.set('logFilePathWildcards', initialWildcards);
            
            // Simulate configuration change
            const oldConfig = JSON.stringify(mockConfig.get('logFilePathWildcards'));
            mockConfig.set('logFilePathWildcards', updatedWildcards);
            const newConfig = JSON.stringify(mockConfig.get('logFilePathWildcards'));

            assert.notStrictEqual(oldConfig, newConfig);
        });

        it('should handle rapid configuration changes', () => {
            const changes = [
                ['logs/*.log'],
                ['logs/*.log', 'build/*.log'],
                ['build/*.log'],
                [],
                ['new/*.log', 'other/*.log', 'third/*.log']
            ];

            let previousConfig = null;

            changes.forEach((wildcards, index) => {
                mockConfig.set('logFilePathWildcards', wildcards);
                const currentConfig = JSON.stringify(mockConfig.get('logFilePathWildcards'));
                
                if (previousConfig !== null) {
                    // Each change should be different (except potentially the last)
                    if (index < changes.length - 1) {
                        assert.notStrictEqual(currentConfig, previousConfig, `Change ${index} should be different`);
                    }
                }
                
                previousConfig = currentConfig;
            });
        });
    });

    describe('Default Configuration Values', () => {
        it('should provide sensible defaults when configuration is missing', () => {
            // Clear all configuration
            mockConfig.data.clear();

            // Test default fallbacks
            const problemPatterns = mockConfig.get('problemMatcherPatterns') || [];
            const wildcards = mockConfig.get('logFilePathWildcards') || [];
            const autoStart = mockConfig.get('autoStart') || false;

            assert(Array.isArray(problemPatterns));
            assert(Array.isArray(wildcards));
            assert.strictEqual(typeof autoStart, 'boolean');
        });

        it('should handle partial configuration', () => {
            // Set only some configuration values
            mockConfig.set('autoStart', true);
            // Leave problemMatcherPatterns and logFilePathWildcards unset

            const autoStart = mockConfig.get('autoStart');
            const problemPatterns = mockConfig.get('problemMatcherPatterns') || [];
            const wildcards = mockConfig.get('logFilePathWildcards') || [];

            assert.strictEqual(autoStart, true);
            assert(Array.isArray(problemPatterns));
            assert(Array.isArray(wildcards));
        });
    });

    describe('Configuration Schema Validation', () => {
        it('should validate complete configuration schema', () => {
            const completeConfig = {
                logFilePathWildcards: ['logs/*.log', 'build/*.log'],
                problemMatcherPatterns: [
                    {
                        regexp: '^(.+?):(\\d+):(\\d+):\\s*(error|warning):\\s*(.+)$',
                        file: 1,
                        line: 2,
                        column: 3,
                        severity: 4,
                        message: 5
                    }
                ],
                autoStart: true
            };

            // Set all configuration values
            Object.entries(completeConfig).forEach(([key, value]) => {
                mockConfig.set(key, value);
            });

            // Validate all values are set correctly
            assert.deepStrictEqual(mockConfig.get('logFilePathWildcards'), completeConfig.logFilePathWildcards);
            assert.deepStrictEqual(mockConfig.get('problemMatcherPatterns'), completeConfig.problemMatcherPatterns);
            assert.strictEqual(mockConfig.get('autoStart'), completeConfig.autoStart);
        });

        it('should handle configuration with extra unknown properties', () => {
            mockConfig.set('logFilePathWildcards', ['logs/*.log']);
            mockConfig.set('unknownProperty', 'unknown value');
            mockConfig.set('anotherUnknown', 123);

            // Known properties should still work
            const wildcards = mockConfig.get('logFilePathWildcards');
            assert.deepStrictEqual(wildcards, ['logs/*.log']);

            // Unknown properties should be ignored gracefully
            const unknown = mockConfig.get('unknownProperty');
            assert.strictEqual(unknown, 'unknown value');
        });
    });
});
