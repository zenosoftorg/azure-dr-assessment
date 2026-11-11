/**
 * The exit code of one test file as tests/run-all.mjs counts it. A file that timed out fails even when its process then
 * ends with 0: the kill and the end of the file can cross. A file that a signal ended, or that has no exit code, fails too.
 */
export function fileExitCode({ code, signal, timedOut }) {
    return timedOut || signal ? 1 : (code ?? 1);
}
