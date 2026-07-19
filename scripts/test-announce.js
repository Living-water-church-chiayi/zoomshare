'use strict';

// Backward-compatible entry point for older CI jobs and contributor commands.
// The runtime suite extracts and executes the real announcement implementation.
require('./test-runtime');
