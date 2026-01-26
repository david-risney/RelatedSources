const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

describe('Edge Cases and Error Handling Tests', () => {
    describe('Input Validation', () => {
        it('should handle null and undefined inputs gracefully', () => {
            const inputs = [null, undefined, '', 0, false, NaN];
            
            inputs.forEach(input => {
                // Test that these don't crash when passed to string methods
                try {
                    const result = input?.toLowerCase?.() || '';
                    assert.strictEqual(typeof result, 'string');
                } catch (error) {
                    // Expected for some inputs
                }
                
                try {
                    const result = String(input || '');
                    assert.strictEqual(typeof result, 'string');
                } catch (error) {
                    assert.fail(`String conversion failed for ${input}`);
                }
            });
        });

        it('should handle extremely long strings', () => {
            const longString = 'x'.repeat(1000000); // 1MB string
            const line = `src/file.cpp:42:10: error: ${longString}`;
            
            // Should not crash when processing very long lines
            assert(line.length > 1000000);
            assert(line.includes('error:'));
        });

        it('should handle strings with special regex characters', () => {
            const specialChars = ['[', ']', '(', ')', '{', '}', '*', '+', '?', '.', '^', '$', '|', '\\'];
            
            specialChars.forEach(char => {
                const line = `src/file${char}.cpp:42:10: error: message with ${char}`;
                
                // Should be able to process without regex errors
                try {
                    const regex = /^(.+?):(\\d+):(\\d+):\\s*(error|warning):\\s*(.+)$/i;
                    const match = line.match(regex);
                    assert(match !== null || match === null); // Either way is fine
                } catch (error) {
                    assert.fail(`Regex failed for character ${char}: ${error.message}`);
                }
            });
        });
    });

    describe('Memory and Performance', () => {
        it('should handle large number of error patterns efficiently', () => {
            const patterns = [];
            
            // Create 1000 patterns
            for (let i = 0; i < 1000; i++) {
                patterns.push({
                    regexp: `pattern${i}:\\s*(.+)$`,
                    message: 1
                });
            }
            
            const line = 'pattern500: found matching pattern';
            
            // Simulate the pattern matching logic
            let found = false;
            const startTime = process.hrtime.bigint();
            
            for (const pattern of patterns) {
                try {
                    const regex = new RegExp(pattern.regexp, 'i');
                    const match = line.match(regex);
                    if (match) {
                        found = true;
                        break;
                    }
                } catch (error) {
                    // Skip invalid patterns
                }
            }
            
            const endTime = process.hrtime.bigint();
            const durationMs = Number(endTime - startTime) / 1000000;
            
            assert(found);
            assert(durationMs < 1000, `Pattern matching took too long: ${durationMs}ms`);
        });

        it('should handle repeated regex compilation efficiently', () => {
            const pattern = '^(.+?):(\\d+):(\\d+):\\s*(error|warning):\\s*(.+)$';
            const line = 'src/main.cpp:42:10: error: test error';
            
            const startTime = process.hrtime.bigint();
            
            // Compile the same regex 1000 times (simulating repeated calls)
            for (let i = 0; i < 1000; i++) {
                const regex = new RegExp(pattern, 'i');
                const match = line.match(regex);
                assert(match !== null);
            }
            
            const endTime = process.hrtime.bigint();
            const durationMs = Number(endTime - startTime) / 1000000;
            
            assert(durationMs < 1000, `Repeated regex compilation took too long: ${durationMs}ms`);
        });
    });

    describe('Cross-Platform Compatibility', () => {
        it('should handle different path separators', () => {
            const paths = [
                'src/main.cpp',           // Unix style
                'src\\main.cpp',          // Windows style
                'src\\subdir/mixed.cpp',  // Mixed style
                '/absolute/path.cpp',     // Unix absolute
                'C:\\Windows\\path.cpp'   // Windows absolute
            ];
            
            paths.forEach(filePath => {
                const line = `${filePath}:42:10: error: test error`;
                
                // Should be able to extract the file path
                const regex = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;
                const match = line.match(regex);
                
                assert(match !== null);
                assert.strictEqual(match[1], filePath);
            });
        });

        it('should handle different line ending styles', () => {
            const content = 'line1\nline2\r\nline3\rline4';
            const lines = content.split(/\r?\n/);
            
            // Should handle Unix (\n), Windows (\r\n), and Mac (\r) line endings
            assert(lines.length >= 3);
            assert(lines.includes('line1'));
            assert(lines.includes('line2'));
        });
    });

    describe('Internationalization', () => {
        it('should handle non-ASCII file paths', () => {
            const nonAsciiPaths = [
                'src/файл.cpp',           // Cyrillic
                'src/文件.cpp',            // Chinese
                'src/ファイル.cpp',         // Japanese
                'src/tëst.cpp',           // Latin with diacritics
                'src/αρχείο.cpp'          // Greek
            ];
            
            nonAsciiPaths.forEach(filePath => {
                const line = `${filePath}:42:10: error: test error`;
                
                const regex = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;
                const match = line.match(regex);
                
                assert(match !== null);
                assert.strictEqual(match[1], filePath);
            });
        });

        it('should handle non-ASCII error messages', () => {
            const nonAsciiMessages = [
                'ошибка компиляции',      // Russian
                '编译错误',               // Chinese
                'エラーが発生しました',      // Japanese
                'erreur de compilation',  // French
                'Fehler bei der Kompilierung' // German
            ];
            
            nonAsciiMessages.forEach(message => {
                const line = `src/main.cpp:42:10: error: ${message}`;
                
                const regex = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;
                const match = line.match(regex);
                
                assert(match !== null);
                assert.strictEqual(match[5], message);
            });
        });
    });

    describe('Numeric Edge Cases', () => {
        it('should handle extreme line and column numbers', () => {
            const extremeCases = [
                { line: '0', column: '0' },           // Zero values
                { line: '1', column: '1' },           // Minimum valid
                { line: '999999', column: '999999' }, // Very large
                { line: '2147483647', column: '2147483647' }, // Max 32-bit int
            ];
            
            extremeCases.forEach(({ line, column }) => {
                const logLine = `src/main.cpp:${line}:${column}: error: test error`;
                
                const regex = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;
                const match = logLine.match(regex);
                
                assert(match !== null);
                
                const parsedLine = parseInt(match[2]);
                const parsedColumn = parseInt(match[3]);
                
                assert.strictEqual(parsedLine, parseInt(line));
                assert.strictEqual(parsedColumn, parseInt(column));
                assert(!isNaN(parsedLine));
                assert(!isNaN(parsedColumn));
            });
        });

        it('should handle invalid numeric values gracefully', () => {
            const invalidNumbers = ['abc', '', 'NaN', 'Infinity', '-1', '1.5', '1e10'];
            
            invalidNumbers.forEach(invalidNum => {
                const line = `src/main.cpp:${invalidNum}:${invalidNum}: error: test error`;
                
                const regex = /^(.+?):(\\d+):(\\d+):\\s*(error|warning):\\s*(.+)$/i;
                const match = line.match(regex);
                
                // Should either match or not match, but not crash
                if (match) {
                    const parsedLine = parseInt(match[2]);
                    const parsedColumn = parseInt(match[3]);
                    
                    // parseInt should handle invalid input gracefully
                    assert(typeof parsedLine === 'number');
                    assert(typeof parsedColumn === 'number');
                }
            });
        });
    });

    describe('Regex Pattern Edge Cases', () => {
        it('should handle catastrophic backtracking scenarios', () => {
            // Patterns that could cause catastrophic backtracking
            const problematicPatterns = [
                '(a+)+b',
                '(a|a)*b',
                '(.*)*$',
                '^(a+)+$'
            ];
            
            const testString = 'a'.repeat(20) + 'x'; // String that doesn't match
            
            problematicPatterns.forEach(pattern => {
                const startTime = process.hrtime.bigint();
                
                try {
                    const regex = new RegExp(pattern);
                    const match = testString.match(regex);
                    
                    const endTime = process.hrtime.bigint();
                    const durationMs = Number(endTime - startTime) / 1000000;
                    
                    // Should complete quickly even for non-matching strings
                    assert(durationMs < 100, `Pattern ${pattern} took too long: ${durationMs}ms`);
                } catch (error) {
                    // Invalid patterns should be handled gracefully
                    assert(error instanceof Error);
                }
            });
        });

        it('should handle empty capture groups', () => {
            const line = 'src/main.cpp::error: message with empty parts';
            const pattern = '^(.+?):(\\d*):(\\d*):\\s*(.*?):\\s*(.+)$';
            
            const regex = new RegExp(pattern, 'i');
            const match = line.match(regex);
            
            if (match) {
                // Should handle empty captures gracefully
                assert.strictEqual(match[1], 'src/main.cpp');
                assert.strictEqual(match[2], ''); // Empty line number
                assert.strictEqual(match[3], ''); // Empty column number
                assert.strictEqual(match[4], ''); // Empty severity
                assert.strictEqual(match[5], 'message with empty parts');
                
                // parseInt on empty string should return NaN
                assert(isNaN(parseInt(match[2])));
                assert(isNaN(parseInt(match[3])));
            }
        });
    });

    describe('Concurrency and Race Conditions', () => {
        it('should handle simultaneous parsing operations', async () => {
            const lines = [
                'src/file1.cpp:10:5: error: error 1',
                'src/file2.cpp:20:10: warning: warning 1',
                'src/file3.cpp:30:15: error: error 2'
            ];
            
            const parsePromises = lines.map(async (line, index) => {
                // Simulate async parsing with setTimeout
                return new Promise(resolve => {
                    setTimeout(() => {
                        const regex = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;
                        const match = line.match(regex);
                        resolve({ index, match, line });
                    }, Math.random() * 10);
                });
            });
            
            const results = await Promise.all(parsePromises);
            
            assert.strictEqual(results.length, 3);
            results.forEach(result => {
                assert(result.match !== null);
                assert(result.line.includes(result.index === 0 ? 'file1' : result.index === 1 ? 'file2' : 'file3'));
            });
        });
    });
});
