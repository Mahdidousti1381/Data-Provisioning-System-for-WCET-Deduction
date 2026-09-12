"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.libraryDirsFor = libraryDirsFor;
exports.locateDecoder = locateDecoder;
exports.formatLocateFailure = formatLocateFailure;
exports.decoderEnv = decoderEnv;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const IS_WIN = process.platform === 'win32';
function exeName(name) {
    return IS_WIN && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name;
}
function isExecutableFile(p) {
    try {
        const st = fs.statSync(p);
        if (!st.isFile())
            return false;
        if (IS_WIN)
            return true;
        return (st.mode & 0o111) !== 0;
    }
    catch {
        return false;
    }
}
/** Build-tree layouts OpenCSD produces, relative to a candidate root. */
function relativeBinaryCandidates(bin) {
    const targets = [
        'builddir',
        'linux-x86_64/rel', 'linux-x86_64/dbg',
        'linux-arm64/rel', 'linux-arm64/dbg',
        'linux-aarch64/rel', 'linux-aarch64/dbg',
        'linux-x86/rel', 'linux-x86/dbg'
    ];
    const prefixes = [
        'decoder/tests/bin',
        'OpenCSD/decoder/tests/bin',
        'opencsd/decoder/tests/bin',
        'tests/bin',
        'bin'
    ];
    const out = [];
    for (const prefix of prefixes) {
        for (const t of targets) {
            out.push(path.join(prefix, t, bin));
        }
        out.push(path.join(prefix, bin));
    }
    out.push(bin);
    return out;
}
/** Directories that may hold libopencsd.so, given the OpenCSD tree root. */
function relativeLibCandidates() {
    const targets = [
        'builddir',
        'linux-x86_64/rel', 'linux-x86_64/dbg',
        'linux-arm64/rel', 'linux-arm64/dbg',
        'linux-aarch64/rel', 'linux-aarch64/dbg',
        'linux-x86/rel', 'linux-x86/dbg'
    ];
    const prefixes = ['decoder/lib', 'OpenCSD/decoder/lib', 'opencsd/decoder/lib', 'lib'];
    const out = [];
    for (const prefix of prefixes) {
        for (const t of targets)
            out.push(path.join(prefix, t));
        out.push(prefix);
    }
    return out;
}
function hasSharedLib(dir) {
    try {
        return fs.readdirSync(dir).some(f => /^libopencsd(_c_api)?\.(so|dylib|dll)/.test(f));
    }
    catch {
        return false;
    }
}
/**
 * Library directories for a resolved binary. The binary's own directory comes
 * first: OpenCSD's unix build copies the .so files next to the test binaries,
 * so that alone is usually enough.
 */
function libraryDirsFor(binaryPath) {
    const dirs = [];
    const add = (d) => {
        if (d && hasSharedLib(d) && !dirs.includes(d))
            dirs.push(d);
    };
    const binDir = path.dirname(path.resolve(binaryPath));
    add(binDir);
    // Walk up out of the build tree looking for decoder/lib/<target>.
    let cur = binDir;
    for (let i = 0; i < 6; i++) {
        for (const rel of relativeLibCandidates()) {
            add(path.join(cur, rel));
        }
        const parent = path.dirname(cur);
        if (parent === cur)
            break;
        cur = parent;
    }
    return dirs;
}
/** Directories on PATH, as the extension host sees them. */
function pathDirs() {
    return (process.env.PATH || '').split(path.delimiter).filter(Boolean);
}
/**
 * PATH as a login shell would compute it. A GUI-launched VS Code does not run
 * the user's shell profile, so this recovers entries added there.
 */
function loginShellPath() {
    if (IS_WIN)
        return null;
    const shell = process.env.SHELL || '/bin/bash';
    try {
        const out = (0, child_process_1.execFileSync)(shell, ['-lic', 'printf %s "$PATH"'], {
            encoding: 'utf8',
            timeout: 4000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return out.trim() || null;
    }
    catch {
        return null;
    }
}
/** Ancestors of the workspace, plus one level of their children. */
function candidateRoots(workspaceRoot) {
    const roots = [];
    const add = (d) => {
        if (!d)
            return;
        const r = path.resolve(d);
        if (!roots.includes(r))
            roots.push(r);
    };
    add(process.env.OPENCSD_ROOT);
    add(workspaceRoot);
    const home = os.homedir();
    for (const n of ['OpenCSD', 'opencsd', 'DecodeWorkspace', 'coresight']) {
        add(path.join(home, n));
    }
    add(home);
    for (const n of ['/opt/OpenCSD', '/opt/opencsd', '/usr/local/OpenCSD', '/usr/local/opencsd', '/usr/local', '/usr']) {
        add(n);
    }
    // Walk up from the workspace, and at each level look one directory deep for
    // anything that looks like an OpenCSD checkout or a decode workspace.
    if (workspaceRoot) {
        let cur = path.resolve(workspaceRoot);
        for (let i = 0; i < 4; i++) {
            add(cur);
            try {
                const children = fs.readdirSync(cur, { withFileTypes: true })
                    .filter(e => e.isDirectory())
                    .slice(0, 200);
                for (const c of children) {
                    if (/opencsd|coresight|decode|trace/i.test(c.name)) {
                        add(path.join(cur, c.name));
                    }
                }
            }
            catch { /* unreadable directory - skip */ }
            const parent = path.dirname(cur);
            if (parent === cur)
                break;
            cur = parent;
        }
    }
    return roots;
}
function locateDecoder(opts = {}) {
    const bin = exeName(opts.binaryName || 'trc_pkt_lister');
    const searchedRoots = [];
    let loginShellPathTried = false;
    const finish = (command, source) => ({
        found: true,
        command,
        libDirs: libraryDirsFor(command),
        source
    });
    // 1. Explicit path from the UI or settings.
    if (opts.explicitPath && opts.explicitPath.trim()) {
        const raw = opts.explicitPath.trim();
        const candidates = [raw, path.join(raw, bin)];
        for (const c of candidates) {
            if (isExecutableFile(c)) {
                return finish(path.resolve(c), `explicit path (${c})`);
            }
        }
        // An explicit path that does not resolve is a configuration error;
        // fall through to the search but report it clearly on failure.
    }
    // 2. PATH as the extension host sees it.
    const hostPathDirs = pathDirs();
    for (const d of hostPathDirs) {
        const c = path.join(d, bin);
        if (isExecutableFile(c))
            return finish(c, `PATH (${d})`);
    }
    // 3. PATH as a login shell sees it.
    const shellPath = loginShellPath();
    if (shellPath) {
        loginShellPathTried = true;
        for (const d of shellPath.split(path.delimiter).filter(Boolean)) {
            if (hostPathDirs.includes(d))
                continue;
            const c = path.join(d, bin);
            if (isExecutableFile(c))
                return finish(c, `login-shell PATH (${d})`);
        }
    }
    // 4. Known OpenCSD build-tree layouts.
    const rels = relativeBinaryCandidates(bin);
    for (const root of candidateRoots(opts.workspaceRoot)) {
        searchedRoots.push(root);
        for (const rel of rels) {
            const c = path.join(root, rel);
            if (isExecutableFile(c))
                return finish(c, `OpenCSD build tree (${root})`);
        }
    }
    return {
        found: false,
        binaryName: bin,
        searchedPathDirs: hostPathDirs,
        searchedRoots,
        loginShellPathTried
    };
}
/** Multi-line, actionable explanation for the decoder console. */
function formatLocateFailure(f, explicitPath) {
    const lines = [];
    lines.push(`Could not find the OpenCSD decoder executable "${f.binaryName}".`);
    lines.push('');
    if (explicitPath && explicitPath.trim()) {
        lines.push(`The path you supplied does not point at an executable: ${explicitPath}`);
        lines.push('');
    }
    lines.push('OpenCSD\'s build does not install anything - trc_pkt_lister stays in the');
    lines.push('build tree and is not placed on PATH. Searched:');
    lines.push(`  - ${f.searchedPathDirs.length} directories on PATH`);
    if (f.loginShellPathTried) {
        lines.push('  - PATH as reported by your login shell');
    }
    lines.push(`  - ${f.searchedRoots.length} candidate OpenCSD roots, including:`);
    for (const r of f.searchedRoots.slice(0, 8)) {
        lines.push(`      ${r}`);
    }
    lines.push('');
    lines.push('Fix it in any of these ways:');
    lines.push('  1. Put the full path in the "Decoder Binary Path" field above, e.g.');
    lines.push('     <opencsd>/decoder/tests/bin/builddir/trc_pkt_lister');
    lines.push('  2. Set "coresightTraceStudio.decoderPath" in VS Code settings.');
    lines.push('  3. Export OPENCSD_ROOT=<path to your OpenCSD checkout> before starting VS Code.');
    lines.push('');
    lines.push('The library path is handled for you once the binary is found.');
    return lines.join('\n');
}
/**
 * Environment for the decoder process, with the OpenCSD shared libraries on the
 * loader path. Without this the binary aborts with
 * "libopencsd.so.1: cannot open shared object file".
 */
function decoderEnv(libDirs) {
    const env = { ...process.env };
    if (libDirs.length === 0)
        return env;
    const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
    if (IS_WIN) {
        env.PATH = [...libDirs, env.PATH || ''].filter(Boolean).join(path.delimiter);
        return env;
    }
    env[key] = [...libDirs, env[key] || ''].filter(Boolean).join(path.delimiter);
    return env;
}
//# sourceMappingURL=decoderLocator.js.map