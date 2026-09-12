import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

/**
 * Locating trc_pkt_lister
 * -----------------------
 * OpenCSD's `make` does not install anything: the binary stays in the build
 * tree (decoder/tests/bin/<target>/) and links against libopencsd.so.1, which
 * stays in decoder/lib/<target>/. So "OpenCSD is installed" almost never means
 * "trc_pkt_lister is on PATH with its libraries resolvable".
 *
 * On top of that, a VS Code window started from a desktop launcher inherits the
 * session environment, not the login shell's - so a PATH entry added in
 * .bashrc / .profile is invisible to the extension host even though it works in
 * the integrated terminal.
 *
 * This module therefore resolves both the executable and the directories that
 * must go on LD_LIBRARY_PATH, and reports everywhere it looked when it fails.
 */

export interface ResolvedDecoder {
    /** Absolute path to the executable (or a bare name when found on PATH). */
    command: string;
    /** Directories to prepend to LD_LIBRARY_PATH / DYLD_LIBRARY_PATH. */
    libDirs: string[];
    /** Human-readable account of how it was found, for the log. */
    source: string;
}

export interface LocateOptions {
    /** Explicit path from the UI field or settings. Tried first. */
    explicitPath?: string;
    /** Workspace root; its ancestors and their children are searched. */
    workspaceRoot?: string;
    /** Executable to find. Defaults to trc_pkt_lister. */
    binaryName?: string;
}

const IS_WIN = process.platform === 'win32';

function exeName(name: string): string {
    return IS_WIN && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name;
}

function isExecutableFile(p: string): boolean {
    try {
        const st = fs.statSync(p);
        if (!st.isFile()) return false;
        if (IS_WIN) return true;
        return (st.mode & 0o111) !== 0;
    } catch {
        return false;
    }
}

/** Build-tree layouts OpenCSD produces, relative to a candidate root. */
function relativeBinaryCandidates(bin: string): string[] {
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
    const out: string[] = [];
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
function relativeLibCandidates(): string[] {
    const targets = [
        'builddir',
        'linux-x86_64/rel', 'linux-x86_64/dbg',
        'linux-arm64/rel', 'linux-arm64/dbg',
        'linux-aarch64/rel', 'linux-aarch64/dbg',
        'linux-x86/rel', 'linux-x86/dbg'
    ];
    const prefixes = ['decoder/lib', 'OpenCSD/decoder/lib', 'opencsd/decoder/lib', 'lib'];
    const out: string[] = [];
    for (const prefix of prefixes) {
        for (const t of targets) out.push(path.join(prefix, t));
        out.push(prefix);
    }
    return out;
}

function hasSharedLib(dir: string): boolean {
    try {
        return fs.readdirSync(dir).some(f => /^libopencsd(_c_api)?\.(so|dylib|dll)/.test(f));
    } catch {
        return false;
    }
}

/**
 * Library directories for a resolved binary. The binary's own directory comes
 * first: OpenCSD's unix build copies the .so files next to the test binaries,
 * so that alone is usually enough.
 */
export function libraryDirsFor(binaryPath: string): string[] {
    const dirs: string[] = [];
    const add = (d: string) => {
        if (d && hasSharedLib(d) && !dirs.includes(d)) dirs.push(d);
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
        if (parent === cur) break;
        cur = parent;
    }
    return dirs;
}

/** Directories on PATH, as the extension host sees them. */
function pathDirs(): string[] {
    return (process.env.PATH || '').split(path.delimiter).filter(Boolean);
}

/**
 * PATH as a login shell would compute it. A GUI-launched VS Code does not run
 * the user's shell profile, so this recovers entries added there.
 */
function loginShellPath(): string | null {
    if (IS_WIN) return null;
    const shell = process.env.SHELL || '/bin/bash';
    try {
        const out = execFileSync(shell, ['-lic', 'printf %s "$PATH"'], {
            encoding: 'utf8',
            timeout: 4000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return out.trim() || null;
    } catch {
        return null;
    }
}

/** Ancestors of the workspace, plus one level of their children. */
function candidateRoots(workspaceRoot?: string): string[] {
    const roots: string[] = [];
    const add = (d?: string) => {
        if (!d) return;
        const r = path.resolve(d);
        if (!roots.includes(r)) roots.push(r);
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
            } catch { /* unreadable directory - skip */ }
            const parent = path.dirname(cur);
            if (parent === cur) break;
            cur = parent;
        }
    }
    return roots;
}

export interface LocateFailure {
    found: false;
    binaryName: string;
    searchedPathDirs: string[];
    searchedRoots: string[];
    loginShellPathTried: boolean;
    /** Binary found but its shared libraries could not be located. */
    binaryWithoutLibs?: string;
}

export type LocateResult = (ResolvedDecoder & { found: true }) | LocateFailure;

export function locateDecoder(opts: LocateOptions = {}): LocateResult {
    const bin = exeName(opts.binaryName || 'trc_pkt_lister');
    const searchedRoots: string[] = [];
    let loginShellPathTried = false;

    const finish = (command: string, source: string): LocateResult => ({
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
        if (isExecutableFile(c)) return finish(c, `PATH (${d})`);
    }

    // 3. PATH as a login shell sees it.
    const shellPath = loginShellPath();
    if (shellPath) {
        loginShellPathTried = true;
        for (const d of shellPath.split(path.delimiter).filter(Boolean)) {
            if (hostPathDirs.includes(d)) continue;
            const c = path.join(d, bin);
            if (isExecutableFile(c)) return finish(c, `login-shell PATH (${d})`);
        }
    }

    // 4. Known OpenCSD build-tree layouts.
    const rels = relativeBinaryCandidates(bin);
    for (const root of candidateRoots(opts.workspaceRoot)) {
        searchedRoots.push(root);
        for (const rel of rels) {
            const c = path.join(root, rel);
            if (isExecutableFile(c)) return finish(c, `OpenCSD build tree (${root})`);
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
export function formatLocateFailure(f: LocateFailure, explicitPath?: string): string {
    const lines: string[] = [];
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
export function decoderEnv(libDirs: string[]): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (libDirs.length === 0) return env;

    const key = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
    if (IS_WIN) {
        env.PATH = [...libDirs, env.PATH || ''].filter(Boolean).join(path.delimiter);
        return env;
    }
    env[key] = [...libDirs, env[key] || ''].filter(Boolean).join(path.delimiter);
    return env;
}
