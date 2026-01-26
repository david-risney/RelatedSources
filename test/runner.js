#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
}

function log(message, color = 'reset') {
    console.log(colorize(message, color));
}

async function runTests() {
    log('🚀 Running WatchBuildLog Extension Unit Tests', 'bright');
    log('='.repeat(50), 'blue');

    const testDir = path.join(__dirname, 'unit');
    const testFiles = fs.readdirSync(testDir)
        .filter(file => file.endsWith('.test.js'))
        .map(file => path.join(testDir, file));

    if (testFiles.length === 0) {
        log('❌ No test files found in test/unit/', 'red');
        process.exit(1);
    }

    log(`📁 Found ${testFiles.length} test files:`, 'cyan');
    testFiles.forEach(file => {
        const fileName = path.basename(file);
        log(`   • ${fileName}`, 'yellow');
    });
    log('');

    // Run all tests
    const args = ['--test', ...testFiles];
    
    log('🧪 Running tests...', 'bright');
    log('');

    return new Promise((resolve, reject) => {
        const child = spawn('node', args, {
            stdio: 'inherit',
            cwd: __dirname
        });

        child.on('close', (code) => {
            log('');
            if (code === 0) {
                log('✅ All tests passed!', 'green');
                log('='.repeat(50), 'blue');
                resolve();
            } else {
                log('❌ Some tests failed!', 'red');
                log('='.repeat(50), 'blue');
                reject(new Error(`Tests failed with exit code ${code}`));
            }
        });

        child.on('error', (error) => {
            log(`❌ Failed to run tests: ${error.message}`, 'red');
            reject(error);
        });
    });
}

async function runCoverage() {
    log('📊 Running test coverage analysis...', 'bright');
    log('');

    const testDir = path.join(__dirname, 'unit');
    const testFiles = fs.readdirSync(testDir)
        .filter(file => file.endsWith('.test.js'))
        .map(file => path.join(testDir, file));

    const args = ['--test', '--experimental-test-coverage', ...testFiles];

    return new Promise((resolve, reject) => {
        const child = spawn('node', args, {
            stdio: 'inherit',
            cwd: __dirname
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Coverage analysis failed with exit code ${code}`));
            }
        });

        child.on('error', (error) => {
            reject(error);
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    
    try {
        if (args.includes('--coverage')) {
            await runCoverage();
        } else {
            await runTests();
        }
    } catch (error) {
        process.exit(1);
    }
}

// Show usage information
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    log('WatchBuildLog Extension Test Runner', 'bright');
    log('');
    log('Usage:', 'cyan');
    log('  node test/runner.js         Run all unit tests');
    log('  node test/runner.js --coverage   Run tests with coverage analysis');
    log('  node test/runner.js --help       Show this help message');
    log('');
    log('Available npm scripts:', 'cyan');
    log('  npm test                    Run all tests');
    log('  npm run test-unit           Run unit tests');
    log('  npm run test-parser         Run parser tests only');
    log('  npm run test-glob           Run glob matching tests only');
    log('  npm run test-integration    Run integration tests only');
    log('  npm run test-edge-cases     Run edge case tests only');
    log('  npm run test-config         Run configuration tests only');
    log('  npm run test-watch          Run tests in watch mode');
    log('  npm run test-coverage       Run tests with coverage');
    process.exit(0);
}

if (require.main === module) {
    main();
}

module.exports = { runTests, runCoverage };
