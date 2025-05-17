import fs from 'fs';
import path from 'path';
import util from 'util';
import { fileURLToPath } from 'url';

// Assuming this file (logger.ts) is in 'src/', and will be compiled to 'build/logger.js'
// And the main 'index.js' will be in 'build/'
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', 'logs'); // Puts 'logs' directory in '.../mcp-mvp/logs/'
const logFilePath = path.join(logsDir, 'app.log');

// Ensure logs directory exists
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (e) {
  // Fallback to original console if directory creation fails for any reason
  const originalConsoleError = console.error;
  originalConsoleError('Failed to create logs directory:', logsDir, e);
  // Avoid further file operations if directory setup failed.
  // This export {} will still make it a module.
  // The console will not be overridden.
  // This is a silent failure for file logging but keeps app running.
  // A more robust solution might throw or have a status flag.
}

let logStream: fs.WriteStream | null = null;
try {
  // Check if logsDir was created, or existed.
  if (fs.existsSync(logsDir)) {
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  }
} catch (e) {
  const originalConsoleError = console.error;
  originalConsoleError('Failed to create log write stream:', logFilePath, e);
}


function formatMessage(level: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  const messageParts: string[] = [];
  for (const arg of args) {
    if (typeof arg === 'string') {
      messageParts.push(arg);
    } else if (arg instanceof Error) {
      messageParts.push(arg.stack || arg.message); // Include stack for errors
    } else {
      messageParts.push(util.inspect(arg, { depth: null, colors: false, breakLength: Infinity }));
    }
  }
  return `${timestamp} [${level.toUpperCase()}] ${messageParts.join(' ')}\n`;
}

// Store original console methods before overriding
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

if (logStream) {
  console.log = (...args: any[]) => {
    originalConsole.log.apply(console, args);
    if (logStream) {
      logStream.write(formatMessage('log', ...args));
    }
  };

  console.error = (...args: any[]) => {
    originalConsole.error.apply(console, args);
    if (logStream) {
      logStream.write(formatMessage('error', ...args));
    }
  };

  console.warn = (...args: any[]) => {
    originalConsole.warn.apply(console, args);
    if (logStream) {
      logStream.write(formatMessage('warn', ...args));
    }
  };

  console.info = (...args: any[]) => {
    originalConsole.info.apply(console, args);
    if (logStream) {
      logStream.write(formatMessage('info', ...args));
    }
  };

  console.debug = (...args: any[]) => {
    originalConsole.debug.apply(console, args);
    if (logStream) {
      logStream.write(formatMessage('debug', ...args));
    }
  };

  // Handle process exit to close the stream
  const cleanup = () => {
    if (logStream) {
      logStream.end(() => {
        // Optional: callback after stream is closed
      });
      logStream = null; // Prevent further writes
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { // Handle Ctrl+C
    cleanup();
    process.exit(); // Ensure process exits after cleanup
  });
  process.on('SIGTERM', () => { // Handle termination signal
    cleanup();
    process.exit();
  });
  process.on('uncaughtException', (err) => { // Handle uncaught exceptions
    originalConsole.error('Uncaught Exception:', err);
    if (logStream) {
      logStream.write(formatMessage('fatal', 'Uncaught Exception:', err));
    }
    cleanup();
    process.exit(1); // Exit with error code
  });

} else {
  originalConsole.error("Log stream not initialized. File logging will be disabled.");
}

// This export ensures the file is treated as a module and the code above runs.
export {}; 